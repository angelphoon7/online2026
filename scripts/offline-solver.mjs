import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createPublicClient, createWalletClient, defineChain, http, keccak256, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import abis from '../server/abis.json' with { type: 'json' };
import { json, restoreIntent } from './lib/demo-state.mjs';
import { auditOffline, checkLifecycle } from './lib/offline-proof.mjs';

const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (p, value) => { fs.writeFileSync(`${p}.tmp`, json(value), { mode: 0o600 }); fs.renameSync(`${p}.tmp`, p); };
const output = 'deployments/offline-demo.json';
const journalPath = '.data/offline-solver-journal.json';

async function main() {
  // No participant wallet, browser provider, signing callback or dotenv loader.
  for (const name of ['PRIVATE_KEY', 'SEED_B_PRIVATE_KEY', 'SEED_C_PRIVATE_KEY', 'SEED_D_PRIVATE_KEY']) assert(!process.env[name], 'Participant credentials must not be passed to solver');
  const deployment = read('deployments/arc-testnet.json');
  const chain = defineChain({ id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [process.env.ARC_RPC] } } });
  const transport = http(process.env.ARC_RPC, { timeout: 20000, retryCount: 3, retryDelay: 1000 });
  const client = createPublicClient({ chain, transport });
  assert.equal(await client.getChainId(), 5042002);
  if (fs.existsSync(output)) {
    const record = read(output);
    const proof = await auditOffline(client, deployment, record);
    console.log(`Verified offline settlement ${proof.transactionHash}: ${proof.ticketTransferCount} tickets; all participant nonces unchanged. No new transaction sent.`);
    return;
  }
  assert(!process.argv.includes('--verify'), 'Offline demonstration has not run yet');
  assert(/^0x[0-9a-fA-F]{64}$/.test(process.env.SOLVER_PRIVATE_KEY ?? ''), 'Missing local solver key');
  const account = privateKeyToAccount(process.env.SOLVER_PRIVATE_KEY);
  const journal = fs.existsSync(journalPath) ? read(journalPath) : read('.data/offline-ready.json');
  // Retain the original start for a signed transaction resumed after interruption.
  if (!journal.solverProcess) journal.solverProcess = { pid: process.pid, startedAt: new Date().toISOString(), address: account.address, credential: 'SOLVER_PRIVATE_KEY only; no participant key in child environment' };
  checkLifecycle(journal);
  assert(journal.participants.every(p => p.owner.toLowerCase() !== account.address.toLowerCase()), 'Solver must be a different wallet');
  const endpoint = process.env.SOLVE_API_URL ?? 'http://127.0.0.1:3000';
  async function api(path, body) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
      if (response.ok) return response.json();
      if (![429, 502, 503, 504].includes(response.status) || attempt === 3) throw new Error(`Backend unavailable (${response.status}); journal retained`);
      await new Promise(resolve => setTimeout(resolve, 2000 * 2 ** attempt));
    }
  }
  if (!journal.transactionHash) {
    journal.evidence = await api('/api/solve', { intentHashes: journal.participants.map(p => p.intentHash) });
    const evidence = journal.evidence;
    assert(evidence.simulationResult?.success && evidence.transaction && evidence.proposal?.intents.length === 3, 'No simulated three-party candidate');
    assert.deepEqual(evidence.proposal.legs.map(l => l.intentHash).sort(), journal.participants.map(p => p.intentHash).sort());
    assert.equal(evidence.transaction.to.toLowerCase(), deployment.contracts.Settlement.toLowerCase());
    const args = [evidence.proposal.intents.map(restoreIntent), evidence.proposal.legs.map(l => ({ ...l, receives: l.receives.map(BigInt), netPayment: BigInt(l.netPayment) }))];
    assert.equal(evidence.transaction.data, encodeFunctionData({ abi: abis.Settlement, functionName: 'settle', args }));
    for (const participant of journal.participants) {
      assert.equal(await client.getTransactionCount({ address: participant.owner }), participant.nonceAtClose, 'Participant transacted after page close');
    }
    // Fresh simulation as the actual independent proposer, immediately before signing.
    await client.simulateContract({ address: deployment.contracts.Settlement, abi: abis.Settlement, functionName: 'settle', args, account: account.address, gas: 8000000n });
    const wallet = createWalletClient({ account, chain, transport });
    const request = await wallet.prepareTransactionRequest({ to: evidence.transaction.to, data: evidence.transaction.data, gas: 8000000n });
    journal.raw = await wallet.signTransaction(request);
    journal.transactionHash = keccak256(journal.raw);
    journal.submissionPreparedAt = new Date().toISOString();
    write(journalPath, journal);
  }
  let receipt = await client.getTransactionReceipt({ hash: journal.transactionHash }).catch(error => { if (error.name === 'TransactionReceiptNotFoundError') return null; throw error; });
  if (!receipt) {
    try { await client.sendRawTransaction({ serializedTransaction: journal.raw }); }
    catch (error) { if (!(await client.getTransaction({ hash: journal.transactionHash }).catch(() => null))) throw error; }
    receipt = await client.waitForTransactionReceipt({ hash: journal.transactionHash, timeout: 120000 });
  }
  assert.equal(receipt.status, 'success', 'Settlement reverted; inspect journal before rerunning');
  journal.evidence = await api(`/api/evidence/${journal.evidence.id}/receipt`, { transactionHash: journal.transactionHash });
  write(journalPath, journal);
  const record = { ...journal };
  delete record.raw;
  record.title = 'Sign once, close the page, settle with an independent solver';
  record.proof = await auditOffline(client, deployment, record);
  write(output, record);
  console.log(`CONFIRMED: ${record.transactionHash}; browser and signer process exited before solver started. All three participant nonces unchanged.`);
}

main().catch(error => { console.error(error.shortMessage ? `Arc request failed (${error.name}); private journal retained for resumption.` : error.message); process.exitCode = 1; });
