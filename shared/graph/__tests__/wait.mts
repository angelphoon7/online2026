import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { waitForIndexed, SubgraphLagTimeout } from '../wait';
import { GraphError, SubgraphIndexingError } from '../client';

const options = { url: 'https://fixture.invalid' };
const meta = (number: number, hasIndexingErrors = false) => Response.json({
  data: { _meta: { block: { number, timestamp: '1789232809' }, hasIndexingErrors, deployment: 'fixture' } },
});
// Allow fetch/Response.json promise continuations to finish without advancing mocked time.
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function clock(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  // Node's native AbortSignal.timeout uses internal timers that MockTimers cannot advance.
  // Keep a separate native-timer integration test below to cover the real deadline signal.
  const deadlines = t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Deadline exceeded', 'TimeoutError')), ms);
    return controller.signal;
  });
  return {
    deadlines,
    async advance(ms: number) { t.mock.timers.tick(ms); await flush(); },
  };
}

function lagTimeout(target: bigint, indexed: bigint, waitedMs: number) {
  return (error: unknown) => {
    assert.ok(error instanceof SubgraphLagTimeout);
    assert.equal(error.name, 'SubgraphLagTimeout');
    assert.equal(error.target, target);
    assert.equal(error.indexed, indexed);
    assert.equal(error.waitedMs, waitedMs);
    assert.match(error.message, new RegExp(`indexed ${indexed}, needed ${target}`));
    return true;
  };
}

for (const [target, indexed] of [[100n, 100], [99n, 100], [0n, 0]] as const) {
  test(`indexed ${indexed} satisfies target ${target} in one poll`, async t => {
    clock(t);
    const fetch = t.mock.method(globalThis, 'fetch', async () => meta(indexed));
    const progress: [bigint, bigint][] = [];
    assert.equal(await waitForIndexed(target, { ...options, onProgress: (n, goal) => progress.push([n, goal]) }), BigInt(indexed));
    assert.equal(fetch.mock.callCount(), 1);
    assert.deepEqual(progress, [[BigInt(indexed), target]]);
  });
}

test('polls until the receipt block and reports indexed and target heights', async t => {
  const time = clock(t);
  const blocks = [98, 99, 101];
  const fetch = t.mock.method(globalThis, 'fetch', async () => meta(blocks.shift()!));
  const progress: [bigint, bigint][] = [];
  const waiting = waitForIndexed(100n, { ...options, onProgress: (n, goal) => progress.push([n, goal]) });
  await flush();
  assert.deepEqual(progress, [[98n, 100n]]);
  await time.advance(800);
  assert.deepEqual(progress, [[98n, 100n], [99n, 100n]]);
  await time.advance(1200);
  assert.equal(await waiting, 101n);
  assert.equal(fetch.mock.callCount(), 3);
  assert.deepEqual(progress, [[98n, 100n], [99n, 100n], [101n, 100n]]);
});

test('default polling backs off from 800ms and caps at 5000ms', async t => {
  const time = clock(t);
  const polledAt: number[] = [];
  t.mock.method(globalThis, 'fetch', async () => {
    polledAt.push(Date.now());
    return meta(polledAt.length === 8 ? 100 : 90);
  });
  const waiting = waitForIndexed(100n, options);
  await flush();
  assert.deepEqual(polledAt, [0]);
  for (const delay of [800, 1200, 1800, 2700, 4050, 5000, 5000]) {
    const before = polledAt.length;
    await time.advance(delay - 1);
    assert.equal(polledAt.length, before, 'must not poll before the backoff expires');
    await time.advance(1);
    assert.equal(polledAt.length, before + 1);
  }
  assert.equal(await waiting, 100n);
  assert.deepEqual(polledAt, [0, 800, 2000, 3800, 6500, 10550, 15550, 20550]);
  assert.equal(time.deadlines.mock.calls[0].arguments[0], 90_000);
});

test('custom backoff rounds the growth and respects its cap', async t => {
  const time = clock(t);
  const polledAt: number[] = [];
  t.mock.method(globalThis, 'fetch', async () => {
    polledAt.push(Date.now());
    return meta(polledAt.length === 5 ? 100 : 90);
  });
  const waiting = waitForIndexed(100n, { ...options, initialDelayMs: 3, maxDelayMs: 7 });
  await flush();
  for (const delay of [3, 5, 7, 7]) await time.advance(delay);
  assert.equal(await waiting, 100n);
  assert.deepEqual(polledAt, [0, 3, 8, 15, 22]);
});

test('stalled index times out at the deadline with the last observed height', async t => {
  const time = clock(t);
  const fetch = t.mock.method(globalThis, 'fetch', async () => meta(90));
  const waiting = waitForIndexed(100n, { ...options, timeoutMs: 1100 });
  // Attach the rejection assertion before advancing time to avoid an unhandled rejection.
  const rejected = assert.rejects(waiting, lagTimeout(100n, 90n, 1100));
  await flush();
  await time.advance(800);
  assert.equal(fetch.mock.callCount(), 2);
  await time.advance(299);
  assert.equal(fetch.mock.callCount(), 2);
  await time.advance(1);
  await rejected;
  await time.advance(5000);
  assert.equal(fetch.mock.callCount(), 2, 'timeout must stop all further polling');
});

for (const indexed of [90, 100]) {
  test(`indexing error at ${indexed} fails immediately without progress or retries`, async t => {
    const time = clock(t);
    const fetch = t.mock.method(globalThis, 'fetch', async () => meta(indexed, true));
    const progress = t.mock.fn();
    await assert.rejects(waitForIndexed(100n, { ...options, onProgress: progress }), SubgraphIndexingError);
    await time.advance(5000);
    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(progress.mock.callCount(), 0);
  });
}

test('a hung fetch receives the deadline abort signal', { timeout: 2000 }, async t => {
  const time = clock(t);
  let requestSignal: AbortSignal | undefined;
  const fetch = t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    requestSignal = init?.signal ?? undefined;
    assert.ok(requestSignal);
    return new Promise<Response>((_, reject) => requestSignal!.addEventListener('abort', () => reject(requestSignal!.reason), { once: true }));
  });
  const rejected = assert.rejects(waitForIndexed(100n, { ...options, timeoutMs: 100 }), lagTimeout(100n, 0n, 100));
  await flush();
  await time.advance(99);
  assert.equal(requestSignal?.aborted, false);
  await time.advance(1);
  await rejected;
  assert.equal(requestSignal?.aborted, true);
  assert.equal(requestSignal?.reason.name, 'TimeoutError');
  assert.equal(fetch.mock.callCount(), 1);
});

test('native overall deadline aborts a hung fetch without clock mocks', { timeout: 2000 }, async t => {
  let requestSignal: AbortSignal | undefined;
  const fetch = t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    requestSignal = init?.signal ?? undefined;
    assert.ok(requestSignal);
    return new Promise<Response>((_, reject) => requestSignal!.addEventListener('abort', () => reject(requestSignal!.reason), { once: true }));
  });
  // Native AbortSignal.timeout is unref'ed; keep the process alive until it fires.
  const keepAlive = setInterval(() => {}, 100);
  t.after(() => clearInterval(keepAlive));
  await assert.rejects(waitForIndexed(100n, { ...options, timeoutMs: 50 }), (error: unknown) => {
    assert.ok(error instanceof SubgraphLagTimeout);
    assert.equal(error.target, 100n);
    assert.equal(error.indexed, 0n);
    return true;
  });
  assert.equal(requestSignal?.aborted, true);
  assert.equal(fetch.mock.callCount(), 1);
});

test('a successful response arriving after the deadline cannot report success', async t => {
  const time = clock(t);
  let respond!: (response: Response) => void;
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>(resolve => { respond = resolve; }));
  const rejected = assert.rejects(waitForIndexed(100n, { ...options, timeoutMs: 100 }), lagTimeout(100n, 0n, 100));
  await time.advance(100);
  respond(meta(100));
  await rejected;
});

test('pre-aborted caller preserves its reason without issuing a request', async t => {
  clock(t);
  const fetch = t.mock.method(globalThis, 'fetch', async () => meta(90));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(waitForIndexed(100n, { ...options, signal: controller.signal }), (error: unknown) => {
    assert.equal(error, controller.signal.reason);
    assert.equal((error as DOMException).name, 'AbortError');
    return true;
  });
  assert.equal(fetch.mock.callCount(), 0);
});

test('caller abort during backoff clears the timer and prevents another poll', { timeout: 2000 }, async t => {
  const time = clock(t);
  const clear = t.mock.method(globalThis, 'clearTimeout');
  const fetch = t.mock.method(globalThis, 'fetch', async () => meta(90));
  const controller = new AbortController();
  const reason = new Error('The user left this view');
  const rejected = assert.rejects(waitForIndexed(100n, { ...options, signal: controller.signal }), (error: unknown) => {
    assert.equal(error, reason);
    return true;
  });
  await flush();
  controller.abort(reason);
  await rejected;
  assert.equal(clear.mock.callCount(), 1);
  await time.advance(5000);
  assert.equal(fetch.mock.callCount(), 1);
});

test('caller abort during fetch reaches the request and preserves the exact reason', { timeout: 2000 }, async t => {
  clock(t);
  let requestSignal: AbortSignal | undefined;
  const fetch = t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    requestSignal = init?.signal ?? undefined;
    assert.ok(requestSignal);
    return new Promise<Response>((_, reject) => requestSignal!.addEventListener('abort', () => reject(requestSignal!.reason), { once: true }));
  });
  const controller = new AbortController();
  const reason = new Error('A newer transaction superseded this wait');
  const rejected = assert.rejects(waitForIndexed(100n, { ...options, signal: controller.signal }), (error: unknown) => {
    assert.equal(error, reason);
    return true;
  });
  await flush();
  controller.abort(reason);
  await rejected;
  assert.equal(requestSignal?.aborted, true);
  assert.equal(requestSignal?.reason, reason);
  assert.equal(fetch.mock.callCount(), 1);
});

test('transport failure propagates unchanged instead of becoming an index timeout', async t => {
  const time = clock(t);
  const failure = new TypeError('Connection failed');
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw failure; });
  await assert.rejects(waitForIndexed(100n, options), (error: unknown) => {
    assert.equal(error, failure);
    return true;
  });
  await time.advance(5000);
  assert.equal(fetch.mock.callCount(), 1);
});

test('GraphQL error preserves its details instead of retrying until timeout', async t => {
  const time = clock(t);
  const errors = [{ message: 'Unknown field in query' }];
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ errors }));
  await assert.rejects(waitForIndexed(100n, options), (error: unknown) => {
    assert.ok(error instanceof GraphError);
    assert.deepEqual(error.errors, errors);
    assert.equal(error.status, 200);
    return true;
  });
  await time.advance(5000);
  assert.equal(fetch.mock.callCount(), 1);
});
