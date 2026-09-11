import fs from 'node:fs';
import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { createPublicClient, createWalletClient, defineChain, http, encodeFunctionData, erc20Abi, keccak256 } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import abis from '../server/abis.json' with { type: 'json' };
import { hashIntent } from '../solver/dist/index.js';
import { json, restoreIntent } from './lib/demo-state.mjs';
import { auditActTwo } from './lib/act-one-proof.mjs';

const journalPath = '.data/act-two-journal.json';
const publicPath = 'deployments/act-two.json';
const readJson = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const writeJson = (path, value) => { fs.writeFileSync(`${path}.tmp`, json(value), { mode: 0o600 }); fs.renameSync(`${path}.tmp`, path); };
const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();

async function main() {
  const options = process.argv.slice(2);
  if (options.length > 1 || options.some(a => !['--prepare-only', '--verify'].includes(a))) throw new Error('Usage: npm run demo:act-two [-- --prepare-only|--verify]');
  loadEnvFile('.env');
  const deployment = readJson('deployments/arc-testnet.json');
  assert.equal(process.env.ARC_CHAIN_ID, '5042002');
  assert(same(deployment.usdc, '0x3600000000000000000000000000000000000000'));
  for (const [name, suffix] of Object.entries({ TicketNFT: 'TICKET_NFT', Escrow: 'ESCROW', IntentRegistry: 'INTENT_REGISTRY', Settlement: 'SETTLEMENT' })) {
    assert(same(deployment.contracts[name], process.env[`NEXT_PUBLIC_${suffix}`]), `${name} env/deployment mismatch`);
  }
  const chain = defineChain({ id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [process.env.ARC_RPC] } } });
  const transport = http(process.env.ARC_RPC, { timeout: 20000, retryCount: 3, retryDelay: 1000 });
  const client = createPublicClient({ chain, transport });
  assert.equal(await client.getChainId(), 5042002);
  if (fs.existsSync(publicPath)) {
    const record = readJson(publicPath);
    const proof = await auditActTwo(client, deployment, record.evidence, record.proof.transactionHash);
    console.log(`Verified existing act two: ${proof.transactionHash}; ${proof.ticketTransferCount} tickets, ${proof.participantCount} participants. No new transaction sent.`);
    return;
  }
  if (options.includes('--verify')) throw new Error('Act two has not been executed yet.');
  loadEnvFile('.env.seed');
  if (!process.env.SEED_D_PRIVATE_KEY) {
    if (fs.existsSync(journalPath)) throw new Error('Restore SEED_D_PRIVATE_KEY for the saved act-two plan.');
    process.env.SEED_D_PRIVATE_KEY = generatePrivateKey();
    fs.appendFileSync('.env.seed', `\nSEED_D_PRIVATE_KEY=${process.env.SEED_D_PRIVATE_KEY}\n`, { mode: 0o600 });
  }
  const accounts = ['PRIVATE_KEY', 'SEED_B_PRIVATE_KEY', 'SEED_C_PRIVATE_KEY', 'SEED_D_PRIVATE_KEY'].map(key => {
    if (!/^0x[0-9a-fA-F]{64}$/.test(process.env[key] ?? '')) throw new Error(`Restore local ${key}.`);
    return privateKeyToAccount(process.env[key]);
  });
  assert(accounts.slice(0, 3).every((a, i) => same(a.address, deployment.seed.accounts[i])), 'Demo account mismatch');
  assert.equal(new Set(accounts.map(a => a.address)).size, 4);
  const read = (name, functionName, args = []) => client.readContract({ address: deployment.contracts[name], abi: abis[name], functionName, args });
  for (const [getter, expected] of [['ticketNFT', deployment.contracts.TicketNFT], ['registry', deployment.contracts.IntentRegistry], ['escrow', deployment.contracts.Escrow], ['usdc', deployment.usdc]]) assert(same(await read('Settlement', getter), expected), 'Settlement wiring mismatch');
  assert(same(await read('Escrow', 'settlement'), deployment.contracts.Settlement));
  assert(same(await read('IntentRegistry', 'settlement'), deployment.contracts.Settlement));
  assert(await read('TicketNFT', 'registeredIssuers', [accounts[0].address]), 'Operator must be a registered issuer');
  fs.mkdirSync('.data', { recursive: true });
  const journal = fs.existsSync(journalPath) ? readJson(journalPath) : { settlement: deployment.contracts.Settlement, steps: {} };
  assert(same(journal.settlement, deployment.contracts.Settlement), 'Journal deployment mismatch');
  const save = () => writeJson(journalPath, journal);
  const endpoint = process.env.SOLVE_API_URL ?? 'http://127.0.0.1:3000';
  async function api(path, body) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
      const value = await response.json();
      if (response.ok) return value;
      if (![429, 502, 503, 504].includes(response.status) || attempt === 3) throw new Error(`Backend rejected request (${response.status}); check the local server.`);
      console.log('Read-only backend check unavailable; retrying after backoff.');
      await new Promise(resolve => setTimeout(resolve, 2000 * 2 ** attempt));
    }
  }
  // Signed bytes are journaled before sending. Resume only ever resends those same
  // bytes; a process interruption cannot silently create a second settlement.
  async function transact(label, account, tx) {
    let step = journal.steps[label];
    if (!step) {
      await client.call({ account: account.address, ...tx });
      const wallet = createWalletClient({ account, chain, transport });
      const request = await wallet.prepareTransactionRequest(tx);
      const raw = await wallet.signTransaction(request);
      step = journal.steps[label] = { hash: keccak256(raw), raw };
      save();
    }
    let receipt = await client.getTransactionReceipt({ hash: step.hash }).catch(error => {
      if (error.name === 'TransactionReceiptNotFoundError') return null;
      throw error;
    });
    if (!receipt) {
      try { await client.sendRawTransaction({ serializedTransaction: step.raw }); }
      catch (error) { if (!(await client.getTransaction({ hash: step.hash }).catch(() => null))) throw error; }
      receipt = await client.waitForTransactionReceipt({ hash: step.hash, timeout: 120000 });
    }
    assert.equal(receipt.status, 'success', `Reverted: ${label} ${step.hash}`);
    step.blockNumber = String(receipt.blockNumber); step.status = receipt.status; save();
    console.log(`${label}: ${step.hash}`);
    return receipt;
  }
  const contractTx = (label, name, functionName, args, account) => transact(label, account, {
    to: deployment.contracts[name], data: encodeFunctionData({ abi: abis[name], functionName, args }), gas: 1000000n,
  });
  if (!journal.plan) {
    // Confirm backend availability before spending gas on setup.
    const health = await fetch(`${endpoint}/api/demo`, { signal: AbortSignal.timeout(30000) });
    if (!health.ok) throw new Error('Start the configured Next.js backend before preparing act two.');
    const firstId = await read('TicketNFT', 'nextTokenId');
    const deadline = (await client.getBlock()).timestamp + 30n * 86400n;
    const tickets = Array.from({ length: 6 }, (_, index) => ({ tokenId: String(firstId + BigInt(index)),
      owner: accounts[Math.floor(index / 2) + 1].address, eventId: 1, sessionId: Math.floor(index / 2) === 1 ? 1 : 0,
      sectionId: Math.floor(index / 2) === 2 ? 1 : 0, row: 3, seat: index % 2 + 1 }));
    const intents = [];
    for (let i = 0; i < 4; i++) {
      let nonce = 0n;
      while (await read('IntentRegistry', 'usedNonce', [accounts[i].address, nonce])) nonce++;
      const wanted = tickets[i * 2];
      // Scenario inputs only: no role flag is sent to the solver or contract.
      const intent = { owner: accounts[i].address, offered: i === 0 ? [] : tickets.slice((i - 1) * 2, i * 2).map(t => BigInt(t.tokenId)), eventId: 1,
        sessionMask: wanted ? 1n << BigInt(wanted.sessionId) : 3n, sectionMask: wanted ? 1n << BigInt(wanted.sectionId) : 3n,
        exactCount: i === 3 ? 0 : 2, mustShareSession: i !== 3, mustShareSection: i !== 3, mustBeAdjacent: i !== 3,
        maxNetPay: i === 3 ? -300000n : 100000n, deadline, nonce };
      intents.push({ ...intent, hash: hashIntent(intent) });
    }
    journal.plan = JSON.parse(json({ tickets, intents })); save();
  }
  assert(journal.plan.intents.every((intent, i) => same(intent.owner, accounts[i].address)), 'Saved plan wallet mismatch');
  if (!journal.steps.settle) {
    assert(BigInt(journal.plan.intents[0].deadline) > (await client.getBlock()).timestamp, 'Saved act-two plan expired; inspect before replacing it');
    // Successful commits are the final setup step for each wallet. The backend
    // still reloads custody, capacity and intent states before any submission.
    const prepared = accounts.every((_, i) => journal.steps[`commit:${i}`]?.status === 'success');
    if (!prepared) {
      for (let i = 0; i < 3; i++) {
        const balance = await client.readContract({ address: deployment.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [accounts[i].address] });
        assert(balance >= (i === 0 ? 2000000n : 300000n), 'Fund the demo wallets with test USDC before setup');
      }
      for (let i = 1; i < 4; i++) {
        const balance = await client.getBalance({ address: accounts[i].address });
        if (balance < 200000000000000000n) await transact(`gas:${i}`, accounts[0], { to: accounts[i].address, value: 1000000000000000000n - balance, gas: 100000n });
      }
      for (const [i, ticket] of journal.plan.tickets.entries()) {
        const id = BigInt(ticket.tokenId);
        if (!journal.steps[`mint:${i}`]) assert.equal(await read('TicketNFT', 'nextTokenId'), id, 'Ticket inventory changed during setup');
        await contractTx(`mint:${i}`, 'TicketNFT', 'mint', [ticket.owner, ticket.eventId, ticket.sessionId, ticket.sectionId, ticket.row, ticket.seat], accounts[0]);
      }
      const types = { Intent: abis.IntentRegistry.find(a => a.name === 'commit').inputs[0].components.map(({ name, type }) => ({ name, type })) };
      for (let i = 0; i < 4; i++) {
        const intent = restoreIntent(journal.plan.intents[i]);
        assert.equal(await read('IntentRegistry', 'hashIntent', [intent]), intent.hash);
        if (intent.offered.length) {
          if (!(await read('TicketNFT', 'isApprovedForAll', [accounts[i].address, deployment.contracts.Escrow]))) await contractTx(`approval:${i}`, 'TicketNFT', 'setApprovalForAll', [deployment.contracts.Escrow, true], accounts[i]);
          await contractTx(`deposit:${i}`, 'Escrow', 'deposit', [intent.offered], accounts[i]);
        }
        if (i < 3) {
          const allowance = await client.readContract({ address: deployment.usdc, abi: erc20Abi, functionName: 'allowance', args: [accounts[i].address, deployment.contracts.Settlement] });
          // Leave enough allowance for the separate twelve-ticket demo after this debit.
          if (allowance < 200000n) await transact(`usdc:approval:${i}`, accounts[i], { to: deployment.usdc,
            data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [deployment.contracts.Settlement, 200000n] }), gas: 200000n });
        }
        const signature = await accounts[i].signTypedData({ domain: { name: 'RESHUFFLE', version: '1', chainId: 5042002, verifyingContract: deployment.contracts.IntentRegistry }, types, primaryType: 'Intent', message: intent });
        await contractTx(`commit:${i}`, 'IntentRegistry', 'commit', [intent, signature], accounts[0]);
      }
    }
    journal.broken = [];
    for (const [label, excludedIndex] of [['without-buyer', 0], ['without-seller', 3]]) {
      const evidence = await api('/api/solve', { intentHashes: journal.plan.intents.filter((_, i) => i !== excludedIndex).map(i => i.hash) });
      assert(!evidence.proposal && !evidence.transaction, 'An endpoint-free subset unexpectedly settled');
      journal.broken.push({ label, evidence }); save();
    }
    journal.evidence = await api('/api/solve', { intentHashes: journal.plan.intents.map(i => i.hash) }); save();
    assert(journal.evidence.simulationResult?.success && journal.evidence.transaction && journal.evidence.proposal?.intents.length === 4, 'Backend did not find a simulated four-party candidate');
    assert.equal(journal.evidence.proposal.legs.reduce((n, l) => n + l.receives.length, 0), 6);
    // Bind the backend payload to this deployment and exactly these signed intents.
    assert(same(journal.evidence.transaction.to, deployment.contracts.Settlement));
    assert.deepEqual(journal.evidence.proposal.legs.map(l => l.intentHash).sort(), journal.plan.intents.map(i => i.hash).sort());
    const proposal = journal.evidence.proposal;
    assert.equal(journal.evidence.transaction.data, encodeFunctionData({ abi: abis.Settlement, functionName: 'settle', args: [proposal.intents.map(restoreIntent), proposal.legs.map(l => ({ ...l, receives: l.receives.map(BigInt), netPayment: BigInt(l.netPayment) }))] }));
    if (options.includes('--prepare-only')) {
      console.log('Act two ready: 4 LIVE intents, 6 tickets; removing either endpoint found no candidate, the full open chain passed backend simulation. No settlement sent.');
      return;
    }
  }
  const receipt = await transact('settle', accounts[0], { to: journal.evidence.transaction.to, data: journal.evidence.transaction.data, gas: 8000000n });
  const confirmed = await api(`/api/evidence/${journal.evidence.id}/receipt`, { transactionHash: receipt.transactionHash });
  const proof = await auditActTwo(client, deployment, confirmed, receipt.transactionHash);
  const setupTransactions = Object.entries(journal.steps).filter(([label]) => label !== 'settle').map(([label, step]) => ({ label, transactionHash: step.hash, blockNumber: step.blockNumber }));
  writeJson(publicPath, { title: 'Act two: buyer, two swappers and seller, one open-chain settlement', proof, setupTransactions, broken: journal.broken, evidence: confirmed });
  console.log(`CONFIRMED: ${proof.participantCount} participants, ${proof.ticketTransferCount} ticket transfers in one settlement.`);
  console.log(`https://testnet.arcscan.app/tx/${proof.transactionHash}`);
}

main().catch(error => { console.error(error.shortMessage ? `Arc request failed (${error.name}); the local journal is retained for safe resumption.` : error.message); process.exitCode = 1; });
