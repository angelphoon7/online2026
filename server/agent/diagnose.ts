import 'server-only';
import type { Address, Hex } from 'viem';
import { checkReceivedBundle, combinations } from '../../solver/dist/index.js';
import type { ChainState, Intent, TicketMeta } from '../../solver/src/types';
import type { Snapshot, LiveIntent, ExclusionReason } from '@/shared/graph';
import { getIntentById } from '@/shared/graph';
import { SEARCH_CONFIG } from '../solve';
import { readCapacity, requireCapacityBlock, solveHypothetical, type Capacity, type HypotheticalResult } from '../solve-hypothetical';

// Deterministic diagnosis - step 7-D of docs/RESHUFFLE_GRAPH_PLAN.md.
//
// The judgement is made HERE, not by the language model. Every claim below is produced by
// filtering the snapshot pool or by re-running the solver over a varied intent; narrate.ts is
// only allowed to put those findings into sentences. When a judge asks "how do you know
// that?", the answer is this evidence object, which GET /api/agent/diagnose returns with no
// Anthropic key involved at all.
//
// Three things it can establish, in order of strength:
//
//   1. An exclusion or closure - a named, certain reason, straight from the snapshot.
//   2. Supply and demand - NECESSARY conditions. The supply funnel says whether the tickets
//      you want exist at all; the demand check says whether anyone accepts what you offer.
//      Neither proves a reshuffle exists, and the wording must never imply it does.
//   3. Single-condition relaxations - each one re-run through the real solver, so "raising
//      your limit would settle" means a solver found a candidate, not that it seemed likely.
//
// What it never says: that no solution exists. The search is bounded, and the honest statement
// is that none was found within the published bound.

/** Every stage of the funnel is a filter that mirrors one thing Settlement checks in V5. */
export type FunnelStage = {
  stage: 'offeredByOthers' | 'eventId' | 'session' | 'section' | 'cohesiveGroup';
  remaining: number;
};

export type Relaxation = {
  /** The single change tried, in the vocabulary the UI and the model both use. */
  change: string;
  found: boolean;
  counterparties: Address[];
  participantCount: number | null;
  /** Signed, in contract units. */
  targetNetPay: string | null;
  receives: string[];
  /**
   * Budget relaxation only: did the extra budget actually do the work?
   *
   * False when the candidate it found asks this owner for no more than their committed limit
   * already allows. That settlement was always within their signed conditions, so the
   * bounded baseline search simply did not reach it - and recommending "raise your limit"
   * would name a cause that is not one.
   */
  binding?: boolean;
};

export type Evidence = {
  block: string;
  timestamp: string;
  intent: string;
  status: 'SETTLEABLE' | 'NOT_FOUND_WITHIN_BOUND' | 'EXCLUDED' | 'CLOSED' | 'UNKNOWN';
  /** Present for EXCLUDED: the snapshot's named reason, mirroring a contract check. */
  exclusion?: { reason: ExclusionReason; detail?: string };
  /** Present for CLOSED: revoked or already settled, with the transaction that did it. */
  closed?: { state: 'REVOKED' | 'SETTLED'; tx: string | null; block: string | null };
  /**
   * Retained for older saved evidence. New requests propagate lookup failures to the API
   * instead of producing an UNKNOWN diagnosis from an unavailable historical snapshot.
   */
  lookupFailed?: boolean;
  /** Present for SETTLEABLE: a candidate containing this intent exists right now. */
  settleable?: {
    counterparties: Address[];
    participantCount: number;
    targetNetPay: string;
    receives: string[];
  };
  /** Necessary condition only: do the tickets this intent wants exist in the pool? */
  supply?: {
    stages: FunnelStage[];
    /** The first stage whose count reached zero, if any. */
    firstZero: FunnelStage['stage'] | null;
    /**
     * The stage that actually blocks this intent - the first zero, or 'cohesiveGroup' when
     * acceptable tickets exist but cannot be grouped into the requested count. Distinct from
     * firstZero, because "only one adjacent seat is available and you asked for two" blocks
     * the intent without any stage reaching zero.
     */
    blockedAt: FunnelStage['stage'] | null;
    largestGroup: number;
    need: number;
    /** True when the candidate set was capped before the group search. */
    truncated: boolean;
  };
  /** Necessary condition only: does anyone currently accept the tickets this intent offers? */
  demand?: {
    perTicket: { ticket: string; acceptingIntents: number }[];
    unwanted: string[];
  };
  relaxations: Relaxation[];
  bounds: typeof SEARCH_CONFIG & { budgetCapUsdc: number; groupSearchCap: number };
  /** address -> the transaction that committed their intent, for explorer links. */
  counterpartyTx: Record<string, string>;
  runtimeMs: number;
};

const USDC = 1_000_000n;
/** Ceiling used by the BUDGET relaxation. Published, not inferred from the pool. */
const budgetCapUsdc = () => Number(process.env.BUDGET_CAP_USDC ?? 100);
/** The group search is combinatorial, so the candidate set it runs over is capped. */
const GROUP_SEARCH_CAP = 40;

const accepts = (mask: bigint, id: number) => ((mask >> BigInt(id)) & 1n) === 1n;
const lower = (a: string) => a.toLowerCase();

/** A ChainState over the snapshot, for predicate questions that need no payment capacity. */
function predicateState(snapshot: Snapshot): ChainState {
  return {
    ticketMeta: snapshot.ticketMeta,
    depositor: snapshot.depositor,
    intentState: new Map(snapshot.intents.map((i) => [i.hash, 1])),
    usdcBalance: new Map(),
    usdcAllowance: new Map(),
    blockTimestamp: snapshot.timestamp,
  };
}

/**
 * Largest bundle of these tickets that the intent would actually accept.
 *
 * Delegates every condition to the solver's V5 predicate. Searched from the wanted count
 * downwards, so it stops at the first size that works and reports what is achievable rather
 * than only whether the full count is.
 */
function largestAcceptableGroup(intent: Intent, candidates: bigint[], state: ChainState): number {
  const want = Math.min(intent.exactCount, candidates.length);
  for (let size = want; size >= 1; size--) {
    for (const bundle of combinations(candidates, size)) {
      // exactCount is part of V5, so ask about a variant wanting exactly this many.
      if (!checkReceivedBundle({ ...intent, exactCount: size }, bundle, state)) return size;
    }
  }
  return 0;
}

/** Tickets other participants have offered and that are still escrowed by them. */
function offeredByOthers(snapshot: Snapshot, owner: Address): bigint[] {
  const ids: bigint[] = [];
  for (const other of snapshot.intents) {
    if (lower(other.owner) === lower(owner)) continue;
    for (const id of other.offered) {
      // getPoolSnapshot already enforced escrow-by-owner and non-redemption (V2/V3) for every
      // intent it kept, so anything offered here is genuinely available to be reshuffled.
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

function supplyFunnel(intent: LiveIntent, snapshot: Snapshot, state: ChainState): Evidence['supply'] {
  const start = offeredByOthers(snapshot, intent.owner);
  const stages: FunnelStage[] = [{ stage: 'offeredByOthers', remaining: start.length }];

  const meta = (id: bigint) => snapshot.ticketMeta.get(id);
  let pool = start.filter((id) => meta(id)?.eventId === intent.eventId);
  stages.push({ stage: 'eventId', remaining: pool.length });

  pool = pool.filter((id) => accepts(intent.sessionMask, meta(id)!.sessionId));
  stages.push({ stage: 'session', remaining: pool.length });

  pool = pool.filter((id) => accepts(intent.sectionMask, meta(id)!.sectionId));
  stages.push({ stage: 'section', remaining: pool.length });

  // Cohesion and adjacency are properties of a GROUP, not of a ticket, so this last stage is a
  // group search rather than another filter.
  const truncated = pool.length > GROUP_SEARCH_CAP;
  const searched = truncated ? pool.slice(0, GROUP_SEARCH_CAP) : pool;
  const largestGroup = largestAcceptableGroup(intent, searched, state);
  stages.push({ stage: 'cohesiveGroup', remaining: largestGroup });

  const firstZero = stages.find((s) => s.remaining === 0)?.stage ?? null;
  return {
    stages,
    firstZero,
    blockedAt: firstZero ?? (largestGroup < intent.exactCount ? 'cohesiveGroup' : null),
    largestGroup,
    need: intent.exactCount,
    truncated,
  };
}

/**
 * Does anyone want what this intent offers?
 *
 * If the answer is nobody, the problem is on the giving side and relaxing the owner's own
 * conditions cannot help - which is a thing the answer has to say plainly rather than
 * suggesting a change that will not work.
 */
function demandCheck(intent: LiveIntent, snapshot: Snapshot): Evidence['demand'] {
  const perTicket = intent.offered.map((id) => {
    const meta = snapshot.ticketMeta.get(id);
    const acceptingIntents = meta
      ? snapshot.intents.filter(
          (other) =>
            lower(other.owner) !== lower(intent.owner) &&
            other.exactCount > 0 &&
            other.eventId === meta.eventId &&
            accepts(other.sessionMask, meta.sessionId) &&
            accepts(other.sectionMask, meta.sectionId)
        ).length
      : 0;
    return { ticket: id.toString(), acceptingIntents };
  });
  return { perTicket, unwanted: perTicket.filter((t) => !t.acceptingIntents).map((t) => t.ticket) };
}

/** Session and section ids present in the pool but absent from this intent's masks. */
function missingClasses(intent: LiveIntent, snapshot: Snapshot) {
  const sessions = new Set<number>();
  const sections = new Set<number>();
  for (const id of offeredByOthers(snapshot, intent.owner)) {
    const meta = snapshot.ticketMeta.get(id);
    if (!meta || meta.eventId !== intent.eventId) continue;
    if (!accepts(intent.sessionMask, meta.sessionId)) sessions.add(meta.sessionId);
    if (!accepts(intent.sectionMask, meta.sectionId)) sections.add(meta.sectionId);
  }
  return { sessions: [...sessions].sort((a, b) => a - b), sections: [...sections].sort((a, b) => a - b) };
}

const asRelaxation = (change: string, result: HypotheticalResult): Relaxation => ({
  change,
  found: result.found,
  counterparties: result.counterparties,
  participantCount: result.participantCount,
  targetNetPay: result.targetNetPay,
  receives: result.receives,
});

/**
 * Why this intent has no settlement at the snapshot block.
 *
 * `capacity` is optional so a caller running several diagnoses can read USDC balances once.
 */
export async function diagnose(snapshot: Snapshot, intentHash: Hex, capacity?: Capacity): Promise<Evidence> {
  if (capacity) requireCapacityBlock(capacity, snapshot.block);
  const started = performance.now();
  const target = lower(intentHash);
  const bounds = { ...SEARCH_CONFIG, budgetCapUsdc: budgetCapUsdc(), groupSearchCap: GROUP_SEARCH_CAP };
  const base = {
    block: snapshot.block.toString(),
    timestamp: snapshot.timestamp.toString(),
    intent: intentHash,
    relaxations: [] as Relaxation[],
    bounds,
    counterpartyTx: {} as Record<string, string>,
  };
  const done = (evidence: Omit<Evidence, 'runtimeMs'>): Evidence => ({
    ...evidence,
    runtimeMs: performance.now() - started,
  });

  // 1. Locate. An excluded or closed intent is already a complete answer, and a better one
  //    than any counterfactual: it names the check that removed it.
  const intent = snapshot.intents.find((i) => lower(i.hash) === target);
  if (!intent) {
    const excluded = snapshot.excluded.find((e) => lower(e.id) === target);
    if (excluded) {
      return done({ ...base, status: 'EXCLUDED', exclusion: { reason: excluded.reason, detail: excluded.detail } });
    }
    // Not live and not excluded: it was revoked, already settled, or never committed here.
    // Exact snapshot block, not a freshness floor: a later revoke is not true at this block.
    // Failed historical reads propagate to the API; they must not become UNKNOWN or latest.
    const found = await getIntentById(intentHash, snapshot);
    if (found && (found.state === 'REVOKED' || found.state === 'SETTLED')) {
      return done({
        ...base,
        status: 'CLOSED',
        closed: { state: found.state, tx: found.closedTx, block: found.closedAtBlock },
      });
    }
    return done({ ...base, status: 'UNKNOWN' });
  }

  const counterpartyTx: Record<string, string> = {};
  for (const other of snapshot.intents) counterpartyTx[lower(other.owner)] = other.committedTx;

  // Read payment capacity once and reuse it for the baseline and every relaxation. V8 is part
  // of validity, so a relaxation that ignored it could promise a settlement the contract
  // would reject.
  const owners = snapshot.intents.map((i) => i.owner as Address);
  const funds = capacity ?? (await readCapacity(owners, snapshot.block));
  const unchanged: Intent = { ...intent };
  const hypothetical = (variation: Partial<Intent>) =>
    solveHypothetical(snapshot, { replaceHash: intent.hash, intent: { ...unchanged, ...variation } }, funds);

  // 2. Baseline: the pool exactly as committed. Running it through the same path as the
  //    relaxations means the comparison is apples to apples.
  const baseline = await hypothetical({});
  if (baseline.found) {
    return done({
      ...base,
      counterpartyTx,
      status: 'SETTLEABLE',
      settleable: {
        counterparties: baseline.counterparties,
        participantCount: baseline.participantCount!,
        targetNetPay: baseline.targetNetPay!,
        receives: baseline.receives,
      },
    });
  }

  const state = predicateState(snapshot);
  // 3 and 4. Necessary conditions, in both directions: what you want, and what you offer.
  const supply = intent.exactCount > 0 ? supplyFunnel(intent, snapshot, state) : undefined;
  const demand = intent.offered.length > 0 ? demandCheck(intent, snapshot) : undefined;

  // 5. Single-condition relaxations. One change at a time, each re-run through the solver.
  //    exactCount and eventId are deliberately never relaxed: changing those changes what the
  //    participant asked for, and the honest answer is that what they asked for was not found.
  const relaxations: Relaxation[] = [];
  const cap = BigInt(Math.round(budgetCapUsdc())) * USDC;
  if (intent.maxNetPay < cap) {
    const raised = asRelaxation('maxNetPay->cap', await hypothetical({ maxNetPay: cap }));
    // The budget is only the reason if the settlement found actually costs more than the
    // committed limit permits. When it does not, what changed was how far the bounded search
    // got, not what the participant is willing to pay, and saying otherwise would hand a
    // judge a false cause.
    if (raised.found) {
      raised.binding = raised.targetNetPay !== null && BigInt(raised.targetNetPay) > intent.maxNetPay;
    }
    relaxations.push(raised);
  }
  if (intent.mustBeAdjacent) {
    relaxations.push(asRelaxation('mustBeAdjacent=false', await hypothetical({ mustBeAdjacent: false })));
  }
  if (intent.mustShareSection) {
    relaxations.push(asRelaxation('mustShareSection=false', await hypothetical({ mustShareSection: false })));
  }
  if (intent.mustShareSession) {
    relaxations.push(asRelaxation('mustShareSession=false', await hypothetical({ mustShareSession: false })));
  }
  const missing = missingClasses(intent, snapshot);
  for (const section of missing.sections) {
    relaxations.push(
      asRelaxation(`addSection=${section}`, await hypothetical({ sectionMask: intent.sectionMask | (1n << BigInt(section)) }))
    );
  }
  for (const session of missing.sessions) {
    relaxations.push(
      asRelaxation(`addSession=${session}`, await hypothetical({ sessionMask: intent.sessionMask | (1n << BigInt(session)) }))
    );
  }

  return done({ ...base, counterpartyTx, status: 'NOT_FOUND_WITHIN_BOUND', supply, demand, relaxations });
}

/** The relaxation a judge should be shown first: one that worked, cheapest for this owner. */
export function smallestWorkingChange(evidence: Evidence): Relaxation | null {
  const worked = evidence.relaxations.filter((r) => r.found && r.binding !== false);
  if (!worked.length) return null;
  // Among changes that produced a settlement, prefer the one costing this owner least. Stated
  // as "the smallest change among those tried" - never as optimal, and never as the only one.
  return worked.sort((a, b) => {
    const pay = (r: Relaxation) => (r.targetNetPay === null ? 0n : BigInt(r.targetNetPay));
    const diff = pay(a) - pay(b);
    return diff < 0n ? -1 : diff > 0n ? 1 : a.change.localeCompare(b.change);
  })[0];
}

export type { TicketMeta };
