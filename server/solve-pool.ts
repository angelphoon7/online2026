import 'server-only';
import { hashIntent } from '../solver/dist/index.js';
import type { Intent } from '../solver/src/types';
import type { Hex } from 'viem';
import { restoreIntent, type MarketSnapshot } from '../lib/market-types';
import { marketSnapshot, readSource } from './market';
import { solveLivePoolFromGraph } from './solve-graph';
import { chainConfig } from './chain';
import { solveOnChain } from './solve';

// Explicit resource guard: never silently select a prefix of an oversized pool.
export const MAX_POOL_INTENTS = 256;
export async function solvePoolSnapshot(snapshot: MarketSnapshot) {
  const live = snapshot.intents.filter(i => i.eventId === 1 && i.state === 1 && !i.expired);
  if (live.length > MAX_POOL_INTENTS) throw new Error('Live pool exceeds the 256-intent service limit. No partial pool was searched.');
  const committed = new Map<Hex, Intent>();
  const excluded: { intentHashes: Hex[]; reason: string }[] = [];
  for (const record of live) {
    const intent = restoreIntent(record);
    if (hashIntent(intent) !== record.hash) throw new Error('Committed intent hash mismatch');
    if (intent.offered.length > 4 || intent.exactCount > 4) {
      excluded.push({ intentHashes: [record.hash], reason: 'Search bound: at most four offered/received tickets per intent' });
    } else committed.set(record.hash, intent);
  }
  // Full live pool, sorted independently of the viewing wallet or UI checkboxes.
  // Current registry state, custody and payment capacity are re-read before search.
  return solveOnChain([...committed.keys()].sort(), committed, { liveIntents: live.length, excluded });
}

let cached: { key: string; until: number; result: Awaited<ReturnType<typeof solvePoolSnapshot>> } | undefined;
let pending: { key: string; result: Promise<Awaited<ReturnType<typeof solvePoolSnapshot>>> } | undefined;
export async function solveLivePool() {
  // Prefer subgraph discovery: it carries a snapshot block and named exclusions, both of
  // which land in the evidence. The MarketSnapshot path stays for local Anvil.
  if (readSource() === 'graph') return solveLivePoolFromGraph();
  const snapshot = await marketSnapshot();
  const { addresses } = chainConfig();
  const key = `${addresses.IntentRegistry}:${snapshot.blockNumber}:${snapshot.intents.map(i => `${i.hash}:${i.state}:${i.expired}`).sort().join(',')}`;
  if (cached?.key === key && cached.until > Date.now()) return cached.result;
  if (pending?.key === key) return pending.result;
  const result = solvePoolSnapshot(snapshot).then(value => {
    cached = { key, until: Date.now() + 30000, result: value };
    return value;
  }).finally(() => { if (pending?.key === key) pending = undefined; });
  pending = { key, result };
  return result;
}
