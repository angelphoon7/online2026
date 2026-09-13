// Local documentation/configuration checks. Does not load private env files or call services.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const json = name => JSON.parse(read(name));
let checks = 0;
const check = (ok, message) => { assert.ok(ok, message); checks++; };

try {
  const installedDependencies = spawnSync('git', ['ls-files', 'solver/node_modules'], { cwd: root, encoding: 'utf8' });
  check(installedDependencies.status === 0 && installedDependencies.stdout.trim() === '', 'Generated solver/node_modules must not be tracked; install from solver/package-lock.json');
  const dependencyIgnore = spawnSync('git', ['check-ignore', '--no-index', '-q', 'solver/node_modules/.bin/vitest'], { cwd: root });
  check(dependencyIgnore.status === 0, 'solver/node_modules must be ignored on every operating system');
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '.env.example'], { cwd: root, encoding: 'utf8' });
  check(tracked.status === 0, '.env.example must be tracked so a teammate receives it');
  const ignored = spawnSync('git', ['check-ignore', '--no-index', '-q', '.env.example'], { cwd: root });
  check(ignored.status === 1, '.env.example must not be ignored');
  const template = read('.env.example'), env = parseEnv(template);
  const deployment = json('deployments/arc-testnet.json');
  const expected = { DEPLOYMENT: 'arc-testnet', NEXT_PUBLIC_DEPLOYMENT: 'arc-testnet',
    ARC_CHAIN_ID: String(deployment.chainId), ARC_RPC: deployment.rpc, USDC_ADDRESS: deployment.usdc,
    SUBGRAPH_URL: deployment.subgraphUrl, READ_SOURCE: 'graph' };
  for (const [key, value] of Object.entries(expected)) check(env[key] === value, `Template ${key} must agree with the deployment`);
  for (const key of ['SUBGRAPH_API_KEY', 'SUBGRAPH_DEPLOY_KEY', 'ANTHROPIC_API_KEY', 'PRIVATE_KEY',
    'DEMO_ISSUER_PRIVATE_KEY', 'SEED_B_PRIVATE_KEY', 'SEED_C_PRIVATE_KEY', 'JUDGE_ACCESS_CODE',
    'REDIS_REST_TOKEN', 'ARC_MAINNET_PRIVATE_KEY']) check(env[key] === '', `Template ${key} must be present and empty`);
  check(!/sk-ant-|0x[a-f0-9]{64}\b/i.test(template), 'Template contains a credential-like value');
  for (const key of ['AGENT_RATE_LIMIT_STORE', 'AGENT_IP_SOURCE']) check(env[key] === 'auto', `Template must include ${key}=auto`);
  for (const key of ['JUDGE_CONTROLS_ENABLED', 'DEMO_TICKETS_ENABLED']) check(env[key] === 'false', 'Template signing features must be disabled');
  check(!Object.keys(env).some(key => /^NEXT_PUBLIC_(TICKET_NFT|ESCROW|INTENT_REGISTRY|SETTLEMENT|USDC|CHAIN_ID|DEPLOYMENT_BLOCK)$/.test(key)), 'Retired deployment overrides must not reappear');

  // Exercise the teammate command in a new directory, then protect an existing local file.
  const tempParent = fs.realpathSync(os.tmpdir());
  const temp = fs.mkdtempSync(path.join(tempParent, 'reshuffle-env-check-'));
  try {
    fs.copyFileSync(path.join(root, '.env.example'), path.join(temp, '.env.example'));
    const setup = () => spawnSync(process.execPath, [path.join(root, 'scripts/setup-env.mjs')], { cwd: temp, encoding: 'utf8' });
    check(setup().status === 0, 'Fresh setup must succeed');
    check(fs.readFileSync(path.join(temp, '.env.local'), 'utf8') === template, 'Fresh setup must copy the template exactly');
    const judge = () => spawnSync(process.execPath, [path.join(root, 'scripts/judge-setup.mjs'), path.join(root, 'deployments/circle-inventory-sep12.json')], {
      cwd: temp, encoding: 'utf8', env: { ...process.env, JUDGE_ACCESS_CODE: '', JUDGE_ALLOWED_INTENT_HASHES: '', JUDGE_CONTROLS_ENABLED: '', DEMO_TICKETS_ENABLED: '' },
    });
    check(judge().status === 0, 'Judge setup must accept a freshly copied template');
    const prepared = fs.readFileSync(path.join(temp, '.env.local'), 'utf8'), judging = parseEnv(prepared);
    check(judging.JUDGE_ACCESS_CODE.length >= 24, 'Judge setup must fill an empty access-code placeholder');
    check(judging.JUDGE_ALLOWED_INTENT_HASHES.split(',').every(hash => /^0x[a-f0-9]{64}$/i.test(hash)), 'Judge setup must fill exact intent scope');
    check(judging.JUDGE_CONTROLS_ENABLED === 'false' && judging.DEMO_TICKETS_ENABLED === 'false', 'Judge setup must preserve explicitly disabled features');
    check(judge().status === 0 && fs.readFileSync(path.join(temp, '.env.local'), 'utf8') === prepared, 'Repeated judge setup must preserve the code and scope');
    const existing = 'DEPLOYMENT=existing-local-fixture\n';
    fs.writeFileSync(path.join(temp, '.env.local'), existing);
    check(setup().status === 0, 'Repeated setup must succeed');
    check(fs.readFileSync(path.join(temp, '.env.local'), 'utf8') === existing, 'Setup must preserve existing configuration');
  } finally {
    const target = fs.realpathSync(temp);
    assert.equal(path.dirname(target), tempParent);
    assert.ok(path.basename(target).startsWith('reshuffle-env-check-'));
    fs.rmSync(target, { recursive: true });
  }

  const docs = ['README.md', 'server/README.md', 'docs/JUDGING_SETUP.md', 'docs/STEP_11_REVIEW.md',
    'docs/THE_GRAPH_SUBMISSION.md', 'docs/GRAPH_7A_7D.md', 'docs/GRAPH_7G_7H.md', 'docs/GRAPH_7I.md',
    'docs/GRAPH_STUDIO_REVIEW.md', 'docs/CIRCLE_INTEGRATION.md', 'docs/SUBGRAPH_STUDIO_ARC_CHECK.md',
    'docs/SUBMISSION_STATUS.md', 'docs/PROVENANCE.md', 'docs/PLANNING_ARTIFACTS.md'];
  for (const name of docs) {
    const source = read(name);
    for (const match of source.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
      const href = match[1].replace(/^<|>$/g, '');
      if (/^(?:[a-z]+:|#)/i.test(href)) continue;
      const local = decodeURIComponent(href.split('#')[0]);
      check(fs.existsSync(path.resolve(root, path.dirname(name), local)), `${name}: missing linked file ${local}`);
    }
    for (const stale of ['Payment capacity and closed-intent lookups have separate read timing',
      'live model acceptance remains pending', 'its local preflight records `BLOCKED`',
      'Step 10 evidence needs real writes and UI capture', 'our own subgraph deployment remains pending']) {
      check(!source.includes(stale), `${name}: superseded finding reappeared`);
    }
  }
  const model = json('docs/checks/graph-agent-model.json');
  check(model.status === 'PASS' && model.mocked === false && model.records.length === 4, 'Real-provider PASS needs four actual scenarios');
  check(model.modelRequests > 0 && model.transactionsSent === 0, 'Provider acceptance must contain calls and no transactions');
  const receipts = model.records.flatMap(record => record.modelReceipts);
  check(receipts.length === model.modelRequests && new Set(receipts.map(r => r.requestId)).size === receipts.length, 'Provider request provenance must match the call count');
  for (const record of model.records) {
    check(record.httpStatus === 200 && record.response.answer.startsWith(`At Arc Testnet block #${record.response.block}, `), 'Recorded answer must open with its evidence block');
    for (const receipt of record.modelReceipts) check(receipt.messageId && receipt.requestId && receipt.inputTokens > 0 && receipt.outputTokens > 0, 'Provider receipt must contain IDs and usage');
  }
  const budget = json('docs/checks/graph-budget/summary.json');
  check(budget.status === 'PASS' && budget.receipts.length === 2, 'Budget completion needs two recorded receipts');
  check(budget.receipts.every(r => r.status === 'success'), 'Both budget receipts must have succeeded');
  check(budget.change.revokeTx !== budget.change.commitTx && budget.receipts.some(r => r.hash === budget.change.revokeTx)
    && budget.receipts.some(r => r.hash === budget.change.commitTx), 'Revoke and commit must reference their own receipt');
  check(budget.drawerFollowsNewHash && budget.oldPoolAndAnswerHiddenWhileIndexing && budget.laterRequestsRetainReceiptFloor, 'Budget UI completion needs its recorded freshness checks');
  check(json('docs/checks/graph-diagnosis-block.json').status === 'PASS', 'Same-block diagnosis requires its acceptance record');
  console.log(`PASS ${checks} documentation/setup checks. Existing env files untouched; no provider calls or transactions.`);
} catch (error) {
  console.error(`FAIL documentation/setup: ${error.message}`);
  process.exitCode = 1;
}
