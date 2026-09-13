import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DEPLOYMENT } from '../../lib/deployment';
import { chainConfig } from '../chain';
import { readSource } from '../market';
import { gql, subgraphEndpoint, SubgraphRateLimited } from '../../shared/graph/client';
import { retryAfterSeconds } from '../../shared/retry-after';
import { GET as market } from '../../app/api/market/route';
import { POST as rpc } from '../../app/api/rpc/route';
import { POST as graph } from '../../app/api/graph/route';
import { getMarketSnapshot } from '../../lib/market-snapshot';

function env(t: TestContext, values: Record<string, string | undefined> = {}) {
  for (const [key, value] of Object.entries({ ARC_RPC: undefined, ARC_CHAIN_ID: undefined, SUBGRAPH_URL: undefined, SUBGRAPH_API_KEY: undefined, READ_SOURCE: undefined, ...values })) {
    const before = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
}
const marketRequest = () => new Request('https://app.example/api/market?minBlock=100');
const graphRequest = () => new Request('https://app.example/api/graph', { method: 'POST', body: '{"query":"{_meta{block{number}}}"}' });
const rpcRequest = (method = 'eth_chainId') => new Request('https://app.example/api/rpc', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 7, method, params: [] }) });
const page = () => ({ data: { _meta: { deployment: 'QmFixture', hasIndexingErrors: false, block: { number: 100, timestamp: '1789232809', hash: '0x' + 'a'.repeat(64) } }, intents: [], tickets: [], settlements: [] } });

test('public reads use the selected deployment when hosting has no RPC/Graph environment overrides', t => {
  env(t);
  assert.equal(DEPLOYMENT.network, 'arc-testnet');
  assert.equal(chainConfig().rpcUrl, DEPLOYMENT.rpc);
  assert.equal(subgraphEndpoint(), DEPLOYMENT.subgraphUrl);
  assert.equal(readSource(), 'graph');
});
test('blank overrides use deployment defaults and explicit endpoint/source overrides remain supported', t => {
  env(t, { ARC_RPC: '  ', SUBGRAPH_URL: ' ', READ_SOURCE: ' ' });
  assert.equal(chainConfig().rpcUrl, DEPLOYMENT.rpc); assert.equal(subgraphEndpoint(), DEPLOYMENT.subgraphUrl); assert.equal(readSource(), 'graph');
  process.env.ARC_RPC = ' https://rpc.invalid ';
  process.env.SUBGRAPH_URL = ' https://override.invalid ';
  process.env.READ_SOURCE = 'rpc';
  assert.equal(chainConfig().rpcUrl, 'https://rpc.invalid'); assert.equal(subgraphEndpoint(), 'https://override.invalid'); assert.equal(readSource(), 'rpc');
});
test('the actual market route uses live Graph transport without wallet credentials or environment overrides', async t => {
  env(t);
  const fetch = t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(url), DEPLOYMENT.subgraphUrl);
    const request = JSON.parse(init!.body as string);
    assert.deepEqual(request.variables.at, { number_gte: 100 });
    assert.ok(!(init!.headers as Record<string, string>).authorization);
    return Response.json(page());
  });
  const response = await market(marketRequest()), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.source, 'graph'); assert.equal(body.blockNumber, '100');
  assert.equal(fetch.mock.callCount(), 1, 'No RPC fallback or signing request');
});
test('the browser RPC proxy uses the resolved deployment URL when ARC_RPC is missing', async t => {
  env(t);
  const fetch = t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(url), DEPLOYMENT.rpc);
    assert.deepEqual(JSON.parse(init!.body as string), { jsonrpc: '2.0', id: 7, method: 'eth_chainId', params: [] });
    return Response.json({ jsonrpc: '2.0', id: 7, result: '0x4cef52' });
  });
  const response = await rpc(rpcRequest());
  assert.equal(response.status, 200); assert.equal((await response.json()).result, '0x4cef52');
  assert.equal((await rpc(rpcRequest('eth_sendTransaction'))).status, 400);
  assert.equal(fetch.mock.callCount(), 1, 'Default endpoint must not enable wallet writes');
});
test('HTML provider throttling becomes an actionable 429 on the market and Graph proxy, with shared cooldown', async t => {
  env(t, { SUBGRAPH_URL: 'https://public-rate.invalid' });
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('provider-private-diagnostic', { status: 429, headers: { 'retry-after': '75' } }));
  const response = await market(marketRequest()), body = await response.json();
  assert.equal(response.status, 429); assert.equal(body.code, 'SubgraphRateLimited'); assert.equal(body.retryAfterSeconds, 75);
  assert.equal(response.headers.get('Retry-After'), '75'); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.ok(!JSON.stringify(body).includes('provider-private-diagnostic'));
  const proxied = await graph(graphRequest()), json = await proxied.json();
  assert.equal(proxied.status, 429); assert.equal(json.errors[0].extensions.code, 'SubgraphRateLimited');
  assert.ok(Number(proxied.headers.get('Retry-After')) > 0);
  assert.equal(fetch.mock.callCount(), 1, 'Repeated consumers must respect the upstream refusal');
});
test('provider cooldown expires and a new floored query goes upstream rather than returning an earlier snapshot', async t => {
  env(t); let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const fetch = t.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (now === 1_000_000) return new Response('limited', { status: 429, headers: { 'retry-after': '2' } });
    assert.deepEqual(JSON.parse(init!.body as string).variables, { floor: 999 });
    return Response.json({ data: { block: 999 } });
  });
  const options = { url: 'https://recovery-rate.invalid' };
  await assert.rejects(gql('query', {}, options), SubgraphRateLimited);
  now += 1000;
  await assert.rejects(gql('query', { floor: 999 }, options), { name: 'SubgraphRateLimited', retryAfterSeconds: 1 });
  assert.equal(fetch.mock.callCount(), 1);
  now += 1000;
  assert.deepEqual(await gql('query', { floor: 999 }, options), { block: 999 });
  assert.equal(fetch.mock.callCount(), 2);
});
test('a cancelled query preserves its abort reason even during provider cooldown', async t => {
  env(t);
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('limited', { status: 429 }));
  const options = { url: 'https://cancel-rate.invalid' };
  await assert.rejects(gql('query', {}, options), SubgraphRateLimited);
  const caller = new AbortController(), reason = new Error('Caller stopped'); caller.abort(reason);
  await assert.rejects(gql('query', {}, { ...options, signal: caller.signal }), e => e === reason);
  assert.equal(fetch.mock.callCount(), 1);
});
test('other provider HTTP failures are reported as Graph failures with no raw upstream payload', async t => {
  env(t, { SUBGRAPH_URL: 'https://unavailable-public.invalid' });
  t.mock.method(globalThis, 'fetch', async () => new Response('private-provider-data', { status: 503 }));
  const response = await market(marketRequest()), body = await response.json();
  assert.equal(response.status, 503); assert.equal(body.code, 'GraphProviderUnavailable');
  assert.ok(!JSON.stringify(body).includes('private-provider-data'));
});
test('Retry-After handles seconds, HTTP dates and malformed or absent provider headers', () => {
  assert.equal(retryAfterSeconds('90'), 90);
  assert.equal(retryAfterSeconds('Sun, 13 Sep 2026 01:01:00 GMT', Date.parse('2026-09-13T01:00:00Z')), 60);
  assert.equal(retryAfterSeconds(null), 60); assert.equal(retryAfterSeconds('later'), 60);
  assert.equal(retryAfterSeconds('0'), 1);
});
test('browser polling and manual retry honor a 429 without lowering the next request floor', async t => {
  let now = 2_000_000; t.mock.method(Date, 'now', () => now);
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (now === 2_000_000) return Response.json({ error: 'Provider throttled' }, { status: 429, headers: { 'Retry-After': '2' } });
    assert.ok(url.includes('minBlock=200'));
    return Response.json({ blockNumber: '200', source: 'graph' });
  });
  await assert.rejects(getMarketSnapshot(false, 100n), /Provider throttled/);
  await assert.rejects(getMarketSnapshot(true, 200n), /rate-limited/);
  assert.equal(fetch.mock.callCount(), 1);
  now += 2000;
  assert.equal((await getMarketSnapshot(true, 200n)).blockNumber, '200');
  assert.equal(fetch.mock.callCount(), 2);
});
