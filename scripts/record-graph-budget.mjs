// Real browser + real Arc Testnet APIs. --check is read-only; --record clicks once.
// Never mock requests or speed up the video. A journal prevents duplicate broadcasts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { chromium, expect as baseExpect } from '@playwright/test';
import { createPublicClient, http, decodeFunctionData, formatEther, parseEther } from 'viem';
import { hashIntent } from '../solver/dist/hash.js';
import abis from '../server/abis.json' with { type: 'json' };
import { loadDeployment } from './lib/deployment.mjs';
import { json, queryGraph } from './lib/graph-acceptance.mjs';
const expect = baseExpect.configure({ timeout: 90000 });

const mode = process.argv[2] ?? '--check';
assert.ok(['--check', '--record', '--verify'].includes(mode), 'Use --check, --record or --verify (read-only recovery)');
const plan = JSON.parse(fs.readFileSync('docs/checks/graph-budget-plan.json', 'utf8'));
const d = loadDeployment('arc-testnet');
assert.equal(d.chainId, 5042002);
assert.equal(plan.chainId, d.chainId);
assert.equal(plan.endpoint, d.raw.subgraphUrl);
assert.equal(plan.intent.owner.toLowerCase(), d.deployer.toLowerCase());
assert.ok(fs.existsSync('.next/BUILD_ID'), 'Run npm run build first');
const journal = '.data/graph-budget/attempt.json';
assert.ok(mode === '--verify' || !fs.existsSync(journal), 'A prior Apply budget attempt exists. Use --verify to check its receipts without repeating it.');
const original = mode === '--verify' ? JSON.parse(fs.readFileSync('docs/checks/graph-budget/live.json', 'utf8')) : null;
if (original) assert.ok(original.change?.newHash && original.change?.commitTx, 'No completed replacement exists to verify');
const targetHash = original?.change.newHash ?? plan.intent.hash;
const targetCommit = original?.change.commitTx ?? plan.intent.committedTx;
const client = createPublicClient({ transport: http(d.rpc, { timeout: 20000, retryCount: 2 }) });
const registry = d.contracts.IntentRegistry.address;
const registryRead = (functionName, args) => client.readContract({ address: registry, abi: abis.IntentRegistry, functionName, args });
assert.equal(await client.getChainId(), 5042002);
assert.equal(await registryRead('state', [targetHash]), 1, 'Target intent is no longer LIVE');
const [gasPrice, balance, latestNonce, pendingNonce] = await Promise.all([
  client.getGasPrice(), client.getBalance({ address: d.deployer }),
  client.getTransactionCount({ address: d.deployer, blockTag: 'latest' }),
  client.getTransactionCount({ address: d.deployer, blockTag: 'pending' }),
]);
if (mode !== '--verify') {
  assert.equal(latestNonce, pendingNonce, 'Operator has pending transactions');
  assert.ok(gasPrice * 600000n < parseEther('0.05'), 'Current gas quote exceeds the recording budget');
  assert.ok(balance > gasPrice * 600000n, 'Insufficient native test USDC');
  await client.simulateContract({ account: d.deployer, address: registry, abi: abis.IntentRegistry, functionName: 'revoke', args: [plan.intent.hash], gas: 200000n });
}

const probe = net.createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, READ_SOURCE: 'graph', SUBGRAPH_URL: d.raw.subgraphUrl, ARC_RPC: d.rpc, ARC_CHAIN_ID: String(d.chainId), NEXT_PUBLIC_DEPLOYMENT: 'arc-testnet', ANTHROPIC_API_KEY: '', JUDGE_CONTROLS_ENABLED: mode === '--verify' ? 'false' : 'true' },
});
const exited = once(child, 'exit');
let output = '', browser, context, page, video;
child.stdout.on('data', data => { output += data.toString(); });
child.stderr.on('data', data => { output += data.toString(); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { startedAt: new Date().toISOString(), mode, endpoint: d.raw.subgraphUrl, chainId: d.chainId, mocked: false, videoSpeed: 1, modelConfigured: false, preflight: { transactionNonce: latestNonce, quotedGasPrice: String(gasPrice) }, requests: [], observations: [] };
if (original) { report.before = original.before; report.change = original.change; report.readOnlyContinuationOf = 'live.json'; }
const dir = 'docs/checks/graph-budget';
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync('.data/graph-budget/video', { recursive: true });
const save = () => fs.writeFileSync(`${dir}/${mode === '--record' ? 'live' : mode === '--verify' ? 'verification' : 'readiness'}.json`, json(report));
try {
  const started = performance.now();
  while (!output.includes('Ready in')) {
    assert.ok(child.exitCode === null, 'Isolated server stopped before readiness');
    assert.ok(performance.now() - started < 30000, 'Server readiness timeout');
    await sleep(100);
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, serviceWorkers: 'block', ...(mode !== '--check' ? { recordVideo: { dir: '.data/graph-budget/video', size: { width: 1600, height: 1000 } } } : {}) });
  page = await context.newPage();
  page.setDefaultTimeout(90000);
  video = page.video();
  // Observe DOM transitions without changing the app state or network responses.
  await page.addInitScript(() => {
    window.budgetObservations = [];
    let previous = '';
    new MutationObserver(() => {
      const live = document.querySelector('.agent-live')?.textContent ?? '';
      const answer = document.querySelector('.agent-answer > p')?.textContent ?? '';
      const stack = document.querySelector('.workspace-stack');
      const hidden = !stack || !stack.getClientRects().length;
      const current = JSON.stringify({ live, answer, hidden });
      if (current !== previous) { previous = current; window.budgetObservations.push({ at: new Date().toISOString(), live, answer, workspaceHidden: hidden }); }
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  page.on('request', request => {
    const url = new URL(request.url());
    if (['/api/market', '/api/demo/budget', '/api/agent/ask'].includes(url.pathname) || url.pathname.startsWith('/api/agent/diagnose/')) {
      report.requests.push({ at: new Date().toISOString(), method: request.method(), path: url.pathname + url.search, body: request.method() === 'POST' ? request.postDataJSON() : undefined });
    }
  });
  console.log('Opening the real workspace and selecting the rehearsed intent.');
  // Next normalises loopback request URLs to localhost; use that public origin too.
  await page.goto(`http://localhost:${port}/#workspace`);
  await expect(page.locator('.workspace-section').getByText(/ARC BLOCK \d+/)).toBeVisible();
  await page.getByRole('button', { name: /Intent pool \(/ }).click();
  const row = page.locator('.pool-row').filter({ has: page.locator(`a[href$="${targetCommit}"]`) });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Why no match?', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Settlement agent' });
  await expect(drawer.locator('.agent-live')).toHaveText(/BLOCK #\d+/);
  const question = "Why can't this intent settle?";
  async function ask(attempt = 0) {
    const pending = page.waitForResponse(r => new URL(r.url()).pathname === '/api/agent/ask' && r.request().method() === 'POST', { timeout: 180000 });
    await drawer.getByRole('button', { name: question, exact: true }).click();
    const response = await pending;
    if (response.status() === 503 && attempt < 2) {
      (report.readRetries ??= []).push({ at: new Date().toISOString(), status: 503 });
      console.log('Agent read returned 503; retrying the question only, without resubmitting a transaction.');
      await sleep(2000);
      return ask(attempt + 1);
    }
    assert.equal(response.status(), 200);
    const answer = await response.json();
    await expect(drawer.locator('.agent-answer > p').first()).toHaveText(answer.answer);
    assert.ok(answer.answer.startsWith(`At Arc Testnet block #${answer.block}`));
    assert.equal(answer.model, null);
    assert.equal(answer.evidence[0].output.block, answer.block);
    await sleep(1500); // A visible held beat at real speed.
    return answer;
  }
  if (mode !== '--verify') {
    report.before = await ask();
    assert.equal(report.before.evidence[0].output.intent, plan.intent.hash);
    assert.equal(report.before.evidence[0].output.status, 'SETTLEABLE', 'Live answer no longer matches rehearsal');
    await page.getByText('Judge controls / change a signed condition', { exact: true }).click();
    await page.getByLabel('Participant intent', { exact: true }).selectOption(plan.intent.hash);
    await page.getByLabel('New signed limit (USDC)', { exact: true }).fill(plan.newMaxNetPayUsdc);
    await expect(page.getByRole('button', { name: 'Apply budget', exact: true })).toBeEnabled();
    await page.screenshot({ path: `${dir}/${mode === '--record' ? '01-before' : 'readiness'}.png` });
    if (mode === '--check') {
      report.status = 'PASS_READ_ONLY';
      console.log('PASS: live diagnosis, target selection, budget input and Apply budget button. No transaction sent.');
    } else {
      // This journal is exclusive and precedes the only click that can mutate the chain.
      fs.writeFileSync(journal, json({ attemptedAt: new Date().toISOString(), oldHash: plan.intent.hash, newMaxNetPayUsdc: plan.newMaxNetPayUsdc }), { flag: 'wx' });
      save();
      const responsePromise = page.waitForResponse(r => new URL(r.url()).pathname === '/api/demo/budget' && r.request().method() === 'POST', { timeout: 180000 });
      console.log(`Clicking Apply budget ONCE: ${plan.intent.hash}, ${plan.newMaxNetPayUsdc} USDC. Revoke gas 200000; commit gas 400000.`);
      await page.getByRole('button', { name: 'Apply budget', exact: true }).click();
      const response = await responsePromise;
      report.budgetResponseAt = new Date().toISOString();
      report.change = await response.json();
      fs.writeFileSync(journal, json({ ...JSON.parse(fs.readFileSync(journal, 'utf8')), httpStatus: response.status(), result: report.change }));
      save();
      if (response.status() !== 200) {
        // Only the explicitly sanitised diagnostic, never arbitrary server/environment output.
        report.serverError = output.match(/Apply budget failed: \{[^}]*\}/)?.[0];
        if (report.serverError) console.log(report.serverError);
      }
      assert.equal(response.status(), 200, 'Apply budget did not complete. Inspect saved receipts before any further write.');
      const change = report.change;
      console.log(json(change));
      await expect(drawer.locator('.agent-live')).toHaveText(`Indexing block #${change.commitBlock}\u2026`);
      await expect(page.locator('.workspace-stack')).toBeHidden();
      await expect(drawer.locator('.agent-answer')).toHaveCount(0);
      await page.locator('.activity').filter({ hasText: `Transaction confirmed at block #${change.commitBlock}` }).scrollIntoViewIfNeeded();
      for (const hash of [change.revokeTx, change.commitTx]) await expect(page.locator(`.activity a[href$="${hash}"]`).first()).toBeVisible();
      await page.screenshot({ path: `${dir}/02-indexing.png` });
      report.indexingScreenshotAt = new Date().toISOString();
      await expect(drawer.locator('.agent-live')).toHaveText(/BLOCK #\d+/, { timeout: 180000 });
      await expect(drawer.getByText(new RegExp(`Intent ${change.newHash.slice(0, 10)}`))).toBeVisible();
      await sleep(1500); // Show the block/hash transition separately from the new answer.
      await page.screenshot({ path: `${dir}/03-new-hash.png` });
    }
  }
  if (mode !== '--check') {
    const change = report.change;
    report.after = await ask();
    assert.equal(report.after.evidence[0].output.intent, change.newHash);
    assert.equal(report.after.evidence[0].output.status, 'NOT_FOUND_WITHIN_BOUND');
    assert.ok(BigInt(report.after.block) >= BigInt(change.commitBlock));
    assert.ok(BigInt(report.after.block) > BigInt(report.before.block));
    await page.screenshot({ path: `${dir}/04-after.png` });
    await drawer.locator('.agent-evidence > summary').click();
    await drawer.locator('.agent-evidence').scrollIntoViewIfNeeded();
    await sleep(1500);
    await page.screenshot({ path: `${dir}/05-evidence.png` });

    // Independent RPC receipts/calldata checks, rather than trusting the POST response.
    const receipts = [], decoded = [];
    for (const hash of [change.revokeTx, change.commitTx]) {
      const [receipt, tx] = await Promise.all([client.getTransactionReceipt({ hash }), client.getTransaction({ hash })]);
      assert.equal(receipt.status, 'success');
      assert.equal(tx.to.toLowerCase(), registry.toLowerCase());
      assert.equal(tx.from.toLowerCase(), plan.intent.owner.toLowerCase());
      assert.equal(tx.value, 0n);
      decoded.push(decodeFunctionData({ abi: abis.IntentRegistry, data: tx.input }));
      receipts.push({ hash, blockNumber: String(receipt.blockNumber), status: receipt.status, gasUsed: String(receipt.gasUsed), effectiveGasPrice: String(receipt.effectiveGasPrice), feeUsdc: formatEther(receipt.gasUsed * receipt.effectiveGasPrice) });
    }
    assert.equal(decoded[0].functionName, 'revoke');
    assert.equal(decoded[0].args[0], change.oldHash);
    assert.equal(decoded[1].functionName, 'commit');
    const next = decoded[1].args[0];
    assert.equal(hashIntent(next), change.newHash);
    assert.equal(String(next.maxNetPay), String(BigInt(plan.newMaxNetPayUsdc) * 1000000n));
    assert.ok(next.nonce > BigInt(plan.intent.nonce));
    for (const field of Object.keys(next).filter(key => !['maxNetPay', 'nonce'].includes(key))) {
      assert.equal(json(next[field]).toLowerCase(), json(plan.intent[field]).toLowerCase(), `Unexpected condition change: ${field}`);
    }
    assert.equal(await registryRead('state', [change.oldHash]), 2);
    assert.equal(await registryRead('state', [change.newHash]), 1);
    assert.equal(await registryRead('usedNonce', [plan.intent.owner, next.nonce]), true);
    assert.equal(receipts[1].blockNumber, change.commitBlock);
    assert.notEqual(change.revokeTx, change.commitTx);
    assert.notEqual(change.oldHash, change.newHash);
    report.receipts = receipts;
    report.decodedIntent = next;
    const indexed = await queryGraph(d.raw.subgraphUrl, `query BudgetIndexed($old: ID!, $next: ID!, $min: Int!) {
      _meta(block: {number_gte: $min}) { block {number} hasIndexingErrors deployment }
      old: intent(id: $old, block: {number_gte: $min}) {id state closedTx}
      next: intent(id: $next, block: {number_gte: $min}) {id state nonce maxNetPay committedTx}
    }`, { old: change.oldHash, next: change.newHash, min: Number(change.commitBlock) });
    assert.ok(!indexed.errors, json(indexed.errors));
    assert.equal(indexed.data._meta.hasIndexingErrors, false);
    assert.equal(indexed.data.old.state, 'REVOKED');
    assert.equal(indexed.data.old.closedTx, change.revokeTx);
    assert.equal(indexed.data.next.state, 'LIVE');
    assert.equal(indexed.data.next.committedTx, change.commitTx);
    assert.equal(indexed.data.next.maxNetPay, change.maxNetPay);
    assert.equal(indexed.data.next.nonce, change.nonce);
    report.indexed = indexed.data;
    report.status = 'PASS_REAL_TRANSACTIONS_AND_BROWSER';
    console.log(`PASS: two successful real receipts; new hash/nonce; ${report.before.block} -> ${report.after.block}; answer changed after indexing.`);
  }
} catch (error) {
  report.status = 'FAILED';
  report.error = error.message;
  if (page) await page.screenshot({ path: `${dir}/failure.png` }).catch(() => {});
  throw error;
} finally {
  if (page) report.observations = await page.evaluate(() => window.budgetObservations).catch(() => []);
  report.finishedAt = new Date().toISOString();
  save();
  if (context) await context.close();
  if (video) { const file = `${dir}/${mode === '--verify' ? 'read-only-retry' : 'apply-budget'}.webm`; await video.saveAs(file); report.video = file; save(); }
  if (browser) await browser.close();
  if (child.exitCode === null) { child.kill(); await exited; }
}
