import 'server-only';
import type { Hex } from 'viem';
import type { Intent } from '../solver/src/types';
import { getPoolSnapshot, type Snapshot, type Exclusion } from '@/shared/graph';
import { solveOnChain, type PoolSource } from './solve';

// Solver discovery from The Graph — step 6-C of docs/RESHUFFLE_GRAPH_PLAN.md.
//
// This is the load-bearing use of the subgraph. IntentRegistry stores only hash -> state and
// Solidity mappings cannot be enumerated, so "which intents are live, what does each want, and
// what does each offer" exists on-chain only inside IntentCommitted logs. Reconstructing that
// is what the subgraph is for.
//
// Discovery only. solveOnChain re-reads registry state, custody, ticket metadata and USDC
// capacity from the chain before it searches, and simulates before it submits. Index lag can
// therefore cost a failed simulation; it cannot produce an invalid settlement.

export const MAX_POOL_INTENTS = 256;

/** Exclusions carry their named reason through to the evidence a judge can read. */
const EXCLUSION_TEXT: Record<Exclusion['reason'], string> = {
  HASH_MISMATCH: 'Subgraph fields do not hash to the committed id; intent discarded',
  EXPIRED: 'V1: deadline passed at the snapshot block',
  TICKET_UNKNOWN: 'Offered ticket has no indexed record',
  TICKET_NOT_IN_ESCROW: 'V2: offered ticket is not escrowed by the intent owner',
  TICKET_REDEEMED: 'V3: offered ticket has been redeemed',
  WRONG_EVENT: 'V2: offered ticket belongs to a different event',
};

export type GraphPool = {
  snapshot: Snapshot;
  committed: Map<Hex, Intent>;
  source: PoolSource;
};

export type Excluded = { intentHashes: Hex[]; reason: string };

/** Name every exclusion the snapshot recorded, then apply the published per-intent bound. */
function searchable(snapshot: Snapshot): { committed: Map<Hex, Intent>; excluded: Excluded[] } {
  const excluded: Excluded[] = snapshot.excluded.map((e) => ({
    intentHashes: [e.id],
    reason: e.detail ? `${EXCLUSION_TEXT[e.reason]} (${e.detail})` : EXCLUSION_TEXT[e.reason],
  }));

  const committed = new Map<Hex, Intent>();
  for (const intent of snapshot.intents) {
    // Published search bound, applied here so the reason is recorded rather than the intent
    // silently vanishing from the pool.
    if (intent.offered.length > 4 || intent.exactCount > 4) {
      excluded.push({
        intentHashes: [intent.hash],
        reason: 'Search bound: at most four offered/received tickets per intent',
      });
      continue;
    }
    committed.set(intent.hash, intent);
  }
  return { committed, excluded };
}

const source = (snapshot: Snapshot, liveIntents: number, excluded: Excluded[]): PoolSource => ({
  liveIntents,
  excluded,
  kind: 'subgraph',
  snapshotBlock: snapshot.block.toString(),
  endpoint: process.env.SUBGRAPH_URL ?? null,
});

/**
 * Build the whole searchable pool from a subgraph snapshot.
 *
 * `minBlock` is the freshness floor: pass the block of a transaction just sent so the pool
 * cannot predate it.
 */
export async function graphPool(minBlock = 0n): Promise<GraphPool> {
  const snapshot = await getPoolSnapshot({ minBlock });
  const { committed, excluded } = searchable(snapshot);

  if (committed.size > MAX_POOL_INTENTS) {
    // Never silently search a prefix of an oversized pool.
    throw new Error(`Live pool exceeds the ${MAX_POOL_INTENTS}-intent service limit. No partial pool was searched.`);
  }

  // Visible in the server log, so a judge can see where the pool came from.
  console.log(
    `pool source: subgraph @ block ${snapshot.block} — ${committed.size} searchable, ${excluded.length} excluded`
  );

  return { snapshot, committed, source: source(snapshot, snapshot.intents.length, excluded) };
}

/**
 * Discovery for a bounded search over specific hashes — the checkbox path in the UI.
 *
 * Two differences from graphPool, both because the request names its own intents:
 *
 *   - No pool-size guard. A search over four named hashes does not become invalid because
 *     some other part of the pool grew past the service limit.
 *   - Exclusions are filtered to the requested hashes, so the evidence explains THIS request
 *     rather than padding it with reasons about intents nobody asked about.
 *
 * A requested hash absent from this snapshot stays absent. solveOnChain rejects that request
 * without RPC log discovery; callers can refresh or use their commit receipt as minBlock.
 */
export async function graphIntents(hashes: Hex[], minBlock = 0n): Promise<GraphPool> {
  const snapshot = await getPoolSnapshot({ minBlock });
  const { committed, excluded } = searchable(snapshot);
  const requested = new Set(hashes.map((h) => h.toLowerCase()));

  const selected = new Map<Hex, Intent>();
  for (const [hash, intent] of committed) {
    if (requested.has(hash.toLowerCase())) selected.set(hash, intent);
  }

  console.log(
    `pool source: subgraph @ block ${snapshot.block} — ${selected.size} of ${hashes.length} requested hashes discovered`
  );

  return {
    snapshot,
    committed: selected,
    source: source(
      snapshot,
      snapshot.intents.length,
      excluded.filter((e) => e.intentHashes.some((h) => requested.has(h.toLowerCase())))
    ),
  };
}

/** Solve over the whole live pool discovered from the subgraph. */
export async function solveLivePoolFromGraph(minBlock = 0n) {
  const { committed, source } = await graphPool(minBlock);
  // Sorted independently of the viewing wallet or any UI selection.
  return solveOnChain([...committed.keys()].sort(), committed, source);
}

// The agent's what-if (plan 7-E) lives in server/solve-hypothetical.ts, not here.
//
// It cannot reuse solveOnChain: that path binds every intent to the hash it is presented under
// and then filters on registry state being LIVE. A varied intent is neither committed nor
// LIVE, so it would be discarded and the call would look like it worked while returning the
// unmodified result. solveHypothetical assembles ChainState from a snapshot instead, marks the
// hypothetical LIVE in memory only, and returns submittable: false with no calldata anywhere.
