import 'server-only';
import { createHash } from 'node:crypto';
import type { Address } from 'viem';
import { durableStore, encodeRecord, type DurableStore } from './durable-store';

type Challenge = { recipient: Address; expires: number };
const key = (message: string) => `claim-challenge:${createHash('sha256').update(message).digest('hex')}`;
export async function saveChallenge(message: string, value: Challenge, store: DurableStore = durableStore()) {
  if (!await store.compareAndSet(key(message), null, encodeRecord(value), { ttlMs: 300_000 })) throw new Error('Challenge collision');
}
export async function readChallenge(message: string, store: DurableStore = durableStore()) {
  const raw = await store.get(key(message));
  const value: Challenge | null = raw === null ? null : JSON.parse(raw);
  return value && value.expires > Date.now() ? { value, raw: raw! } : null;
}
export function consumeChallenge(message: string, raw: string, store: DurableStore = durableStore()) {
  return store.compareAndSet(key(message), raw, null);
}
