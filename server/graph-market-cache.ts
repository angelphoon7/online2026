import 'server-only';
import type { MarketSnapshot } from '@/lib/market-types';
import { requireSnapshotBlock } from '@/lib/market-freshness';

export const GRAPH_MARKET_CACHE_MS = 45_000;
// How long a failed read may keep answering from the last good snapshot. The Studio
// development endpoint allows 3,000 queries a day and returns 429 for the rest of the day
// once that is spent, so a throttled indexer is a condition to survive rather than a crash:
// serving the last indexed block, labelled with that block, keeps every displayed number
// traceable to chain state. Beyond this window the read fails instead.
export const GRAPH_MARKET_STALE_MS = 10 * 60_000;
type Read = (minBlock: bigint, signal: AbortSignal) => Promise<MarketSnapshot>;
type Pending = { controller: AbortController; promise: Promise<MarketSnapshot>; readers: number };

// Share complete public snapshots within one server process. A receipt's minimum block
// always wins over the TTL, and explicit fresh reads bypass completed cache entries.
export function createGraphMarketCache(load: Read, now = Date.now) {
  let cached: { value: MarketSnapshot; expires: number; at: number } | undefined;

  // The last snapshot that was actually read, when the indexer cannot be reached now. Only
  // offered if it still satisfies the caller's freshness floor: a receipt's minimum block is
  // a correctness requirement, and answering it with older data would break trust rule 2.
  const lastGood = (minBlock: bigint, reason: string): MarketSnapshot | null => {
    if (!cached) return null;
    const age = now() - cached.at;
    if (age > GRAPH_MARKET_STALE_MS) return null;
    if (BigInt(cached.value.blockNumber) < minBlock) return null;
    return { ...structuredClone(cached.value), stale: { reason, ageMs: age } };
  };
  const pending = new Map<string, Pending>();
  return function read(fresh = false, minBlock = 0n, signal?: AbortSignal): Promise<MarketSnapshot> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (!fresh && cached && cached.expires > now() && BigInt(cached.value.blockNumber) >= minBlock) {
      return Promise.resolve(structuredClone(cached.value));
    }
    const key = minBlock.toString();
    let entry = pending.get(key);
    if (!entry) {
      const controller = new AbortController();
      const created: Pending = { controller, readers: 0, promise: undefined! };
      created.promise = Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return load(minBlock, controller.signal);
      }).then(value => {
        requireSnapshotBlock(value.blockNumber, minBlock);
        if (!controller.signal.aborted && (!cached || BigInt(value.blockNumber) >= BigInt(cached.value.blockNumber))) {
          cached = { value: structuredClone(value), expires: now() + GRAPH_MARKET_CACHE_MS, at: now() };
        }
        return value;
      }).catch((error: unknown) => {
        // An aborted read is the caller leaving, not the indexer failing.
        if (controller.signal.aborted) throw error;
        const fallback = lastGood(minBlock, error instanceof Error ? error.message : 'indexer unavailable');
        if (!fallback) throw error;
        return fallback;
      }).finally(() => { if (pending.get(key) === created) pending.delete(key); });
      pending.set(key, created);
      entry = created;
    }
    const current = entry;
    current.readers++;
    return new Promise((resolve, reject) => {
      let finished = false;
      const cleanup = () => { finished = true; signal?.removeEventListener('abort', abort); current.readers--; };
      const abort = () => {
        if (finished) return;
        cleanup(); reject(signal!.reason);
        // Closing one browser must not cancel another browser's shared read.
        if (!current.readers) {
          if (pending.get(key) === current) pending.delete(key);
          current.controller.abort(signal!.reason);
        }
      };
      signal?.addEventListener('abort', abort, { once: true });
      current.promise.then(value => {
        if (!finished) { cleanup(); resolve(structuredClone(value)); }
      }, error => {
        if (!finished) { cleanup(); reject(error); }
      });
      if (signal?.aborted) abort();
    });
  };
}
