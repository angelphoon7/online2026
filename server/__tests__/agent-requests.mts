import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters } from 'viem';
import { POST } from '../../app/api/agent/ask/route';
import { GET } from '../../app/api/agent/diagnose/[hash]/route';
import { AgentRateLimiter, agentClient, AGENT_POLICY } from '../agent/request-control';
import { RequestBudget } from '../agent/request-budget';
import { diagnose } from '../agent/diagnose';
import { solveHypothetical } from '../solve-hypothetical';
import { hashIntent, type Intent } from '../../shared/intent';
import type { Snapshot } from '../../shared/graph';

const A = `0x${'a'.repeat(40)}` as const, B = `0x${'b'.repeat(40)}` as const;
const block = 61000000n, now = 1800000000n;
const intent: Intent = { owner: A, offered: [1n], eventId: 1, sessionMask: 1n, sectionMask: 1n,
  exactCount: 1, mustBeAdjacent: false, mustShareSection: false, mustShareSession: false,
  maxNetPay: 0n, nonce: 1n, deadline: now + 10000n };
const hash = hashIntent(intent);
let nextClient = 1;
const client = () => `192.0.2.${nextClient++}`;
function env(t: TestContext, overrides: Record<string, string> = {}) {
  for (const [key, value] of Object.entries({ AGENT_TRUST_PROXY: 'true', AGENT_ASK_TIMEOUT_MS: '200', AGENT_DIAGNOSE_TIMEOUT_MS: '200',
    SUBGRAPH_URL: 'https://graph.invalid', ARC_RPC: 'https://rpc.invalid', ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: 'https://model.invalid', ...overrides })) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
}
function askRequest(ip = client(), signal?: AbortSignal, text = JSON.stringify({ intentHash: hash, question: 'Explain this intent.' })) {
  return new Request('http://localhost/api/agent/ask', { method: 'POST', headers: { 'x-forwarded-for': ip }, signal, body: text });
}
function diagnosisRequest(ip = client(), signal?: AbortSignal) {
  return new Request(`http://localhost/api/agent/diagnose/${hash}`, { headers: { 'x-forwarded-for': ip }, signal });
}
const context = (value: string = hash) => ({ params: Promise.resolve({ hash: value }) });
const json = (value: unknown) => Response.json(JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v)));
function pool(empty = false) {
  return { data: {
    _meta: { block: { number: Number(block), timestamp: String(now) }, deployment: 'QmFixture', hasIndexingErrors: false },
    intents: empty ? [] : [{ ...intent, id: hash, committedTx: hash, committedAtBlock: '60000000',
      offeredTickets: [{ id: '1', escrowed: true, depositor: A, redeemed: false }] }],
    tickets: empty ? [] : [{ id: '1', eventId: 1, sessionId: 0, sectionId: 0, row: 1, seat: 1, depositor: A, redeemed: false }],
  } };
}
type Stage = 'graph' | 'graph-body' | 'closed' | 'rpc' | 'model';
function stalledTransport(t: TestContext, stage: Stage) {
  const calls: { service: string; signal: AbortSignal; body: Record<string, unknown> }[] = [];
  let aborted = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), service = new URL(request.url).hostname;
    const body = await request.json();
    calls.push({ service, signal: request.signal, body });
    const shouldHang = stage === 'graph' || stage === 'graph-body'
      || (stage === 'closed' && body.query?.includes('IntentById'))
      || (stage === 'rpc' && service === 'rpc.invalid') || (stage === 'model' && service === 'model.invalid');
    if (shouldHang) {
      assert.equal(request.signal.aborted, false);
      if (stage === 'graph-body') return new Response(new ReadableStream({ start(controller) {
        request.signal.addEventListener('abort', () => { aborted++; controller.error(request.signal.reason); }, { once: true });
      } }), { headers: { 'content-type': 'application/json' } });
      return new Promise<Response>((_, reject) => request.signal.addEventListener('abort', () => {
        aborted++; reject(request.signal.reason);
      }, { once: true }));
    }
    if (service === 'graph.invalid') return json(pool(stage === 'closed'));
    if (service === 'rpc.invalid') return json({ jsonrpc: '2.0', id: body.id, result: encodeAbiParameters([{ type: 'uint256' }], [100_000_000n]) });
    return json({ id: 'msg_fixture', type: 'message', role: 'assistant', model: body.model, stop_reason: 'tool_use', stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'tool_use', id: 'tool_fixture', name: 'diagnose_intent', input: { intentHash: hash } }] });
  });
  return { calls, aborted: () => aborted };
}

test('rate windows recover without extending on rejection, and route quotas are separate', () => {
  const limiter = new AgentRateLimiter();
  for (let i = 0; i < 12; i++) assert.equal(limiter.consume('ask', 'a', 1000).allowed, true);
  assert.deepEqual(limiter.consume('ask', 'a', 1500), { allowed: false, retryAfter: 60 });
  assert.equal(limiter.consume('diagnose', 'a', 1500).allowed, true);
  assert.equal(limiter.consume('ask', 'b', 1500).allowed, true);
  assert.equal(limiter.consume('ask', 'a', 60_999).allowed, false);
  assert.equal(limiter.consume('ask', 'a', 61_000).allowed, true);
});

test('bounded limiter refuses new identities without evicting active quotas', () => {
  const limiter = new AgentRateLimiter(2);
  for (let i = 0; i < 12; i++) limiter.consume('ask', 'a', 0);
  assert.equal(limiter.consume('ask', 'b', 0).allowed, true);
  assert.equal(limiter.consume('ask', 'c', 1).allowed, false);
  assert.equal(limiter.consume('ask', 'a', 2).allowed, false);
  assert.equal(limiter.consume('ask', 'c', 60_000).allowed, true);
});

test('client identity ignores untrusted headers and normalizes trusted IPs', t => {
  env(t, { AGENT_TRUST_PROXY: 'false' });
  assert.equal(agentClient(askRequest('198.51.100.1')), 'unidentified');
  process.env.AGENT_TRUST_PROXY = 'true';
  assert.equal(agentClient(askRequest('invalid')), 'unidentified');
  assert.equal(agentClient(askRequest('fe80::1%eth0')), 'unidentified');
  assert.equal(agentClient(askRequest('2001:0DB8:0:0:0:0:0:1')), agentClient(askRequest('2001:db8::1')));
  assert.equal(agentClient(askRequest('::ffff:192.0.2.1')), agentClient(askRequest('192.0.2.1')));
});

for (const route of ['ask', 'diagnose'] as const) test(`${route} HTTP admission rejects excess requests before any external read`, async t => {
  env(t);
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No external reads expected'); });
  const ip = client();
  const invoke = () => route === 'ask' ? POST(askRequest(ip, undefined, '{}')) : GET(diagnosisRequest(ip), context('bad'));
  for (let i = 0; i < AGENT_POLICY[route].requests; i++) assert.equal((await invoke()).status, 400);
  const response = await invoke();
  assert.equal(response.status, 429);
  assert.equal((await response.json()).code, 'AgentRateLimited');
  assert.ok(Number(response.headers.get('Retry-After')) > 0);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(fetch.mock.callCount(), 0);
});

for (const route of ['ask', 'diagnose'] as const) for (const stage of ['graph', 'graph-body', 'closed', 'rpc'] as const) {
  test(`${route} aborts stalled ${stage} at the overall deadline`, async t => {
    env(t);
    const trace = stalledTransport(t, stage);
    const response = await (route === 'ask' ? POST(askRequest()) : GET(diagnosisRequest(), context()));
    assert.equal(response.status, 504);
    const body = await response.json();
    assert.equal(body.code, 'AgentRequestTimeout');
    assert.equal(body.timeoutMs, 200);
    assert.equal(body.answer, undefined);
    assert.equal(body.block, undefined);
    assert.ok(trace.aborted() > 0);
    assert.ok(trace.calls.every(call => call.signal.aborted));
    if (stage === 'closed') assert.equal(trace.calls.at(-1)?.body.variables && (trace.calls.at(-1)!.body.variables as { block: number }).block, Number(block));
    if (stage === 'rpc') assert.equal(trace.calls.filter(call => call.service === 'rpc.invalid').length, 2, 'No RPC retry after cancellation');
  });
}

test('model API receives cancellation and no fallback diagnosis starts after timeout', async t => {
  env(t, { ANTHROPIC_API_KEY: 'test-fixture-only' });
  const trace = stalledTransport(t, 'model');
  const response = await POST(askRequest());
  assert.equal(response.status, 504);
  assert.equal((await response.json()).code, 'AgentRequestTimeout');
  assert.equal(trace.calls.filter(call => call.service === 'model.invalid').length, 1);
  assert.equal(trace.calls.filter(call => call.service === 'rpc.invalid').length, 0);
  assert.ok(trace.aborted() > 0);
});

test('caller disconnect cancels downstream work with a distinct outcome', async t => {
  env(t, { AGENT_DIAGNOSE_TIMEOUT_MS: '2000' });
  const trace = stalledTransport(t, 'graph'), controller = new AbortController();
  const request = GET(diagnosisRequest(client(), controller.signal), context());
  const timer = setTimeout(() => controller.abort(), 20);
  t.after(() => clearTimeout(timer));
  const response = await request;
  assert.equal(response.status, 499);
  assert.equal((await response.json()).code, 'AgentRequestCancelled');
  assert.equal(trace.aborted(), 1);
});

test('stalled request body and route params are included in the deadline', async t => {
  env(t);
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const request = new Request('http://localhost/api/agent/ask', { method: 'POST', headers: { 'x-forwarded-for': client() }, body, duplex: 'half' } as RequestInit);
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No external reads expected'); });
  assert.equal((await POST(request)).status, 504);
  assert.equal(cancelled, true);
  assert.equal((await GET(diagnosisRequest(), { params: new Promise(() => {}) })).status, 504);
  assert.equal(fetch.mock.callCount(), 0);
});

test('streamed request body has a byte limit before JSON parsing', async t => {
  env(t);
  assert.equal((await POST(askRequest(client(), undefined, 'x'.repeat(4097)))).status, 413);
  assert.equal((await POST(askRequest(client(), undefined, '票'.repeat(1400)))).status, 413);
});

test('a late upstream result cannot resume diagnosis after the response timed out', async t => {
  env(t);
  let finish: (response: Response) => void = () => {};
  let calls = 0;
  t.mock.method(globalThis, 'fetch', () => { calls++; return new Promise<Response>(resolve => { finish = resolve; }); });
  const response = await GET(diagnosisRequest(), context());
  assert.equal(response.status, 504);
  finish(json(pool()));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1, 'No capacity read or additional Graph query after the deadline');
});

test('multiple model turns share the time already spent reading Graph', async t => {
  env(t, { ANTHROPIC_API_KEY: 'test-fixture-only', AGENT_ASK_TIMEOUT_MS: '500' });
  let modelCalls = 0, aborted = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), body = await request.json();
    const graph = new URL(request.url).hostname === 'graph.invalid';
    if (!graph) modelCalls++;
    await new Promise<void>((resolve, reject) => {
      const delay = setTimeout(resolve, 200);
      request.signal.addEventListener('abort', () => { clearTimeout(delay); aborted++; reject(request.signal.reason); }, { once: true });
    });
    if (graph) return json(pool());
    return json({ id: 'msg_fixture', type: 'message', role: 'assistant', model: body.model, stop_reason: 'tool_use', stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'tool_use', id: 'tool_fixture', name: 'pool_overview', input: {} }] });
  });
  const response = await POST(askRequest());
  assert.equal(response.status, 504);
  assert.equal((await response.json()).code, 'AgentRequestTimeout');
  assert.equal(modelCalls, 2, 'A fresh per-call timeout would incorrectly allow all four turns');
  assert.ok(aborted > 0);
});

test('expired budgets stop synchronous search before it can produce a diagnosis', async () => {
  let elapsed = 0;
  const budget = new RequestBudget(500, undefined, () => elapsed);
  const snapshot: Snapshot = { block, timestamp: now, deployment: 'QmFixture',
    intents: [{ ...intent, hash, committedTx: hash, committedAtBlock: 1n }], ticketMeta: new Map(), depositor: new Map(), excluded: [] };
  const capacity = { block, usdcBalance: new Map(), usdcAllowance: new Map() };
  elapsed = 501;
  try {
    await assert.rejects(diagnose(snapshot, hash, capacity, budget), { name: 'AgentRequestTimeout' });
    await assert.rejects(solveHypothetical(snapshot, { replaceHash: hash, intent }, capacity, budget), { name: 'AgentRequestTimeout' });
  } finally { budget.dispose(); }
});

test('an active combinatorial seat search observes the overall deadline', async t => {
  const target = { ...intent, exactCount: 20, sectionMask: (1n << 40n) - 1n, mustShareSection: true };
  const targetHash = hashIntent(target);
  const seller = { ...intent, owner: B, offered: Array.from({ length: 40 }, (_, n) => BigInt(n + 2)), exactCount: 0 };
  const snapshot: Snapshot = { block, timestamp: now, deployment: 'QmFixture', excluded: [],
    intents: [target, seller].map(i => ({ ...i, hash: hashIntent(i), committedTx: hash, committedAtBlock: 1n })),
    // Each offered ticket is in a different section: no 20-seat group can share a section.
    ticketMeta: new Map(seller.offered.map((id, sectionId) => [id, { eventId: 1, sessionId: 0, sectionId, row: 1, seat: 1, status: 0 }])),
    depositor: new Map(seller.offered.map(id => [id, B])),
  };
  // Advance the monotonic clock inside the active loop. Wall-clock scheduling
  // must not decide whether a busy CI worker reaches 256 iterations in 200 ms.
  let elapsed = 0, checks = 0;
  const budget = new RequestBudget(5000, undefined, () => elapsed);
  const original = budget.checkpoint.bind(budget);
  const checkpoint = t.mock.method(budget, 'checkpoint', () => {
    if (++checks === 512) elapsed = 5001;
    original();
  });
  try {
    await assert.rejects(diagnose(snapshot, targetHash, { block, usdcBalance: new Map(), usdcAllowance: new Map() }, budget), { name: 'AgentRequestTimeout' });
    assert.ok(checkpoint.mock.callCount() > 256, 'The seat-combination loop must have started');
  } finally { budget.dispose(); }
});

test('successful completion detaches caller cancellation and cancels unused sibling I/O', async () => {
  const caller = new AbortController(), budget = new RequestBudget(1000, caller.signal);
  assert.equal(await budget.run(async () => 'done'), 'done');
  budget.dispose();
  assert.equal(budget.signal.aborted, true);
  assert.equal(caller.signal.aborted, false);
});
