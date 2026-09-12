import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForIndexed, SubgraphLagTimeout } from '../wait';
const options = { url: 'https://fixture.invalid', initialDelayMs: 1, maxDelayMs: 3, timeoutMs: 1000 };
const meta = (number: number, hasIndexingErrors = false) => Response.json({ data: { _meta: { block: { number, timestamp: '1789232809' }, hasIndexingErrors, deployment: 'fixture' } } });
test('already indexed returns its block in one poll', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => meta(100));
  assert.equal(await waitForIndexed(99n, options), 100n); assert.equal(fetch.mock.callCount(), 1);
});
test('wait polls to the target with explicit progress values', async t => {
  let block = 97; t.mock.method(globalThis, 'fetch', async () => meta(++block));
  const progress: bigint[] = [];
  assert.equal(await waitForIndexed(100n, { ...options, onProgress: block => progress.push(block) }), 100n);
  assert.deepEqual(progress, [98n, 99n, 100n]);
});
test('timeout names the failure and retains target and indexed height', async t => {
  t.mock.method(globalThis, 'fetch', async () => meta(90));
  await assert.rejects(waitForIndexed(100n, { ...options, timeoutMs: 15 }), (error: unknown) => error instanceof SubgraphLagTimeout && error.target === 100n && error.indexed === 90n);
});
test('indexing errors fail immediately even at the requested block', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => meta(100, true));
  await assert.rejects(waitForIndexed(100n, options), { name: 'SubgraphIndexingError' }); assert.equal(fetch.mock.callCount(), 1);
});
test('hung request is aborted at the overall deadline', async t => {
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => new Promise<Response>((_, reject) => { init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }); }));
  const keepAlive = setInterval(() => {}, 100);
  try { await assert.rejects(waitForIndexed(100n, { ...options, timeoutMs: 15 }), { name: 'SubgraphLagTimeout' }); }
  finally { clearInterval(keepAlive); }
});
test('caller abort is preserved instead of being labeled as a timeout', async t => {
  t.mock.method(globalThis, 'fetch', async () => meta(90)); const controller = new AbortController(); controller.abort();
  await assert.rejects(waitForIndexed(100n, { ...options, signal: controller.signal }), { name: 'AbortError' });
});
