import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketFreshness } from '../../lib/market-freshness';
import { getMarketSnapshot } from '../../lib/market-snapshot';
import type { MarketSnapshot } from '../../lib/market-types';
import { SubgraphLagTimeout } from '../../shared/graph/wait';
import { marketSnapshotFromGraph } from '../market-graph';

const snapshot = (block: bigint): MarketSnapshot => ({ blockNumber: String(block), source: 'graph', timestamp: '1789232809', tickets: [], intents: [], settlements: [], defaultHashes: [], hashMismatched: [] });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('timeout retains receipt floor; retry, periodic and reconnect reads use that floor', async () => {
  const reads: bigint[] = [], waits: bigint[] = []; let fail = true;
  const state = new MarketFreshness(async (_, floor) => { reads.push(floor); return snapshot(floor); }, async floor => { waits.push(floor); if (fail) throw new SubgraphLagTimeout(floor, 9n, 90); });
  state.requireBlock(10n);
  assert.equal(await state.refresh(), false); assert.deepEqual(reads, []);
  assert.equal(state.getSnapshot().floor, 10n); assert.equal(state.getSnapshot().indexingBlock, 10n);
  assert.match(state.getSnapshot().error, /^SubgraphLagTimeout:/);
  fail = false; assert.equal(await state.refresh(true), true);
  assert.deepEqual(waits, [10n, 10n]); assert.equal(state.getSnapshot().indexingBlock, null);
  await state.refresh(); assert.deepEqual(reads, [10n, 10n]);
});
test('pre-transaction response cannot overwrite post-transaction pool', async () => {
  const old = deferred<MarketSnapshot>();
  const state = new MarketFreshness(async (_, floor) => floor === 0n ? old.promise : snapshot(floor), async () => {});
  const previous = state.refresh(); state.requireBlock(20n); await state.refresh(true);
  old.resolve(snapshot(19n)); assert.equal(await previous, false);
  assert.equal(state.getSnapshot().market?.blockNumber, '20');
});
test('overlapping receipts and stale wait errors never lower or clear the new floor', async () => {
  const old = deferred<void>();
  const state = new MarketFreshness(async (_, floor) => snapshot(floor), async floor => { if (floor === 20n) await old.promise; });
  state.requireBlock(20n); const previous = state.refresh();
  state.requireBlock(30n); state.requireBlock(25n);
  old.reject(new Error('Old wait failed')); await previous;
  assert.equal(state.getSnapshot().floor, 30n); assert.equal(state.getSnapshot().indexingBlock, 30n); assert.equal(state.getSnapshot().error, '');
  await state.refresh(); assert.equal(state.getSnapshot().market?.blockNumber, '30');
});
test('successful meta wait does not permit an old entity snapshot', async () => {
  const state = new MarketFreshness(async () => snapshot(9n), async () => 10n);
  state.requireBlock(10n); assert.equal(await state.refresh(), false);
  assert.equal(state.getSnapshot().indexingBlock, 10n); assert.match(state.getSnapshot().error, /^SnapshotTooOld:/);
});
test('agent rejects old revisions, pending indexing and responses below receipt floor', async () => {
  const state = new MarketFreshness(async (_, floor) => snapshot(floor), async () => {});
  const old = state.getSnapshot().revision; state.requireBlock(10n);
  const current = state.getSnapshot().revision;
  assert.equal(state.canAnswer(old, '10'), false); assert.equal(state.canAnswer(current, '10'), false);
  await state.refresh(); assert.equal(state.canAnswer(current, '9'), false); assert.equal(state.canAnswer(current, '10'), true);
});
test('coalescing never shares an unfloored fetch with a higher-floor request', async t => {
  const old = deferred<Response>(), newer = deferred<Response>(); const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => { urls.push(url); return url.includes('minBlock=10') ? newer.promise : old.promise; });
  const a = getMarketSnapshot(false, 0n), b = getMarketSnapshot(false, 10n);
  assert.equal(getMarketSnapshot(false, 10n), b); assert.equal(urls.length, 2);
  newer.resolve(Response.json(snapshot(10n))); assert.equal((await b).blockNumber, '10');
  old.resolve(Response.json(snapshot(9n))); await a;
});
test('frontend rejects HTTP 200 with a market below its requested floor', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(snapshot(9n)));
  await assert.rejects(getMarketSnapshot(true, 10n), { name: 'SnapshotTooOld' });
});
test('market Graph query floors all roots and rejects a stale successful response', async t => {
  const before = process.env.SUBGRAPH_URL; process.env.SUBGRAPH_URL = 'https://fixture.invalid';
  t.after(() => { if (before === undefined) delete process.env.SUBGRAPH_URL; else process.env.SUBGRAPH_URL = before; });
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const request = JSON.parse(init.body as string); assert.deepEqual(request.variables.at, { number_gte: 10 });
    assert.equal((request.query.match(/block: \$at/g) ?? []).length, 4);
    return Response.json({ data: { _meta: { deployment: 'QmFixture', hasIndexingErrors: false, block: { number: 9, timestamp: '1789232809' } }, intents: [], tickets: [], settlements: [] } });
  });
  await assert.rejects(marketSnapshotFromGraph(10n), { name: 'SubgraphLagError' });
});
