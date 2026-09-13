import 'server-only';
import type { Hex } from 'viem';
import initial from '@/deployments/circle-inventory-sep12.json';
import { DEPLOYMENT } from '@/lib/deployment';
import { getPoolSnapshot, type Snapshot } from '@/shared/graph';
import { durableStore, readRecord, type DurableStore } from './durable-store';
import { chainConfig } from './chain';
import { readSource } from './market';

export type DemoCatalog = { batch: string; chainId: number; registry: string; groups: { name: string; hashes: Hex[] }[] };
export const catalogKey = `demo-catalog:${DEPLOYMENT.chainId}:${DEPLOYMENT.intentRegistry}`;
export function validateCatalog(value: unknown): DemoCatalog {
  const v = value as DemoCatalog;
  if (!v || !/^[a-z0-9-]{1,40}$/.test(v.batch) || v.chainId !== DEPLOYMENT.chainId || v.registry?.toLowerCase() !== DEPLOYMENT.intentRegistry || !Array.isArray(v.groups) || v.groups.length < 1 || v.groups.length > 16) throw new Error('Demo catalog does not match this deployment');
  const names = new Set<string>();
  for (const group of v.groups) {
    if (!/^[a-z0-9-]{1,40}$/.test(group.name) || names.has(group.name) || !Array.isArray(group.hashes) || group.hashes.length !== 3 || group.hashes.some(h => !/^0x[0-9a-f]{64}$/i.test(h)) || new Set(group.hashes.map(h => h.toLowerCase())).size !== 3) throw new Error('Invalid three-participant demo group');
    names.add(group.name);
  }
  return v;
}
export async function demoCatalog(store: DurableStore = durableStore()): Promise<DemoCatalog> {
  return validateCatalog(await readRecord(catalogKey, store) ?? { batch: initial.batch, chainId: initial.chainId, registry: initial.contracts.IntentRegistry, groups: initial.groups.map(g => ({ name: g.name, hashes: g.intents.map(i => i.hash) })) });
}
const replacementKey = (hash: string) => `demo-replacement:${DEPLOYMENT.chainId}:${DEPLOYMENT.intentRegistry}:${hash.toLowerCase()}`;
export async function followDemoHash(hash: Hex, store: DurableStore = durableStore()): Promise<Hex> {
  let current = hash.toLowerCase() as Hex;
  for (let i = 0; i < 64; i++) {
    const next = await store.get(replacementKey(current));
    if (next === null) return current;
    if (!/^0x[0-9a-f]{64}$/i.test(next)) throw new Error('Invalid demo replacement');
    current = next as Hex;
  }
  throw new Error('Demo replacement history exceeds the supported limit');
}
export async function saveDemoReplacement(oldHash: Hex, newHash: Hex, store: DurableStore = durableStore()) {
  const key = replacementKey(oldHash), previous = await store.get(key);
  if (previous === newHash) return;
  if (previous !== null || !await store.compareAndSet(key, null, newHash)) throw new Error('Could not save demo replacement');
}
export function describeGroups(catalog: DemoCatalog, snapshot: Snapshot, chainTimestamp: bigint) {
  const live = new Map(snapshot.intents.map(i => [i.hash.toLowerCase(), i]));
  return catalog.groups.map(group => {
    const intents = group.hashes.map(hash => live.get(hash.toLowerCase()));
    const issues = group.hashes.flatMap((hash, index) => {
      const intent = intents[index];
      if (intent && intent.deadline >= chainTimestamp) return [];
      return [{ hash, reason: intent ? 'EXPIRED' : snapshot.excluded.find(e => e.id.toLowerCase() === hash.toLowerCase())?.reason ?? 'NOT_IN_LIVE_POOL' }];
    });
    const owners = new Set(intents.filter(i => !!i).map(i => i!.owner.toLowerCase()));
    if (intents.every(i => !!i) && owners.size !== 3) issues.push({ hash: group.hashes[0], reason: 'REQUIRES_THREE_DISTINCT_USERS' });
    const deadlines = intents.flatMap(i => i ? [i.deadline] : []);
    return { name: group.name, hashes: group.hashes, available: issues.length === 0, issues, counts: intents.map(i => i?.exactCount ?? null), expiresAt: deadlines.length === 3 ? String(deadlines.reduce((a, b) => a < b ? a : b)) : null };
  });
}
export async function judgingStatus(minBlock = 0n) {
  if (readSource() !== 'graph') throw new Error('Judging requires live Graph discovery');
  const catalog = await demoCatalog();
  catalog.groups = await Promise.all(catalog.groups.map(async g => ({ ...g, hashes: await Promise.all(g.hashes.map(h => followDemoHash(h))) })));
  const { client } = chainConfig();
  const [snapshot, block, chainId] = await Promise.all([getPoolSnapshot({ minBlock }), client.getBlock(), client.getChainId()]);
  if (chainId !== DEPLOYMENT.chainId) throw new Error('RPC deployment mismatch');
  const groups = describeGroups(catalog, snapshot, block.timestamp);
  const lagSeconds = Number(block.timestamp > snapshot.timestamp ? block.timestamp - snapshot.timestamp : 0n);
  return { batch: catalog.batch, chainId, source: 'subgraph', snapshotBlock: String(snapshot.block), chainBlock: String(block.number), lagSeconds, groups };
}
