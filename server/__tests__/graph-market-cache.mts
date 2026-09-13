import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraphMarketCache, GRAPH_MARKET_CACHE_MS, GRAPH_MARKET_STALE_MS } from '../graph-market-cache';
import type { MarketSnapshot } from '../../lib/market-types';

const snapshot = (block: bigint): MarketSnapshot => ({ blockNumber: String(block), timestamp: '100', source: 'graph', tickets: [], intents: [], settlements: [], defaultHashes: [], hashMismatched: [] });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('concurrent visitors share one Graph read and receive independent snapshots', async () => {
  const result = deferred<MarketSnapshot>(); let calls = 0;
  const read = createGraphMarketCache(async () => { calls++; return result.promise; });
  const a = read(), b = read(true); await Promise.resolve(); assert.equal(calls, 1);
  result.resolve(snapshot(100n)); const [first, second] = await Promise.all([a, b]);
  first.blockNumber = '0'; assert.equal(second.blockNumber, '100');
  assert.equal((await read()).blockNumber, '100'); assert.equal(calls, 1);
});

test('public snapshots expire and an explicit refresh immediately rereads Graph', async () => {
  let time = 0, calls = 0;
  const read = createGraphMarketCache(async () => snapshot(BigInt(++calls)), () => time);
  assert.equal((await read()).blockNumber, '1');
  time = GRAPH_MARKET_CACHE_MS - 1; assert.equal((await read()).blockNumber, '1');
  time++; assert.equal((await read()).blockNumber, '2');
  assert.equal((await read(true)).blockNumber, '3');
});

test('a receipt floor bypasses an otherwise unexpired public snapshot', async () => {
  const floors: bigint[] = [];
  const read = createGraphMarketCache(async floor => { floors.push(floor); return snapshot(floor); });
  await read(false, 100n); assert.equal((await read(false, 101n)).blockNumber, '101');
  assert.deepEqual(floors, [100n, 101n]);
});

test('higher-floor requests do not share an old read, and late old data cannot replace new data', async () => {
  const old = deferred<MarketSnapshot>(), next = deferred<MarketSnapshot>();
  const read = createGraphMarketCache(async floor => floor === 100n ? old.promise : next.promise);
  const a = read(false, 100n), b = read(false, 101n);
  next.resolve(snapshot(101n)); await b; old.resolve(snapshot(100n)); await a;
  assert.equal((await read()).blockNumber, '101');
});

test('a stale Graph response is rejected and never cached as satisfying a receipt', async () => {
  let calls = 0;
  const read = createGraphMarketCache(async () => { calls++; return snapshot(99n); });
  await assert.rejects(read(false, 100n), { name: 'SnapshotTooOld' });
  await assert.rejects(read(false, 100n), { name: 'SnapshotTooOld' });
  assert.equal(calls, 2);
});

test('failed Graph reads can recover and never cache an error or partial snapshot', async () => {
  let calls = 0;
  const read = createGraphMarketCache(async () => { if (++calls === 1) throw new Error('Graph quota'); return snapshot(100n); });
  await assert.rejects(read(), /Graph quota/); assert.equal((await read()).blockNumber, '100');
  assert.equal(calls, 2);
});

test('one cancelled browser leaves the other reader and its provider request alive', async () => {
  const result = deferred<MarketSnapshot>(), caller = new AbortController(); let provider!: AbortSignal;
  const read = createGraphMarketCache(async (_, signal) => { provider = signal; return result.promise; });
  const a = read(false, 100n, caller.signal), b = read(false, 100n); await Promise.resolve();
  const reason = new Error('Closed tab'); caller.abort(reason);
  await assert.rejects(a, error => error === reason); assert.equal(provider.aborted, false);
  result.resolve(snapshot(100n)); assert.equal((await b).blockNumber, '100');
});

test('when all readers cancel, the provider aborts and a new visitor starts a new read', async () => {
  const result = deferred<MarketSnapshot>(), caller = new AbortController(); let provider!: AbortSignal, calls = 0;
  const read = createGraphMarketCache(async (_, signal) => { provider = signal; if (++calls === 1) return result.promise; return snapshot(101n); });
  const a = read(false, 100n, caller.signal); await Promise.resolve(); caller.abort();
  await assert.rejects(a, { name: 'AbortError' }); assert.equal(provider.aborted, true);
  assert.equal((await read(false, 100n)).blockNumber, '101');
  result.resolve(snapshot(102n)); await Promise.resolve(); await Promise.resolve();
  assert.equal((await read()).blockNumber, '101', 'Abandoned data must not enter the cache');
});

test('a request cancelled before the read starts consumes no Graph query', async () => {
  const caller = new AbortController(); caller.abort(); let calls = 0;
  const read = createGraphMarketCache(async () => { calls++; return snapshot(100n); });
  await assert.rejects(read(false, 0n, caller.signal), { name: 'AbortError' }); assert.equal(calls, 0);
});

// A throttled indexer is a condition to survive, not a crash. The Studio development endpoint
// allows 3,000 queries a day and then returns 429 for the rest of the day, so the difference
// between degrading and failing here is the difference between a judge seeing the pool at an
// earlier block and seeing a 503.
test('a failed read serves the last indexed snapshot, labelled with why and how old', async () => {
  let time = 0, fail = false;
  const read = createGraphMarketCache(async () => {
    if (fail) throw new Error('Graph HTTP 429');
    return snapshot(100n);
  }, () => time);

  assert.equal((await read()).stale, undefined, 'a live read is never labelled stale');

  fail = true;
  time = GRAPH_MARKET_CACHE_MS + 1;
  const degraded = await read();
  // The block number is the honest disclosure: this is block 100, not whatever is current.
  assert.equal(degraded.blockNumber, '100');
  assert.equal(degraded.stale?.reason, 'Graph HTTP 429');
  assert.equal(degraded.stale?.ageMs, time);
});

test('stale data never satisfies a receipt freshness floor, and expires', async () => {
  let time = 0, fail = false;
  const read = createGraphMarketCache(async () => {
    if (fail) throw new Error('Graph HTTP 429');
    return snapshot(100n);
  }, () => time);
  await read();
  fail = true;
  time = GRAPH_MARKET_CACHE_MS + 1;

  // Trust rule 2: a caller that just sent a transaction asked for a block this data predates.
  // Answering it from the last good snapshot would report the pool as it was before their
  // transaction, so the read fails instead.
  await assert.rejects(() => read(false, 101n), /429/);

  // And the fallback is bounded: past the window it stops answering at all.
  time = GRAPH_MARKET_STALE_MS + 1;
  await assert.rejects(() => read(), /429/);
});
