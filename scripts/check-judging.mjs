import assert from 'node:assert/strict';
const target = process.argv[2];
if (!target || process.argv.length > 3) throw new Error('Use npm run judge:check -- https://your-running-backend.example');
const base = new URL(target);
if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Provide the public app origin, without credentials.');
const read = async (path, init = {}) => {
  const response = await fetch(new URL(path, base), { ...init, signal: AbortSignal.timeout(120_000) });
  const value = await response.json();
  assert.equal(response.ok, true, 'Failed ' + path + ': ' + JSON.stringify(value));
  return value;
};
const health = await read('/api/health');
assert.equal(health.ready, true, 'Backend capability check failed');
const state = await read('/api/demo/scenarios');
assert.equal(state.source, 'subgraph');
assert.ok(state.groups.length >= 1);
for (const group of state.groups) {
  assert.equal(group.available, true, group.name + ' is unavailable');
  for (const indices of [[0, 1], [0, 2], [1, 2], [0, 1, 2]]) {
    const hashes = indices.map(i => group.hashes[i]);
    const result = await read('/api/solve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intentHashes: hashes, minBlock: state.snapshotBlock }) });
    assert.equal(result.source.kind, 'subgraph');
    assert.ok(BigInt(result.source.snapshotBlock) >= BigInt(state.snapshotBlock));
    assert.deepEqual([...result.requestedIntentHashes].sort(), [...hashes].sort());
    if (indices.length === 3) {
      assert.ok(result.proposal, group.name + ' has no three-way candidate');
      assert.equal(result.simulationResult?.success, true, group.name + ' simulation failed');
      assert.equal(result.proposal.intents.length, 3, 'Expected three participants');
    } else {
      assert.ok(!result.proposal, group.name + ' unexpectedly has a direct swap');
      assert.equal(result.candidates.length, 0);
      assert.equal(result.search.termination, 'complete', 'A bounded timeout is not proof of pair rejection');
    }
    const saved = await read('/api/evidence/' + result.id);
    assert.deepEqual(saved, result, 'Saved evidence differs from solver response');
    console.log('PASS ' + group.name + ' ' + indices.map(i => 'ABC'[i]).join('+') + ' / evidence ' + result.id);
  }
}
const auth = await fetch(new URL('/api/demo/budget', base), { signal: AbortSignal.timeout(15_000) });
assert.equal(auth.status, 401, 'Anonymous users must not access judge controls');
console.log('PASS: live Graph matching, pair rejection, three-way simulations, saved evidence and anonymous denial. No transactions were broadcast.');
console.log('Run this from another computer with the laptop off, then repeat after restarting the hosted backend. Test wallet settlement and judge changes separately.');
