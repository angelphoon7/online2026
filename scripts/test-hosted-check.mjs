import test from 'node:test';
import assert from 'node:assert/strict';
import { checkHosted, publicOrigin } from './lib/hosted-check.mjs';

const hashes = ['a', 'b', 'c'].map(c => `0x${c.repeat(64)}`);
const diagnosis = { intent: hashes[0], block: '102', sentence: 'At Arc Testnet block #102, fixture diagnosis.' };
function fixture(overrides = {}) {
  const solve = { id: 'fixture-id', snapshotBlock: '101', source: { kind: 'subgraph', snapshotBlock: '101' },
    requestedIntentHashes: hashes, proposal: { intents: hashes }, simulationResult: { success: true } };
  const values = {
    '/api/health': { ready: true, storage: 'redis', checks: { agentRateLimit: true } },
    '/api/demo/scenarios': { source: 'subgraph', snapshotBlock: '100', groups: [{ available: true, hashes }] },
    '/api/solve': solve, '/api/evidence/fixture-id': solve,
    [`/api/agent/diagnose/${hashes[0]}`]: diagnosis,
    '/api/agent/ask': { model: 'fixture', modelCalls: [{ messageId: 'msg_fixture', requestId: 'req_fixture', inputTokens: 1, outputTokens: 1 }],
      block: '102', answer: diagnosis.sentence, guardFallback: false,
      evidence: [{ tool: 'diagnose_intent', source: 'model', output: diagnosis }] }, ...overrides,
  };
  return async input => {
    const pathname = new URL(input).pathname;
    if (pathname === '/') return new Response('<title>RESHUFFLE</title>', { headers: { 'content-type': 'text/html' } });
    if (pathname === '/api/demo/budget') return Response.json({}, { status: 401 });
    assert.ok(Object.hasOwn(values, pathname), `Unexpected endpoint: ${pathname}`);
    return Response.json(values[pathname]);
  };
}
test('hosted check refuses localhost, credentials and non-HTTPS origins', () => {
  for (const origin of ['http://reshuffle.app', 'https://localhost', 'https://127.0.0.1', 'https://app.local', 'https://user:secret@reshuffle.app', 'https://reshuffle.app/api']) {
    assert.throws(() => publicOrigin(origin));
  }
});
test('hosted fixtures cannot become public acceptance', async () => {
  const report = await checkHosted('https://reshuffle.app', { model: true, transport: fixture() });
  assert.equal(report.status, 'PASS_FIXTURE');
  assert.equal(report.mocked, true);
  assert.equal(report.transactionsSent, 0);
});
test('hosted check rejects a no-model answer instead of certifying provider access', async () => {
  const report = await checkHosted('https://reshuffle.app', { model: true, transport: fixture({ '/api/agent/ask': { model: null, guardFallback: true } }) });
  assert.equal(report.status, 'FAILED');
  assert.match(report.error, /no-model response/);
});
test('hosted check rejects mismatched evidence and stale diagnosis', async () => {
  for (const overrides of [{ '/api/evidence/fixture-id': { id: 'different' } },
    { [`/api/agent/diagnose/${hashes[0]}`]: { ...diagnosis, intent: hashes[1] } },
    { [`/api/agent/diagnose/${hashes[0]}`]: { ...diagnosis, block: '99' } }]) {
    assert.equal((await checkHosted('https://reshuffle.app', { transport: fixture(overrides) })).status, 'FAILED');
  }
});

test('hosted check refuses failed production readiness', async () => {
  for (const health of [{ ready: false, storage: 'redis', checks: { agentRateLimit: true } },
    { ready: true, storage: 'file', checks: { agentRateLimit: true } },
    { ready: true, storage: 'redis', checks: { agentRateLimit: false } }]) {
    const report = await checkHosted('https://reshuffle.app', { transport: fixture({ '/api/health': health }) });
    assert.equal(report.status, 'FAILED');
    assert.equal(report.checks.length, 2);
  }
});

test('hosted check retains the actual failed readiness response', async () => {
  const health = { ready: false, storage: null, checks: { storage: false, agentRateLimit: false } };
  const read = fixture();
  const report = await checkHosted('https://reshuffle.app', { transport: input =>
    new URL(input).pathname === '/api/health' ? Response.json(health, { status: 503 }) : read(input) });
  assert.equal(report.status, 'FAILED');
  assert.equal(report.checks[1].httpStatus, 503);
  assert.deepEqual(report.evidence.health, health);
});

test('hosted check rejects model fallback, conflicting blocks and another intent', async () => {
  const response = { model: 'fixture', modelCalls: [{ messageId: 'msg_fixture', requestId: 'req_fixture', inputTokens: 1, outputTokens: 1 }],
    block: '102', answer: diagnosis.sentence, guardFallback: false,
    evidence: [{ tool: 'diagnose_intent', source: 'model', output: diagnosis }] };
  for (const changes of [{ guardFallback: true }, { answer: 'At Arc Testnet block #101, wrong block.' },
    { evidence: [{ tool: 'diagnose_intent', source: 'model', output: { ...diagnosis, intent: hashes[1] } }] },
    { evidence: [...response.evidence, { tool: 'pool_overview', source: 'model', output: { block: '101' } }] }]) {
    const report = await checkHosted('https://reshuffle.app', { model: true,
      transport: fixture({ '/api/agent/ask': { ...response, ...changes } }) });
    assert.equal(report.status, 'FAILED');
  }
});
