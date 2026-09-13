import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { agentClient, agentIpSource, agentRateLimitStore, checkAgentRateLimit, AgentRateLimitUnavailable, SharedAgentRateLimiter } from '../agent/rate-limit';
import { StorageUnavailable } from '../durable-store';
import { POST } from '../../app/api/agent/ask/route';
import { GET } from '../../app/api/agent/diagnose/[hash]/route';

function env(t: TestContext, overrides: Record<string, string> = {}) {
  const settings = { NODE_ENV: 'production', VERCEL: '1', AGENT_IP_SOURCE: 'auto', AGENT_TRUST_PROXY: 'false', AGENT_RATE_LIMIT_STORE: 'auto', REDIS_REST_URL: 'https://redis.invalid', REDIS_REST_TOKEN: 'private-fixture-token', STORAGE_NAMESPACE: 'fixture', AGENT_ASK_TIMEOUT_MS: '150', AGENT_DIAGNOSE_TIMEOUT_MS: '150', ...overrides };
  for (const [key, value] of Object.entries(settings)) {
    const before = process.env[key]; process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
}
const request = (headers: Record<string, string> = {}, signal?: AbortSignal) => new Request('https://app.example/api/agent/ask', { method: 'POST', body: '{}', headers: { 'x-vercel-forwarded-for': '192.0.2.1', ...headers }, signal });
test('Vercel auto mode uses the platform IP and ignores forged generic forwarding headers', t => {
  env(t);
  assert.equal(agentIpSource(), 'vercel'); assert.equal(agentRateLimitStore(), 'redis');
  for (const fake of ['192.0.2.2', '198.51.100.42', '2001:db8::8']) {
    assert.equal(agentClient(request({ 'x-forwarded-for': fake, 'x-real-ip': fake, forwarded: `for=${fake}` })), '192.0.2.1');
  }
  assert.equal(agentClient(request({ 'x-vercel-forwarded-for': '::ffff:c000:201' })), '192.0.2.1');
  assert.equal(agentClient(request({ 'x-vercel-forwarded-for': '2001:0DB8:0:0:0:0:0:1' })), '2001:db8::1');
});
test('HTTP headers cannot turn a direct server into a trusted Vercel deployment', t => {
  env(t, { NODE_ENV: 'development', VERCEL: '', REDIS_REST_URL: '' });
  assert.equal(agentClient(request({ 'x-vercel-id': 'fake', 'x-forwarded-for': '198.51.100.1' })), 'unidentified');
  process.env.AGENT_IP_SOURCE = 'vercel'; assert.throws(() => agentIpSource(), AgentRateLimitUnavailable);
});
test('trusted-proxy mode accepts exactly one address and missing or ambiguous deployed identity fails closed', t => {
  env(t, { VERCEL: '', AGENT_IP_SOURCE: 'trusted-proxy' });
  assert.equal(agentClient(request({ 'x-forwarded-for': '198.51.100.42' })), '198.51.100.42');
  for (const value of ['', 'unknown', '192.0.2.1, 198.51.100.42', 'fe80::1%eth0', '192.0.2.1:1234', '192.000.2.1']) {
    assert.throws(() => agentClient(request({ 'x-forwarded-for': value })), AgentRateLimitUnavailable);
  }
  process.env.AGENT_IP_SOURCE = 'unidentified'; assert.throws(() => agentIpSource(), AgentRateLimitUnavailable);
});
test('production refuses process-local counters and Redis configuration errors do not fall back to memory', async t => {
  env(t, { AGENT_RATE_LIMIT_STORE: 'memory' });
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No external calls'); });
  assert.equal((await POST(request())).status, 503);
  process.env.AGENT_RATE_LIMIT_STORE = 'redis'; process.env.REDIS_REST_TOKEN = '';
  assert.equal((await POST(request())).status, 503);
  assert.equal(fetch.mock.callCount(), 0);
});
test('shared denial precedes body validation and route params on both actual Agent APIs', async t => {
  env(t); let paramsRead = 0;
  const calls: unknown[][] = [];
  t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(url), 'https://redis.invalid');
    assert.equal((init!.headers as Record<string, string>).authorization, 'Bearer private-fixture-token');
    calls.push(JSON.parse(init!.body as string));
    return Response.json({ result: [0, 17] });
  });
  const responses = [await POST(request()), await GET(request(), { get params() { paramsRead++; return Promise.resolve({ hash: 'invalid' }); } })];
  for (const response of responses) {
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { code: 'AgentRateLimited', error: 'Too many agent requests. Retry in 17 seconds.', retryAfterSeconds: 17 });
    assert.equal(response.headers.get('Retry-After'), '17');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-Agent-RateLimit-Store'), 'redis');
    assert.equal(response.headers.get('X-Agent-IP-Source'), 'vercel');
  }
  assert.equal(paramsRead, 0); assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'EVAL');
  assert.match(String(calls[0][1]), /redis.call\('TIME'\)/);
  assert.notEqual(calls[0][3], calls[1][3], 'ask and diagnose have distinct shared counters');
  assert.ok(!String(calls[0][3]).includes('192.0.2.1'), 'IP is not stored in plaintext in the Redis key');
});
test('admitted validation errors retain rate-limit metadata without querying Graph or the model', async t => {
  env(t);
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ result: [1, 0] }));
  const response = await POST(request());
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('X-Agent-RateLimit-Store'), 'redis');
  assert.equal(fetch.mock.callCount(), 1);
});
for (const failure of ['transport', 'malformed', 'provider'] as const) test(`Redis ${failure} failure returns a redacted 503 before downstream work`, async t => {
  env(t);
  t.mock.method(globalThis, 'fetch', async () => {
    if (failure === 'transport') throw new Error('private-fixture-token');
    if (failure === 'provider') return Response.json({ error: 'private-fixture-token' }, { status: 500 });
    return Response.json({ result: [1, -1] });
  });
  const response = await POST(request()), body = await response.json();
  assert.equal(response.status, 503); assert.equal(body.code, 'AgentRateLimitUnavailable');
  assert.ok(!JSON.stringify(body).includes('private-fixture-token')); assert.equal(body.block, undefined);
});
for (const stage of ['headers', 'body'] as const) test(`the existing overall deadline cancels a stalled Redis ${stage} read`, async t => {
  env(t); let aborted = false, calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    const signal = init!.signal!;
    if (stage === 'body') return new Response(new ReadableStream({ start(controller) {
      signal.addEventListener('abort', () => { aborted = true; controller.error(signal.reason); }, { once: true });
    } }));
    return new Promise<Response>((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true }));
  });
  const response = await POST(request());
  assert.equal(response.status, 504); assert.equal((await response.json()).code, 'AgentRequestTimeout');
  assert.equal(aborted, true); assert.equal(calls, 1);
});
test('a late Redis result cannot start Graph or body handling after caller cancellation', async t => {
  env(t);
  let finish!: (r: Response) => void, ready!: () => void;
  const started = new Promise<void>(r => { ready = r; });
  const fetch = t.mock.method(globalThis, 'fetch', () => new Promise<Response>(resolve => { finish = resolve; ready(); }));
  const caller = new AbortController(), pending = POST(request({}, caller.signal));
  await started; caller.abort();
  const response = await pending;
  assert.equal(response.status, 499); assert.equal((await response.json()).code, 'AgentRequestCancelled');
  finish(Response.json({ result: [1, 0] })); await new Promise(r => setImmediate(r));
  assert.equal(fetch.mock.callCount(), 1);
});
test('each admission has a distinct Redis member even when multiple workers request in one millisecond', async () => {
  const ids: unknown[] = [];
  const store = { evaluate: async <T,>(_script: string, _keys: string[], args: (string | number)[]) => { ids.push(args[2]); return [1, 0] as T; } };
  const a = new SharedAgentRateLimiter(store), b = new SharedAgentRateLimiter(store);
  await Promise.all([a.consume('ask', 'client'), b.consume('ask', 'client')]);
  assert.equal(new Set(ids).size, 2);
});
test('health checks the real Lua path in a separate bounded bucket and accepts either valid admission result', async t => {
  env(t);
  const keys: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    const command = JSON.parse(init!.body as string);
    assert.equal(command[0], 'EVAL'); keys.push(command[3]);
    return Response.json({ result: keys.length === 1 ? [1, 0] : [0, 60] });
  });
  await checkAgentRateLimit(request());
  await checkAgentRateLimit(request({ 'x-vercel-forwarded-for': '192.0.2.2' }));
  assert.equal(new Set(keys).size, 1, 'Health does not create a new Redis key per visitor');
  await new SharedAgentRateLimiter().consume('diagnose', '192.0.2.1');
  assert.notEqual(keys[2], keys[0], 'Health cannot consume the visitor diagnosis quota');
});
test('health cannot pass with unavailable Redis or missing production client identity', async t => {
  env(t);
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'unavailable' }, { status: 503 }));
  await assert.rejects(() => checkAgentRateLimit(request()), StorageUnavailable);
  await assert.rejects(() => checkAgentRateLimit(request({ 'x-vercel-forwarded-for': '' })), AgentRateLimitUnavailable);
  assert.equal(fetch.mock.callCount(), 1);
});
