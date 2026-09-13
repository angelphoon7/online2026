import type { MarketSnapshot } from './market-types';
import { requireSnapshotBlock } from './market-freshness';
import { retryAfterSeconds } from '../shared/retry-after';

// Coalesce only equivalent reads. A higher floor must never reuse an earlier unfloored call.
const pending = new Map<string, Promise<MarketSnapshot>>();
let retryAt = 0;
export function getMarketSnapshot(fresh = false, minBlock = 0n): Promise<MarketSnapshot> {
  if (retryAt > Date.now()) return Promise.reject(new Error(`Live market data is rate-limited. Retry in at least ${Math.ceil((retryAt - Date.now()) / 1000)} seconds.`));
  const key = `${fresh}:${minBlock}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const query = new URLSearchParams({ minBlock: minBlock.toString() });
  if (fresh) query.set('fresh', '1');
  const request = (async () => {
    const response = await fetch(`/api/market?${query}`, { cache: 'no-store' });
    if (response.status === 429) retryAt = Date.now() + retryAfterSeconds(response.headers.get('Retry-After')) * 1000;
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Public chain reads unavailable');
    requireSnapshotBlock(body.blockNumber, minBlock);
    return body as MarketSnapshot;
  })().finally(() => { if (pending.get(key) === request) pending.delete(key); });
  pending.set(key, request);
  return request;
}
