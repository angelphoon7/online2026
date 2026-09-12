// Assert recorded observations; this command has no network or signing path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { json } from './lib/graph-acceptance.mjs';

const dir = 'docs/checks/graph-budget';
const live = JSON.parse(fs.readFileSync(`${dir}/live.json`, 'utf8'));
const verified = JSON.parse(fs.readFileSync(`${dir}/verification.json`, 'utf8'));
const change = live.change, floor = BigInt(change.commitBlock);
assert.equal(verified.status, 'PASS_REAL_TRANSACTIONS_AND_BROWSER');
assert.deepEqual(verified.change, change);
assert.equal(live.mocked, false);
assert.equal(verified.mocked, false);
assert.equal(live.videoSpeed, 1);
assert.equal(verified.videoSpeed, 1);
assert.equal(live.requests.filter(r => r.path === '/api/demo/budget' && r.method === 'POST').length, 1);
assert.equal(verified.requests.filter(r => r.path === '/api/demo/budget' && r.method === 'POST').length, 0);
const start = live.observations.findIndex(o => o.live === `Indexing block #${floor}\u2026`);
assert.ok(start >= 0, 'Indexing frame was not observed');
const end = live.observations.findIndex((o, n) => n > start && !o.workspaceHidden);
assert.ok(end > start, 'No refreshed workspace observed');
for (const o of live.observations.slice(start, end)) {
  assert.equal(o.workspaceHidden, true);
  assert.equal(o.answer, '', 'An old answer remained visible during indexing');
}
const indexed = live.observations.slice(end).find(o => /BLOCK #\d+/.test(o.live));
assert.ok(indexed && BigInt(indexed.live.match(/BLOCK #(\d+)/)[1]) >= floor);
const laterRequests = live.requests.filter(r => Date.parse(r.at) >= Date.parse(live.budgetResponseAt));
for (const request of laterRequests) {
  const url = new URL(request.path, 'http://localhost');
  const minBlock = request.body?.minBlock ?? url.searchParams.get('minBlock');
  assert.ok(minBlock !== null && minBlock !== undefined && BigInt(minBlock) >= floor, `Missing receipt floor: ${request.path}`);
}
assert.ok(laterRequests.some(r => r.path.includes(`/diagnose/${change.newHash}?minBlock=${floor}`)));
assert.equal(live.before.evidence[0].output.status, 'SETTLEABLE');
assert.equal(verified.after.evidence[0].output.status, 'NOT_FOUND_WITHIN_BOUND');
assert.equal(verified.after.evidence[0].output.intent, change.newHash);
assert.ok(BigInt(verified.after.block) >= floor);
assert.ok(verified.after.answer.startsWith(`At Arc Testnet block #${verified.after.block}`));
const evidence = verified.after.evidence[0].output;
assert.ok(evidence.supply.stages.every(stage => stage.remaining > 0));
assert.ok(evidence.relaxations.some(r => r.change === 'maxNetPay->cap' && r.found && r.binding));
assert.ok(evidence.relaxations.some(r => r.change === 'mustBeAdjacent=false' && !r.found));
assert.equal(verified.receipts.length, 2);
assert.ok(verified.receipts.every(receipt => receipt.status === 'success'));
assert.equal(verified.indexed.old.state, 'REVOKED');
assert.equal(verified.indexed.next.state, 'LIVE');
const summary = {
  checkedAt: new Date().toISOString(), status: 'PASS', steps: ['6-D', '8 (Apply budget)', '10-B'],
  change, receipts: verified.receipts,
  beforeBlock: live.before.block, commitBlock: String(floor), firstDrawerBlockAfterIndexing: indexed.live.match(/BLOCK #(\d+)/)[1], afterAnswerBlock: verified.after.block,
  observedUiIndexingMs: Date.parse(live.observations[end].at) - Date.parse(live.observations[start].at),
  oldPoolAndAnswerHiddenWhileIndexing: true, laterRequestsRetainReceiptFloor: true, drawerFollowsNewHash: true,
  beforeStatus: live.before.evidence[0].output.status, afterStatus: evidence.status,
  recording: { speed: 1, clips: [live.video, verified.video], note: 'The first recording captured transactions and indexing, then an agent read returned HTTP 503. The second is a read-only retry on the same new hash. No transaction was repeated.' },
};
fs.writeFileSync(`${dir}/summary.json`, json(summary));
console.log(`PASS: Step 6-D two real receipts and new nonce/hash; Step 8 observed receipt floor and hidden stale pool; Step 10-B block/answer change and budget evidence. UI indexing wait ${summary.observedUiIndexingMs} ms.`);
