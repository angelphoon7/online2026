import 'server-only';
import { erc20Abi, type Address, type Hex } from 'viem';
import { solve, hashIntent } from '../solver/dist/index.js';
import type { Intent, ChainState } from '../solver/src/types';
import type { Snapshot } from '@/shared/graph';
import { chainConfig } from './chain';
import { SEARCH_CONFIG } from './solve';
import type { RequestBudget } from './agent/request-budget';

// The solver's hypothetical mode — step 6-C of docs/RESHUFFLE_GRAPH_PLAN.md, used by the
// agent's what_if in step 7.
//
// What it answers: "if this participant had signed a different outcome, would a reshuffle
// exist in the pool as it stands at the snapshot block?"
//
// What it must never do: produce something submittable. A hypothetical intent is not
// committed and not LIVE on-chain, so no settlement containing it could execute — commit()
// authenticates the EIP-712 signature and V1 requires state == LIVE. The user would have to
// sign a new intent, and that is the only thing that makes this real.
//
// Enforced structurally rather than by convention:
//
//   - `submittable: false` is a literal type on the result, so no code path can hand this to
//     a settle flow and typecheck.
//   - Nothing here encodes calldata, simulates, or saves evidence with a proposal. The
//     frontend's settle path re-solves from committed hashes and uses that result only
//     (component/market/Market.tsx), so there is no channel for this to reach a transaction.
//
// Why it cannot reuse solveOnChain: that path binds every intent to the hash it is presented
// under and then filters on registry state being LIVE. A varied intent is neither committed
// nor LIVE, so it would be discarded and the function would return the unmodified result while
// appearing to have worked. ChainState is therefore assembled here from the snapshot, with the
// hypothetical marked LIVE deliberately and only in memory.

/** USDC balance and allowance per owner — V8 capacity, which the subgraph does not index. */
export type Capacity = {
  /** All balances and allowances were read at this exact block. */
  block: bigint;
  usdcBalance: Map<Address, bigint>;
  usdcAllowance: Map<Address, bigint>;
};

export class SnapshotCapacityMismatch extends Error {
  constructor(expected: bigint, actual: bigint) {
    super(`SnapshotCapacityMismatch: expected block ${expected}, received ${actual}`);
    this.name = 'SnapshotCapacityMismatch';
  }
}

export class SnapshotCapacityReadError extends Error {
  constructor(public block: bigint, cause: unknown) {
    super(`SnapshotCapacityReadError: USDC state at block ${block} could not be read. Retry this snapshot; latest state was not substituted.`, { cause });
    this.name = 'SnapshotCapacityReadError';
  }
}

export function requireCapacityBlock(capacity: Capacity, block: bigint): void {
  if (capacity.block !== block) throw new SnapshotCapacityMismatch(block, capacity.block);
}

/**
 * Read payment capacity for a set of owners.
 *
 * Separate from the search so step 7's diagnosis can read it once and reuse it across every
 * relaxation it tries, instead of re-reading the same balances for each one.
 */
export async function readCapacity(owners: Address[], block: bigint, budget?: RequestBudget): Promise<Capacity> {
  budget?.checkpoint();
  if (typeof block !== 'bigint' || block < 0n) throw new TypeError('An explicit snapshot block is required for USDC reads.');
  const { client, addresses, usdc } = chainConfig({ signal: budget?.signal });
  const usdcBalance = new Map<Address, bigint>();
  const usdcAllowance = new Map<Address, bigint>();
  try {
    for (const owner of [...new Set(owners.map((o) => o.toLowerCase() as Address))]) {
      budget?.checkpoint();
      const [balance, allowance] = await Promise.all([
        client.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [owner], blockNumber: block }),
        client.readContract({ address: usdc, abi: erc20Abi, functionName: 'allowance', args: [owner, addresses.Settlement], blockNumber: block }),
      ]);
      budget?.checkpoint();
      usdcBalance.set(owner, balance);
      usdcAllowance.set(owner, allowance);
    }
  } catch (error) {
    budget?.checkpoint();
    throw new SnapshotCapacityReadError(block, error);
  }
  return { block, usdcBalance, usdcAllowance };
}

export type Hypothetical = {
  /** The committed intent being replaced. Removed from the pool for this search. */
  replaceHash: Hex;
  /** The varied intent. Not committed anywhere; its hash exists only in this process. */
  intent: Intent;
};

export type HypotheticalResult = {
  /** Always false. The user would have to sign a new intent; nothing moves until they do. */
  submittable: false;
  found: boolean;
  /** The block the pool was read at. Every claim below holds at this block and no other. */
  snapshotBlock: string;
  bounds: typeof SEARCH_CONFIG;
  termination: 'complete' | 'timeout' | 'candidate-limit';
  /** Other participants in the reshuffle found, if one was. */
  counterparties: Address[];
  participantCount: number | null;
  /** Signed, in contract units: what the hypothetical owner would pay (+) or receive (-). */
  targetNetPay: string | null;
  /** Tickets the hypothetical owner would receive. */
  receives: string[];
  /** Gross cash moved by the chosen candidate — the published ranking objective. */
  gross: string | null;
  candidatesFound: number;
  candidatesExcluded: { intentHashes: Hex[]; reason: string }[];
  runtimeMs: number;
};

/**
 * Search the snapshot pool with one intent replaced by a hypothetical variation.
 *
 * Payment capacity is read from the chain, not the subgraph, which does not index the token.
 * Without it a relaxation could report a reshuffle that V8 would reject, which is exactly the
 * kind of promise-without-a-check this project refuses to make.
 */
export async function solveHypothetical(
  snapshot: Snapshot,
  { replaceHash, intent }: Hypothetical,
  capacity?: Capacity,
  budget?: RequestBudget
): Promise<HypotheticalResult> {
  await budget?.yield();
  const target = replaceHash.toLowerCase();
  const pool = snapshot.intents.filter((i) => i.hash.toLowerCase() !== target);
  const intents: Intent[] = [...pool, intent];

  if (intents.length > SEARCH_CONFIG.maxParticipants * 64) {
    throw new Error('Pool exceeds the hypothetical search limit; no partial pool was searched.');
  }

  const hypotheticalHash = hashIntent(intent);
  const intentState = new Map<Hex, number>();
  // Every intent in the snapshot is LIVE by construction (getPoolSnapshot filters on it) and
  // has already been re-hashed against its committed id there.
  for (const i of pool) intentState.set(i.hash, 1);
  // The one deliberate fiction, and the whole reason this result is not submittable.
  intentState.set(hypotheticalHash, 1);

  const funds = capacity ?? (await readCapacity(intents.map((i) => i.owner), snapshot.block, budget));
  budget?.checkpoint();
  requireCapacityBlock(funds, snapshot.block);
  const { usdcBalance, usdcAllowance } = funds;

  const state: ChainState = {
    ticketMeta: snapshot.ticketMeta,
    depositor: snapshot.depositor,
    intentState,
    usdcBalance,
    usdcAllowance,
    // The snapshot's block timestamp, so V1 expiry is judged at the block every other claim
    // in this result refers to.
    blockTimestamp: snapshot.timestamp,
  };

  const started = performance.now();
  // Ask the question that was actually asked: is there a reshuffle that includes THIS
  // participant? Without this the bound is spent on reshuffles between other people, and the
  // answer becomes "no settlement found" for almost everyone in a pool of any size.
  const result = solve(intents, state, { ...SEARCH_CONFIG,
    timeoutMs: Math.min(SEARCH_CONFIG.timeoutMs, budget?.remainingMs() ?? SEARCH_CONFIG.timeoutMs),
    mustInclude: hypotheticalHash });
  budget?.checkpoint();
  const runtimeMs = performance.now() - started;

  const chosen = result.chosen;
  const leg = chosen?.legs.find((l) => l.intentHash.toLowerCase() === hypotheticalHash.toLowerCase());
  // A candidate that does not include the hypothetical answers a different question: it says
  // some other participants could settle among themselves, not that this variation helps.
  const found = !!chosen && !!leg;

  return {
    submittable: false,
    found,
    snapshotBlock: snapshot.block.toString(),
    bounds: SEARCH_CONFIG,
    termination: result.evidence.search?.termination ?? 'complete',
    counterparties: found
      ? chosen!.intents
          .filter((i) => hashIntent(i).toLowerCase() !== hypotheticalHash.toLowerCase())
          .map((i) => i.owner.toLowerCase() as Address)
      : [],
    participantCount: found ? chosen!.intents.length : null,
    targetNetPay: leg ? leg.netPayment.toString() : null,
    receives: leg ? leg.receives.map((id) => id.toString()) : [],
    gross: found ? result.evidence.chosen?.gross ?? null : null,
    candidatesFound: result.evidence.candidatesFound,
    candidatesExcluded: result.evidence.candidatesExcluded,
    runtimeMs,
  };
}
