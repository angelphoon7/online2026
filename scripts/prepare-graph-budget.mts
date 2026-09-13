// Read-only rehearsal. No environment files, private keys, or transactions are used here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadDeployment } from './lib/deployment.mjs';
import { json } from './lib/graph-acceptance.mjs';

const deployment = loadDeployment('arc-testnet');
assert.ok(!fs.existsSync('.data/graph-budget/attempt.json'), 'A budget recording already exists. Use record-graph-budget.mjs --verify; do not overwrite its rehearsal or resend its transactions.');
process.env.SUBGRAPH_URL = deployment.raw.subgraphUrl;
process.env.ARC_RPC = deployment.rpc;
process.env.NEXT_PUBLIC_DEPLOYMENT = 'arc-testnet';
const { getPoolSnapshot } = await import('../shared/graph/index.js');
const { diagnose } = await import('../server/agent/diagnose.js');
const { readCapacity, solveHypothetical } = await import('../server/solve-hypothetical.js');
const snapshot = await getPoolSnapshot();
const capacity = await readCapacity(snapshot.intents.map(intent => intent.owner), snapshot.block);
const candidates = snapshot.intents.filter(intent => intent.owner.toLowerCase() === deployment.deployer.toLowerCase());
const { SEARCH_CONFIG } = await import('../server/solve.js');
console.log(`Public pool @ block ${snapshot.block}; ${candidates.length} intents owned by the deployment operator.`);
for (const intent of candidates.slice(0, 5)) {
  const before = await diagnose(snapshot, intent.hash, capacity);
  if (before.status !== 'SETTLEABLE') continue;
  // Even the largest signed debits from all other allowed legs cannot fund this floor.
  // This bound is specific to this snapshot and the published participant cap.
  const debitCeilings = snapshot.intents.filter(i => i.hash !== intent.hash && i.maxNetPay > 0n)
    .map(i => i.maxNetPay).sort((a, b) => a > b ? -1 : a < b ? 1 : 0);
  const otherLegCeiling = debitCeilings.slice(0, SEARCH_CONFIG.maxParticipants - 1).reduce((a, b) => a + b, 0n);
  const limit = -Number(otherLegCeiling / 1000000n + 1n);
  assert.ok(limit >= -40, 'Required rehearsal limit exceeds the visible control range');
  {
    const hypothetical = await solveHypothetical(snapshot, { replaceHash: intent.hash, intent: { ...intent, maxNetPay: BigInt(limit) * 1000000n } }, capacity);
    if (hypothetical.found) continue;
    const plan = { checkedAt: new Date().toISOString(), mode: 'READ_ONLY_HYPOTHETICAL', chainId: deployment.chainId, endpoint: deployment.raw.subgraphUrl, snapshotBlock: String(snapshot.block), intent, before, newMaxNetPayUsdc: String(limit), otherLegCeiling: String(otherLegCeiling), hypothetical: { ...hypothetical, candidatesExcluded: undefined, excludedCount: hypothetical.candidatesExcluded.length } };
    fs.mkdirSync('docs/checks', { recursive: true });
    fs.writeFileSync('docs/checks/graph-budget-plan.json', json(plan));
    console.log(json({ oldHash: intent.hash, commitTx: intent.committedTx, before: before.status, previousMaxNetPay: String(intent.maxNetPay), nextLimitUsdc: limit, hypotheticalFound: hypothetical.found, termination: hypothetical.termination }));
    process.exit(0);
  }
}
assert.fail('No demonstrable budget change found in the first five operator intents; no transaction was sent.');
