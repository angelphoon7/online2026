import fs from 'node:fs';
import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { createPublicClient, createWalletClient, defineChain, http, encodeFunctionData, erc20Abi, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import abis from '../server/abis.json' with { type: 'json' };
import { hashIntent } from '../solver/dist/index.js';
import { json, restoreIntent } from './lib/demo-state.mjs';
import { participantBrowser } from './lib/offline-browser.mjs';

const journalPath = '.data/offline-participants-journal.json';
const publicPath = '.data/offline-ready.json';
const readJson = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const writeJson = (path, value) => { fs.writeFileSync(`${path}.tmp`, json(value), { mode: 0o600 }); fs.renameSync(`${path}.tmp`, path); };
const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();

async function main() {
  assert.equal(process.argv.length, 2, 'Run through npm run demo:offline');
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
  if (fs.existsSync(publicPath)) { console.log('Existing participant phase retained; no participant signing requested.'); return; }
  loadEnvFile('.env.seed');
  const accounts = ['PRIVATE_KEY', 'SEED_B_PRIVATE_KEY', 'SEED_C_PRIVATE_KEY'].map(key => {
    if (!/^0x[0-9a-fA-F]{64}$/.test(process.env[key] ?? '')) throw new Error(`Restore local ${key}.`);
    return privateKeyToAccount(process.env[key]);
  });
  assert(accounts.every((a, i) => same(a.address, deployment.seed.accounts[i])), 'Demo account mismatch');
  assert.equal(new Set(accounts.map(a => a.address)).size, 3);
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
    if (!health.ok) throw new Error('Start the configured Next.js backend before preparing act one.');
    const firstId = await read('TicketNFT', 'nextTokenId');
    const deadline = (await client.getBlock()).timestamp + 30n * 86400n;
    const tickets = Array.from({ length: 6 }, (_, index) => ({ tokenId: String(firstId + BigInt(index)),
      owner: accounts[Math.floor(index / 2)].address, eventId: 1, sessionId: Math.floor(index / 2) === 1 ? 1 : 0,
      sectionId: Math.floor(index / 2) === 2 ? 1 : 0, row: 5, seat: index % 2 + 1 }));
    const intents = [];
    for (let i = 0; i < 3; i++) {
      let nonce = 0n;
      while (await read('IntentRegistry', 'usedNonce', [accounts[i].address, nonce])) nonce++;
      const wanted = tickets[((i + 1) % 3) * 2];
      const intent = { owner: accounts[i].address, offered: tickets.slice(i * 2, i * 2 + 2).map(t => BigInt(t.tokenId)), eventId: 1,
        sessionMask: 1n << BigInt(wanted.sessionId), sectionMask: 1n << BigInt(wanted.sectionId), exactCount: 2,
        mustShareSession: true, mustShareSection: true, mustBeAdjacent: true, maxNetPay: [100000n, 0n, -100000n][i], deadline, nonce };
      intents.push({ ...intent, hash: hashIntent(intent) });
    }
    journal.plan = JSON.parse(json({ tickets, intents })); save();
  }
  if (!journal.steps.settle) {
    assert(BigInt(journal.plan.intents[0].deadline) > (await client.getBlock()).timestamp, 'Saved offline-participants plan expired; inspect before replacing it');
    for (let i = 1; i < 3; i++) {
      const balance = await client.getBalance({ address: accounts[i].address });
      if (balance < 200000000000000000n) await transact(`gas:${i}`, accounts[0], { to: accounts[i].address, value: 1000000000000000000n - balance, gas: 100000n });
    }
    for (const [i, ticket] of journal.plan.tickets.entries()) {
      const id = BigInt(ticket.tokenId);
      if (!journal.steps[`mint:${i}`]) assert.equal(await read('TicketNFT', 'nextTokenId'), id, 'Ticket inventory changed during setup');
      await contractTx(`mint:${i}`, 'TicketNFT', 'mint', [ticket.owner, ticket.eventId, ticket.sessionId, ticket.sectionId, ticket.row, ticket.seat], accounts[0]);
    }
    const browser = await participantBrowser();
    try {
    const types = { Intent: abis.IntentRegistry.find(a => a.name === 'commit').inputs[0].components.map(({ name, type }) => ({ name, type })) };
    for (let i = 0; i < 3; i++) {
      const intent = restoreIntent(journal.plan.intents[i]);
      assert.equal(await read('IntentRegistry', 'hashIntent', [intent]), intent.hash);
      if (!(await read('TicketNFT', 'isApprovedForAll', [accounts[i].address, deployment.contracts.Escrow]))) await contractTx(`approval:${i}`, 'TicketNFT', 'setApprovalForAll', [deployment.contracts.Escrow, true], accounts[i]);
      await contractTx(`deposit:${i}`, 'Escrow', 'deposit', [intent.offered], accounts[i]);
      if (i === 0) {
        const allowance = await client.readContract({ address: deployment.usdc, abi: erc20Abi, functionName: 'allowance', args: [accounts[0].address, deployment.contracts.Settlement] });
        // Leave enough allowance for the separate twelve-ticket demo after this debit.
        if (allowance < 200000n) await transact('usdc:approval', accounts[0], { to: deployment.usdc,
          data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [deployment.contracts.Settlement, 200000n] }), gas: 200000n });
      }
      await browser.authorize(journal.plan.intents[i], async () => {
        const signature = await accounts[i].signTypedData({ domain: { name: 'RESHUFFLE', version: '1', chainId: 5042002, verifyingContract: deployment.contracts.IntentRegistry }, types, primaryType: 'Intent', message: intent });
        const receipt = await contractTx(`commit:${i}`, 'IntentRegistry', 'commit', [intent, signature], accounts[0]);
        return { transactionHash: receipt.transactionHash };
      });
    }
    const readyBlock = await client.getBlockNumber();
    const participants = [];
    for (const [i, account] of accounts.entries()) {
      const state = await client.readContract({ address: deployment.contracts.IntentRegistry, abi: abis.IntentRegistry, functionName: 'state', args: [journal.plan.intents[i].hash], blockNumber: readyBlock });
      assert.equal(Number(state), 1, 'Intent must be LIVE before closing');
      participants.push({ owner: account.address, intentHash: journal.plan.intents[i].hash,
        commitTransactionHash: journal.steps[`commit:${i}`].hash,
        nonceAtClose: await client.getTransactionCount({ address: account.address, blockNumber: readyBlock }) });
    }
    const closure = await browser.close();
    const setupTransactions = Object.entries(journal.steps).map(([label, step]) => ({ label, transactionHash: step.hash, blockNumber: step.blockNumber }));
    writeJson(publicPath, { chainId: 5042002, settlement: deployment.contracts.Settlement,
      readyBlock: String(readyBlock), participants, closure, setupTransactions });
    console.log('Participant browser closed and signing server stopped. Participant process will exit now.');
    } finally { browser.dispose(); }
  }
}

main().catch(error => { console.error(error.shortMessage ? `Arc request failed (${error.name}); the local journal is retained for safe resumption.` : error.message); process.exitCode = 1; });
