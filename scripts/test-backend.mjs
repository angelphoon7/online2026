import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const base = process.env.SOLVE_API_URL ?? 'http://127.0.0.1:3101';
const deployment = JSON.parse(fs.readFileSync('deployments/arc-testnet.json', 'utf8'));
const evidence = JSON.parse(fs.readFileSync('deployments/settlements/01.json', 'utf8'));
const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('rejects malformed input before chain access', async () => {
  const response = await post('/api/solve', { intentHashes: ['bad'] });
  assert.equal(response.status, 400);
});
test('rejects duplicate intents', async () => {
  const hash = deployment.seed.intents[0].hash;
  assert.equal((await post('/api/solve', { intentHashes: [hash, hash] })).status, 400);
});
test('rejects requests beyond the bounded participant pool', async () => {
  const hashes = Array.from({ length: 5 }, (_, i) => `0x${String(i).padStart(64, '0')}`);
  assert.equal((await post('/api/solve', { intentHashes: hashes })).status, 400);
});
test('rejects oversized bodies', async () => {
  assert.equal((await post('/api/solve', { padding: 'x'.repeat(2100) })).status, 413);
});
test('returns persisted confirmed evidence', async () => {
  const response = await fetch(`${base}/api/evidence/${evidence.id}`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.transactionHash, evidence.transactionHash);
  assert.equal(data.receipt.confirmed, true);
});
test('refuses an unrelated successful transaction as settlement proof', async () => {
  const response = await post(`/api/evidence/${evidence.id}/receipt`, { transactionHash: deployment.transactions[0].hash });
  assert.equal(response.status, 409);
});
test('revalidates settled intents instead of replaying a saved solution', async () => {
  const response = await post('/api/solve', { intentHashes: deployment.seed.intents.map(i => i.hash), maxNetPay: '999999999' });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.proposal, null);
  assert.equal(data.candidatesFound, 0);
  assert.equal(data.transaction, undefined);
  assert.equal(data.candidatesExcluded.filter(e => e.reason.includes('IntentNotLive')).length, 3);
});
test('uses live signed budgets despite client overrides and returns a simulated proposal', async () => {
  const ready = JSON.parse(fs.readFileSync('deployments/demo-ready.json', 'utf8'));
  const response = await post('/api/solve', { intentHashes: ready.intents.map(i => i.hash), maxNetPay: '999999999' });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.simulationResult.success, true);
  assert.equal(data.transaction.chainId, 5042002);
  assert.equal(data.proposal.intents.length, 3);
  for (const intent of data.proposal.intents) {
    const signed = ready.intents.find(i => i.owner.toLowerCase() === intent.owner.toLowerCase());
    assert.equal(intent.maxNetPay, signed.maxNetPay);
  }
});
