// The pool snapshot — step 5-D of docs/RESHUFFLE_GRAPH_PLAN.md.
//
// This is where the subgraph becomes solver input, and where trust rules 1 and 2 are enforced:
//
//   Rule 1, hash binding. Every intent is re-hashed with the same hashIntent() used for
//   signing and must equal the id it was published under. The registry keys on the bare struct
//   hash, so this binds all twelve signed fields at once — a mapping bug or a decoding error
//   cannot produce a plausible-but-wrong intent, it produces a mismatch. Verified across 121
//   live intents; see docs/graph-acceptance.md.
//
//   Rule 2, freshness floor. `minBlock` is passed into the query, so graph-node rejects rather
//   than answering from an older block.
//
// It also mirrors Settlement's V1-V3 so the solver is not handed intents the contract will
// certainly reject. Every exclusion is NAMED and kept: the names are the agent's diagnosis in
// step 7, so "why can't this settle" is answered from a recorded reason rather than inferred.
//
// What this does NOT provide: USDC balances and allowances. The subgraph does not index the
// token, so V8 payment capacity cannot be discovered here. That is by design — the snapshot is
// DISCOVERY. Registry state, custody and payment capacity are re-read from the chain before a
// proposal is submitted (server/solve.ts), which is what makes index lag cause a failed
// simulation rather than an invalid settlement.

import { gql, SubgraphIndexingError, SubgraphLagError, type GqlOptions } from './client';
import { POOL_SNAPSHOT, INTENT_BY_ID } from './queries';
import { readGraphPages, SubgraphPaginationError, type GraphPageMeta, type GraphPageOptions } from './pages';
import { fromGraph, hashIntent, sameAddress, type GraphIntent } from '../intent';
import type { Intent, TicketMeta, Hex, Address } from '../intent';

/** Why an intent was kept out of the pool. Each mirrors a check the contract performs. */
export type ExclusionReason =
  /** Subgraph fields do not hash to the committed id. Trust rule 1. */
  | 'HASH_MISMATCH'
  /** deadline passed at the snapshot block. Mirrors V1. */
  | 'EXPIRED'
  /** An offered id has no Ticket entity at all. */
  | 'TICKET_UNKNOWN'
  /** An offered ticket is not escrowed by this intent's owner right now. Mirrors V2. */
  | 'TICKET_NOT_IN_ESCROW'
  /** An offered ticket has been redeemed. Mirrors V3. */
  | 'TICKET_REDEEMED'
  /** Offered ticket belongs to a different event than the intent. Mirrors V2. */
  | 'WRONG_EVENT';

export type Exclusion = {
  id: Hex;
  owner?: Address;
  reason: ExclusionReason;
  detail?: string;
};

/** A live intent, carrying the hash it is bound to and where it was committed. */
export type LiveIntent = Intent & {
  hash: Hex;
  committedTx: string;
  committedAtBlock: bigint;
};

export type Snapshot = {
  /** Every page was read at this block, with matching deployment and timestamp. */
  block: bigint;
  timestamp: bigint;
  deployment: string;
  /** Solver-shaped, so ChainState can be assembled without reshaping. */
  intents: LiveIntent[];
  ticketMeta: Map<bigint, TicketMeta>;
  depositor: Map<bigint, Address>;
  /** Kept, not discarded: these become the agent's named diagnoses in step 7. */
  excluded: Exclusion[];
};

export type SnapshotOptions = GraphPageOptions & {
  /** Compatibility alias for pageSize; this is a page size, never a total-result cap. */
  first?: number;
};

type PoolResponse = {
  _meta: GraphPageMeta;
  intents: (GraphIntent & {
    committedAtBlock: string;
    committedTx: string;
    offeredTickets: { id: string; escrowed: boolean; depositor: string | null; redeemed: boolean }[];
  })[];
  tickets: {
    id: string;
    eventId: number;
    sessionId: number;
    sectionId: number;
    row: number;
    seat: number;
    depositor: string | null;
    redeemed: boolean;
  }[];
};

export async function getPoolSnapshot(options: SnapshotOptions = {}): Promise<Snapshot> {
  const minBlock = options.minBlock ?? 0n;
  const data = await readGraphPages<PoolResponse>(POOL_SNAPSHOT, { intents: '0x', tickets: '' },
    { ...options, pageSize: options.pageSize ?? options.first });

  // A mapping failure means the entities are not trustworthy; do not quietly solve on them.
  if (data._meta.hasIndexingErrors) throw new SubgraphIndexingError();

  const block = BigInt(data._meta.block.number);
  if (block < minBlock) throw new SubgraphLagError(`SubgraphLagError: indexed ${block}, required ${minBlock}`, block);
  const timestamp = BigInt(data._meta.block.timestamp);

  const ticketMeta = new Map<bigint, TicketMeta>();
  const depositor = new Map<bigint, Address>();
  for (const t of data.tickets) {
    const tokenId = BigInt(t.id);
    ticketMeta.set(tokenId, {
      eventId: Number(t.eventId),
      sessionId: Number(t.sessionId),
      sectionId: Number(t.sectionId),
      row: Number(t.row),
      seat: Number(t.seat),
      status: t.redeemed ? 1 : 0,
    });
    if (t.depositor) depositor.set(tokenId, t.depositor.toLowerCase() as Address);
  }

  const intents: LiveIntent[] = [];
  const excluded: Exclusion[] = [];

  // Preserve the prior discovery order after cursor pagination, with a deterministic tie.
  data.intents.sort((a, b) => BigInt(a.committedAtBlock) < BigInt(b.committedAtBlock) ? -1
    : BigInt(a.committedAtBlock) > BigInt(b.committedAtBlock) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const g of data.intents) {
    const id = g.id as Hex;
    const owner = g.owner.toLowerCase() as Address;
    const intent = fromGraph(g);

    // Rule 1 first: until the hash binds, no other field is worth reading.
    if (hashIntent(intent) !== id) {
      excluded.push({ id, owner, reason: 'HASH_MISMATCH' });
      continue;
    }

    // V1. Strictly greater: a deadline equal to the block timestamp has not passed, which is
    // how Settlement compares it.
    if (timestamp > intent.deadline) {
      excluded.push({
        id,
        owner,
        reason: 'EXPIRED',
        detail: `deadline ${intent.deadline} < block ${timestamp}`,
      });
      continue;
    }

    // The nested list is the authority on custody; a short list means a ticket entity is
    // missing entirely, which would otherwise look like "not escrowed".
    if (g.offeredTickets.length >= 1000 && g.offeredTickets.length < g.offered.length) {
      throw new SubgraphPaginationError('offered ticket relations reached their nested query limit');
    }
    if (g.offeredTickets.length !== g.offered.length) {
      const known = new Set(g.offeredTickets.map((t) => t.id));
      const missing = g.offered.filter((id) => !known.has(id));
      excluded.push({ id, owner, reason: 'TICKET_UNKNOWN', detail: `ticket ${missing.join(', ')}` });
      continue;
    }

    // V3 before V2: a redeemed ticket is a more specific fact than a custody failure, and it
    // makes the better explanation.
    const redeemed = g.offeredTickets.find((t) => t.redeemed);
    if (redeemed) {
      excluded.push({ id, owner, reason: 'TICKET_REDEEMED', detail: `ticket ${redeemed.id}` });
      continue;
    }

    // V2. Escrowed is not enough — it must be escrowed BY THIS OWNER, or the settlement is
    // spending someone else's ticket.
    const notHeld = g.offeredTickets.find(
      (t) => !t.escrowed || !sameAddress(t.depositor, owner)
    );
    if (notHeld) {
      excluded.push({
        id,
        owner,
        reason: 'TICKET_NOT_IN_ESCROW',
        detail: notHeld.escrowed
          ? `ticket ${notHeld.id} is escrowed by ${notHeld.depositor}, not ${owner}`
          : `ticket ${notHeld.id} is not in escrow`,
      });
      continue;
    }

    // V2 also binds the event: clearing happens within one event, so eventId is the market.
    const wrongEvent = g.offered.find((tokenId) => {
      const meta = ticketMeta.get(BigInt(tokenId));
      return meta !== undefined && meta.eventId !== intent.eventId;
    });
    if (wrongEvent !== undefined) {
      excluded.push({
        id,
        owner,
        reason: 'WRONG_EVENT',
        detail: `ticket ${wrongEvent} is event ${ticketMeta.get(BigInt(wrongEvent))?.eventId}, intent is event ${intent.eventId}`,
      });
      continue;
    }

    intents.push({
      ...intent,
      hash: id,
      committedTx: g.committedTx,
      committedAtBlock: BigInt(g.committedAtBlock),
    });
  }

  return {
    block,
    timestamp,
    deployment: data._meta.deployment,
    intents,
    ticketMeta,
    depositor,
    excluded,
  };
}

/** Group exclusions by reason — the shape the agent and the UI both want. */
export function exclusionsByReason(snapshot: Snapshot): Record<string, Exclusion[]> {
  const grouped: Record<string, Exclusion[]> = {};
  for (const exclusion of snapshot.excluded) {
    (grouped[exclusion.reason] ??= []).push(exclusion);
  }
  return grouped;
}

export type IntentStatus = {
  id: Hex;
  state: 'LIVE' | 'REVOKED' | 'SETTLED';
  committedTx: string;
  closedTx: string | null;
  closedAtBlock: string | null;
  settlement: { id: string; txHash: string; blockNumber: string; participantCount: string } | null;
};

export class IntentSnapshotMismatch extends Error {
  constructor(detail: string) {
    super(`IntentSnapshotMismatch: ${detail}`);
    this.name = 'IntentSnapshotMismatch';
  }
}

/**
 * Look up one intent regardless of state.
 *
 * Needed because the pool snapshot only carries LIVE intents: an intent the user asks about may
 * have been revoked or settled, and that — with its transaction hash — is the answer.
 * The snapshot is mandatory: historical state is checked at its exact block and deployment.
 */
export async function getIntentById(
  id: Hex,
  snapshot: Pick<Snapshot, 'block' | 'deployment'>,
  options: GqlOptions = {}
): Promise<IntentStatus | null> {
  const data = await gql<{
    _meta: { block: { number: number }; deployment: string; hasIndexingErrors: boolean };
    intent: IntentStatus | null;
  }>(INTENT_BY_ID, { id: id.toLowerCase(), block: Number(snapshot.block) }, options);
  if (data._meta.hasIndexingErrors) throw new SubgraphIndexingError();
  if (BigInt(data._meta.block.number) !== snapshot.block || data._meta.deployment !== snapshot.deployment) {
    throw new IntentSnapshotMismatch(`lookup must use deployment ${snapshot.deployment} at block ${snapshot.block}`);
  }
  if (data.intent && (
    data.intent.id.toLowerCase() !== id.toLowerCase() ||
    (data.intent.closedAtBlock !== null && BigInt(data.intent.closedAtBlock) > snapshot.block)
  )) throw new IntentSnapshotMismatch('returned intent does not belong to the requested snapshot');
  return data.intent;
}
