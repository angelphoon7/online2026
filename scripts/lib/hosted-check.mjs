import assert from 'node:assert/strict';
import { isIP } from 'node:net';

export function publicOrigin(value) {
  const url = new URL(value);
  assert.ok(url.protocol === 'https:' && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash, 'Use the public HTTPS origin without credentials or paths');
  assert.ok(url.hostname.includes('.') && !isIP(url.hostname) && !/(^|\.)(localhost|local|test|invalid|example)$/.test(url.hostname), 'A local/test address cannot establish public acceptance');
  return url;
}

/** Injected HTTP is for regression fixtures and can never yield a public PASS. */
export async function checkHosted(origin, { model = false, transport } = {}) {
  const base = publicOrigin(origin), http = transport ?? fetch;
  const report = { checkedAt: new Date().toISOString(), origin: base.origin, frontendUrl: `${base.origin}/`,
    backendUrl: `${base.origin}/api`, status: 'FAILED', mocked: !!transport, modelRequested: model,
    transactionsSent: 0, checks: [], evidence: {},
    scope: 'Anonymous HTTP frontend, Graph solver/simulation, saved evidence, diagnosis and judge-access checks; no wallet writes, restart or laptop-off claim.' };
  const request = async (pathname, init = {}) => {
    const response = await http(new URL(pathname, base), { ...init, redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(120_000), headers: { 'content-type': 'application/json', ...init.headers } });
    report.checks.push({ path: pathname, httpStatus: response.status });
    return response;
  };
  const read = async (pathname, init) => {
    const response = await request(pathname, init);
    assert.ok(response.ok, `${pathname}: HTTP ${response.status}`);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/, `${pathname}: expected an API response, not a login page`);
    return response.json();
  };
  try {
    const front = await request('/');
    assert.ok(front.ok, 'Public frontend did not return success');
    assert.match(front.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await front.text(), /RESHUFFLE/i, 'Frontend is not the expected app');
    const healthResponse = await request('/api/health');
    assert.match(healthResponse.headers.get('content-type') ?? '', /application\/json/, 'Readiness endpoint did not return JSON');
    const health = await healthResponse.json();
    report.evidence.health = health;
    assert.ok(healthResponse.ok, `/api/health: HTTP ${healthResponse.status}`);
    assert.equal(health.ready, true, 'Hosted readiness checks must all pass');
    assert.equal(health.storage, 'redis', 'This hosted acceptance requires shared Redis storage');
    assert.equal(health.checks?.agentRateLimit, true, 'Production Agent admission was not verified');
    const catalog = await read('/api/demo/scenarios');
    assert.equal(catalog.source, 'subgraph');
    const group = catalog.groups.find(g => g.available);
    assert.ok(group && group.hashes.length === 3, 'No available judging group');
    const minBlock = String(catalog.snapshotBlock), intentHash = group.hashes[0];
    assert.match(minBlock, /^\d+$/);
    const result = await read('/api/solve', { method: 'POST', body: JSON.stringify({ intentHashes: group.hashes, minBlock }) });
    assert.equal(result.source?.kind, 'subgraph');
    assert.equal(result.snapshotBlock, result.source.snapshotBlock);
    assert.ok(BigInt(result.snapshotBlock) >= BigInt(minBlock));
    assert.deepEqual([...result.requestedIntentHashes].sort(), [...group.hashes].sort());
    assert.equal(result.proposal?.intents?.length, 3);
    assert.equal(result.simulationResult?.success, true);
    const evidencePath = '/api/evidence/' + encodeURIComponent(result.id);
    assert.deepEqual(await read(evidencePath), result, 'Saved evidence does not match the solver response');
    report.evidence.solver = { id: result.id, url: new URL(evidencePath, base).href, snapshotBlock: result.snapshotBlock,
      intentHashes: group.hashes, simulation: result.simulationResult, source: result.source };
    const diagnosis = await read(`/api/agent/diagnose/${intentHash}?minBlock=${result.snapshotBlock}`);
    assert.equal(diagnosis.intent?.toLowerCase(), intentHash.toLowerCase());
    assert.ok(BigInt(diagnosis.block) >= BigInt(result.snapshotBlock));
    assert.ok(diagnosis.sentence.startsWith(`At Arc Testnet block #${diagnosis.block}, `));
    report.evidence.diagnosis = diagnosis;
    if (model) {
      const answer = await read('/api/agent/ask', { method: 'POST', body: JSON.stringify({ intentHash,
        minBlock: diagnosis.block, question: 'Diagnose this selected intent using the indexed evidence.' }) });
      assert.ok(answer.model && answer.modelCalls?.length, 'A no-model response is not hosted provider acceptance');
      assert.equal(answer.guardFallback, false, 'Hosted nominal question must pass the model guard');
      assert.ok(BigInt(answer.block) >= BigInt(diagnosis.block));
      assert.ok(answer.answer.startsWith(`At Arc Testnet block #${answer.block}, `));
      assert.ok(answer.modelCalls.every(c => c.requestId && c.messageId && c.inputTokens > 0 && c.outputTokens > 0));
      assert.ok(answer.evidence.some(e => e.tool === 'diagnose_intent' && e.source === 'model'
        && e.output.intent?.toLowerCase() === intentHash.toLowerCase() && e.output.block === answer.block));
      assert.ok(answer.evidence.every(e => !e.output?.block || e.output.block === answer.block));
      report.evidence.model = answer;
    }
    assert.equal((await request('/api/demo/budget')).status, 401, 'Judge access must reject anonymous visitors');
    report.status = transport ? 'PASS_FIXTURE' : 'PASS_PUBLIC_HTTP';
  } catch (error) {
    report.error = error instanceof assert.AssertionError ? error.message : error.name;
  }
  return report;
}
