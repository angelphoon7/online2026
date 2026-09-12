// Seed three distinct signers; keep their committed outcomes live for a later demo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createPublicClient, createWalletClient, defineChain, http, encodeFunctionData, parseEventLogs, hashDomain, keccak256, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import abis from '../server/abis.json' with { type: 'json' };
import { loadDeployment } from './lib/deployment.mjs';
import { hashIntent } from '../solver/dist/index.js';
import { json, restoreIntent } from './lib/demo-state.mjs';

const mode = process.argv[2] ?? '--check';
const batch = process.argv[3] ?? 'sep12';
const definitions = [
  { name: 'single-date', count: 1, classes: [[0, 0], [1, 0], [0, 1]] },
  { name: 'single-section', count: 1, classes: [[1, 0], [1, 1], [1, 2]] },
  { name: 'triple-date', count: 3, classes: [[1, 1], [0, 1], [1, 2]] },
  { name: 'triple-section', count: 3, classes: [[0, 0], [0, 1], [0, 2]] },
];
const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();
const write = (path, value) => { fs.writeFileSync(`${path}.tmp`, json(value), { mode: 0o600 }); fs.renameSync(`${path}.tmp`, path); };
const journalPath = `.data/circle-inventory-${batch}.json`;
const publicPath = `deployments/circle-inventory-${batch}.json`;
const lockPath = '.data/demo-tickets/issuer.lock';
const types = { Intent: abis.IntentRegistry.find(e => e.name === 'commit').inputs[0].components.map(({ name, type }) => ({ name, type })) };

async function main() {
  assert.ok(['--check', '--broadcast'].includes(mode) && process.argv.length <= 4 && /^[a-z0-9][a-z0-9-]{0,31}$/.test(batch), 'Use --check|--broadcast [batch]');
  loadEnvFile('.env');
  loadEnvFile('.env.seed');
  const d = loadDeployment('arc-testnet');
  assert.equal(process.env.ARC_CHAIN_ID, '5042002');
  assert.ok(same(process.env.USDC_ADDRESS, d.usdc));
  assert.equal(process.env.NEXT_PUBLIC_DEPLOYMENT ?? 'arc-testnet', 'arc-testnet');
  const accounts = ['PRIVATE_KEY', 'SEED_B_PRIVATE_KEY', 'SEED_C_PRIVATE_KEY'].map(key => {
    assert.match(process.env[key] ?? '', /^0x[0-9a-fA-F]{64}$/, `Missing ${key}`);
    return privateKeyToAccount(process.env[key]);
  });
  assert.equal(new Set(accounts.map(a => a.address.toLowerCase())).size, 3);
  assert.ok(accounts.every((a, i) => same(a.address, d.seed.accounts[i])), 'Seed wallets do not match the deployment');
  const addresses = d.raw.contracts;
  const chain = defineChain({ id: d.chainId, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [process.env.ARC_RPC ?? d.rpc] } } });
  const transport = http(process.env.ARC_RPC ?? d.rpc, { timeout: 20000, retryCount: 3, retryDelay: 1000 });
  const client = createPublicClient({ chain, transport });
  const read = (name, functionName, args = []) => client.readContract({ address: addresses[name], abi: abis[name], functionName, args });
  assert.equal(await client.getChainId(), 5042002);
  assert.ok(await read('TicketNFT', 'registeredIssuers', [accounts[0].address]));
  for (const [getter, expected] of Object.entries({ ticketNFT: addresses.TicketNFT, escrow: addresses.Escrow, registry: addresses.IntentRegistry, usdc: d.usdc })) assert.ok(same(await read('Settlement', getter), expected), `Settlement ${getter} mismatch`);
  for (const name of ['Escrow', 'IntentRegistry']) assert.ok(same(await read(name, 'settlement'), addresses.Settlement));
  const domain = { name: 'RESHUFFLE', version: '1', chainId: d.chainId, verifyingContract: addresses.IntentRegistry };
  const domainTypes = { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }] };
  assert.ok(same(await read('IntentRegistry', 'DOMAIN_SEPARATOR'), hashDomain({ domain, types: domainTypes })));
  const starts = [process.env.NEXT_PUBLIC_SESSION_0_START ?? '2026-09-19T20:00:00+08:00', process.env.NEXT_PUBLIC_SESSION_1_START ?? '2026-09-20T20:00:00+08:00'];
  const deadline = BigInt(Math.min(...starts.map(s => Date.parse(s) / 1000 - 8 * 3600)));
  const block = await client.getBlock();
  assert.ok(deadline > block.timestamp + 3600n, 'Demo cutoff is too close or expired');
  const balances = [];
  for (const account of accounts) balances.push(await client.getBalance({ address: account.address }));
  const next = await read('TicketNFT', 'nextTokenId');
  let journal = fs.existsSync(journalPath) ? JSON.parse(fs.readFileSync(journalPath, 'utf8')) : null;
  if (journal) {
    assert.equal(journal.chainId, d.chainId); assert.equal(journal.batch, batch);
    assert.deepEqual(journal.contracts, addresses); assert.deepEqual(journal.owners, accounts.map(a => a.address));
    assert.deepEqual(journal.definitions, definitions);
    assert.ok(BigInt(journal.deadline) > block.timestamp + 3600n, 'Saved requests expired');
  } else assert.ok(next + 24n < 1000n, 'Discovery capacity exceeded');
  console.log(json({ batch, chainId: d.chainId, scenarios: definitions, existingTickets: next, wallets: accounts.map((a, i) => ({ owner: a.address, balanceUSDC: formatEther(balances[i]) })), deadline, resume: !!journal,
    plan: '24 tickets, 12 requests, four three-wallet cycles. Fee ceiling 3 test USDC, participant funding at most 1 test USDC total. No settlement.' }));
  if (mode === '--check') return;
  assert.ok(balances[0] >= parseEther('4'), 'Issuer needs 4 test USDC for the spending ceilings');
  fs.mkdirSync('.data/demo-tickets', { recursive: true });
  const lock = fs.openSync(lockPath, 'wx');
  try {
    if (!journal) {
      journal = { batch, chainId: d.chainId, contracts: addresses, owners: accounts.map(a => a.address), definitions, deadline: String(deadline), rowBase: 30000 + Number(next), steps: {}, tickets: [], intents: [] };
      write(journalPath, journal);
    }
    const save = () => write(journalPath, journal);
    async function transact(label, account, tx) {
      let step = journal.steps[label];
      if (!step) {
        await client.call({ account: account.address, ...tx });
        const wallet = createWalletClient({ account, chain, transport });
        const request = await wallet.prepareTransactionRequest(tx);
        const feeCeiling = request.gas * (request.maxFeePerGas ?? request.gasPrice ?? 0n);
        const fees = Object.values(journal.steps).reduce((s, v) => s + BigInt(v.feeCeiling), feeCeiling);
        const funding = Object.values(journal.steps).reduce((s, v) => s + BigInt(v.value ?? 0), tx.value ?? 0n);
        assert.ok(feeCeiling > 0n && feeCeiling <= parseEther('0.1') && fees <= parseEther('3') && funding <= parseEther('1'), 'Spending ceiling exceeded');
        const raw = await wallet.signTransaction(request);
        step = journal.steps[label] = { hash: keccak256(raw), raw, feeCeiling: String(feeCeiling), value: String(tx.value ?? 0n) };
        save();
      }
      let receipt = await client.getTransactionReceipt({ hash: step.hash }).catch(e => { if (e.name === 'TransactionReceiptNotFoundError') return null; throw e; });
      if (!receipt) {
        await client.sendRawTransaction({ serializedTransaction: step.raw }).catch(async e => { if (!await client.getTransaction({ hash: step.hash }).catch(() => null)) throw e; });
        receipt = await client.waitForTransactionReceipt({ hash: step.hash, timeout: 60000, pollingInterval: 1000 });
      }
      Object.assign(step, { status: receipt.status, blockNumber: String(receipt.blockNumber), feePaid: String(receipt.gasUsed * receipt.effectiveGasPrice), gasUsed: String(receipt.gasUsed) });
      save(); assert.equal(receipt.status, 'success', `${label} reverted`);
      console.log(`${label}: ${step.hash}`);
      return receipt;
    }
    const send = (label, account, name, functionName, args, gas = 500000n) => transact(label, account, { to: addresses[name], data: encodeFunctionData({ abi: abis[name], functionName, args }), gas });
    for (let p = 1; p < 3; p++) {
      if (journal.steps[`fund:${p}`] || balances[p] < parseEther('0.15')) await transact(`fund:${p}`, accounts[0], { to: accounts[p].address, value: parseEther('0.5') - balances[p], gas: 100000n });
    }
    for (const [g, definition] of definitions.entries()) {
      for (let p = 0; p < 3; p++) {
        const [sessionId, sectionId] = definition.classes[p];
        const offered = [];
        for (let seat = 1; seat <= definition.count; seat++) {
          const label = `mint:${definition.name}:${p}:${seat}`;
          let ticket = journal.tickets.find(t => t.label === label);
          if (!ticket) {
            const row = journal.rowBase + g * 3 + p;
            const receipt = await send(label, accounts[0], 'TicketNFT', 'mint', [accounts[p].address, 1, sessionId, sectionId, row, seat]);
            const events = parseEventLogs({ abi: abis.TicketNFT, eventName: 'TicketMinted', logs: receipt.logs.filter(l => same(l.address, addresses.TicketNFT)) });
            assert.equal(events.length, 1); assert.ok(same(events[0].args.to, accounts[p].address));
            ticket = { label, group: definition.name, participant: p, tokenId: String(events[0].args.tokenId), eventId: 1, sessionId, sectionId, row, seat, owner: accounts[p].address, mintTx: receipt.transactionHash };
            journal.tickets.push(ticket); save();
          }
          offered.push(BigInt(ticket.tokenId));
        }
        if (!await read('TicketNFT', 'isApprovedForAll', [accounts[p].address, addresses.Escrow])) await send(`approve:${p}`, accounts[p], 'TicketNFT', 'setApprovalForAll', [addresses.Escrow, true]);
        const depositLabel = `deposit:${definition.name}:${p}`;
        if (journal.steps[depositLabel]?.status !== 'success') await send(depositLabel, accounts[p], 'Escrow', 'deposit', [offered], 1000000n);
        const label = `commit:${definition.name}:${p}`;
        let record = journal.intents.find(i => i.label === label);
        if (!record) {
          let nonce = BigInt(journal.rowBase) * 1000n + BigInt(g);
          while (await read('IntentRegistry', 'usedNonce', [accounts[p].address, nonce])) nonce++;
          const [session, section] = definition.classes[(p + 1) % 3];
          const intent = { owner: accounts[p].address, offered, eventId: 1, sessionMask: 1n << BigInt(session), sectionMask: 1n << BigInt(section), exactCount: definition.count,
            mustShareSession: true, mustShareSection: true, mustBeAdjacent: definition.count > 1, maxNetPay: 0n, deadline: BigInt(journal.deadline), nonce };
          const hash = hashIntent(intent);
          assert.equal(await read('IntentRegistry', 'hashIntent', [intent]), hash);
          record = { label, group: definition.name, participant: p, hash, intent: JSON.parse(json(intent)) };
          journal.intents.push(record); save();
        }
        if (journal.steps[label]?.status !== 'success') {
          const intent = restoreIntent(record.intent);
          const signature = await accounts[p].signTypedData({ domain, types, primaryType: 'Intent', message: intent });
          await send(label, accounts[0], 'IntentRegistry', 'commit', [intent, signature], 600000n);
        }
      }
      console.log(`READY ${definition.name}: three signed requests; settlement pending`);
    }
    assert.equal(journal.tickets.length, 24); assert.equal(journal.intents.length, 12);
    const transactions = Object.entries(journal.steps).map(([label, { raw, feeCeiling, ...tx }]) => ({ label, ...tx }));
    assert.ok(transactions.every(t => t.status === 'success'));
    write(publicPath, { batch, chainId: d.chainId, contracts: addresses, owners: journal.owners, deadline: journal.deadline,
      groups: definitions.map(def => ({ ...def, intents: journal.intents.filter(i => i.group === def.name).map(i => ({ ...i.intent, hash: i.hash, participant: i.participant, commitTx: journal.steps[i.label].hash })), tickets: journal.tickets.filter(t => t.group === def.name) })),
      transactions, totalFeeUSDC: formatEther(transactions.reduce((s, t) => s + BigInt(t.feePaid), 0n)) });
    console.log(`Saved ${publicPath}; run check-circle-inventory.mjs to verify indexed conditions and all pair/triple cases.`);
  } finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}
main().catch(e => { console.error(e.name === 'AssertionError' ? e.message : `Circle seed failed (${e.name}); resume the same batch. Credentials and raw transactions remain local.`); process.exitCode = 1; });
