import { waitForIndexed, SubgraphLagTimeout, getMeta } from '../wait';
import { SubgraphIndexingError } from '../client';

// Stub graph-node: reports `start`, advancing one block per poll.
function stub({ start, hasIndexingErrors = false }: { start: number; hasIndexingErrors?: boolean }) {
  let current = start;
  const calls: number[] = [];
  globalThis.fetch = (async () => {
    calls.push(Date.now());
    const body = { data: { _meta: { block: { number: current++, timestamp: '1789173368' }, hasIndexingErrors, deployment: 'Qm' } } };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }) as any;
  return calls;
}
const opts = { url: 'http://stub' } as any;

// 1. Already indexed -> returns on the first poll, no sleeping.
{
  const calls = stub({ start: 1000 });
  const t0 = Date.now();
  const got = await waitForIndexed(900n, opts);
  console.log(`already indexed      -> ${got}, polls=${calls.length}, elapsed=${Date.now() - t0}ms (expect 1 poll, fast)`);
}

// 2. Catches up after a few blocks.
{
  const calls = stub({ start: 1000 });
  const t0 = Date.now();
  const got = await waitForIndexed(1003n, { ...opts, initialDelayMs: 30, maxDelayMs: 60 });
  console.log(`catches up           -> ${got}, polls=${calls.length}, elapsed=${Date.now() - t0}ms`);
}

// 3. Never reaches target -> SubgraphLagTimeout carrying both numbers.
{
  stub({ start: 1000 });
  try {
    await waitForIndexed(99_999n, { ...opts, timeoutMs: 300, initialDelayMs: 50, maxDelayMs: 100 });
    console.log('timeout              -> NO ERROR (unexpected)');
  } catch (e) {
    const t = e instanceof SubgraphLagTimeout;
    console.log(`timeout              -> ${t ? 'SubgraphLagTimeout' : (e as Error).name}: target=${t ? (e as SubgraphLagTimeout).target : '-'} indexed=${t ? (e as SubgraphLagTimeout).indexed : '-'}`);
  }
}

// 4. Indexing errors fail immediately — waiting cannot fix untrustworthy entities.
{
  stub({ start: 1000, hasIndexingErrors: true });
  const t0 = Date.now();
  try {
    await waitForIndexed(99_999n, { ...opts, timeoutMs: 5000 });
    console.log('indexing errors      -> NO ERROR (unexpected)');
  } catch (e) {
    console.log(`indexing errors      -> ${(e as Error).name} after ${Date.now() - t0}ms (expect immediate, not 5000)`);
  }
}

// 5. Backoff actually grows, so a long wait is not a tight loop.
{
  const calls = stub({ start: 1000 });
  try { await waitForIndexed(99_999n, { ...opts, timeoutMs: 900, initialDelayMs: 50, maxDelayMs: 400 }); } catch {}
  const gaps = calls.slice(1).map((t, i) => t - calls[i]);
  console.log(`backoff gaps         -> ${gaps.join('ms, ')}ms (expect increasing)`);
}

// 6. Abort signal is honoured.
{
  stub({ start: 1000 });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 80);
  try {
    await waitForIndexed(99_999n, { ...opts, timeoutMs: 10_000, initialDelayMs: 200, signal: ac.signal });
    console.log('abort                -> NO ERROR (unexpected)');
  } catch (e) {
    console.log(`abort                -> ${(e as Error).name}`);
  }
}
