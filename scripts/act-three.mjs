import fs from 'node:fs';
import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { createPublicClient, createWalletClient, defineChain, http, encodeFunctionData, erc20Abi, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import abis from '../server/abis.json' with { type: 'json' };
import { hashIntent } from '../solver/dist/index.js';
import { json, restoreIntent } from './lib/demo-state.mjs';
import { auditActThree, inspectAttack, proposalData, simulateProposal } from './lib/act-three-proof.mjs';

const journalPath = '.data/act-three-journal.json';
const publicPath = 'deployments/act-three.json';
const readJson = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const writeJson = (path, value) => { fs.writeFileSync(`${path}.tmp`, json(value), { mode: 0o600 }); fs.renameSync(`${path}.tmp`, path); };
const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();

async function main() {
  const options = process.argv.slice(2);
  assert(options.length <= 1 && options.every(a => ['--prepare-only', '--verify'].includes(a)), 'Usage: npm run demo:act-three [-- --prepare-only|--verify]');
  loadEnvFile('.env');
  const deployment = readJson('deployments/arc-testnet.json');
  assert.equal(process.env.ARC_CHAIN_ID, '5042002');
  assert(same(deployment.usdc, '0x3600000000000000000000000000000000000000'));
  for (const [name, suffix] of Object.entries({ TicketNFT: 'TICKET_NFT', Escrow: 'ESCROW', IntentRegistry: 'INTENT_REGISTRY', Settlement: 'SETTLEMENT' })) assert(same(deployment.contracts[name], process.env[`NEXT_PUBLIC_${suffix}`]), `${name} configuration mismatch`);
  const chain = defineChain({ id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [process.env.ARC_RPC] } } });
  const transport = http(process.env.ARC_RPC, { timeout: 20000, retryCount: 3, retryDelay: 1000 });
  const client = createPublicClient({ chain, transport });
  assert.equal(await client.getChainId(), 5042002);
  if (fs.existsSync(publicPath)) {
    const proof = await auditActThree(client, deployment, readJson(publicPath));
    console.log(`Verified existing rejected transaction ${proof.transactionHash}: ${proof.rejection.errorName}. No new transaction sent.`);
    return;
  }
  if (options.includes('--verify')) throw new Error('Act three has not been executed yet.');
  loadEnvFile('.env.seed');
  const accounts = ['PRIVATE_KEY', 'SEED_B_PRIVATE_KEY', 'SEED_C_PRIVATE_KEY', 'SEED_D_PRIVATE_KEY'].map(key => {
    assert(/^0x[0-9a-fA-F]{64}$/.test(process.env[key] ?? ''), `Restore local ${key}.`);
    return privateKeyToAccount(process.env[key]);
  });
  assert.equal(new Set(accounts.map(a => a.address)).size, 4);
  assert(accounts.slice(0, 3).every((a, i) => same(a.address, deployment.seed.accounts[i])));
  const proposer = accounts[3];
  const read = (name, functionName, args = []) => client.readContract({ address: deployment.contracts[name], abi: abis[name], functionName, args });
  for (const [getter, expected] of [['ticketNFT', deployment.contracts.TicketNFT], ['registry', deployment.contracts.IntentRegistry], ['escrow', deployment.contracts.Escrow], ['usdc', deployment.usdc]]) assert(same(await read('Settlement', getter), expected));
  assert(same(await read('Escrow', 'settlement'), deployment.contracts.Settlement));
  assert(same(await read('IntentRegistry', 'settlement'), deployment.contracts.Settlement));
  assert(await read('TicketNFT', 'registeredIssuers', [accounts[0].address]));
  fs.mkdirSync('.data', { recursive: true });
  const journal = fs.existsSync(journalPath) ? readJson(journalPath) : { settlement: deployment.contracts.Settlement, proposer: proposer.address, steps: {} };
  assert(same(journal.settlement, deployment.contracts.Settlement) && same(journal.proposer, proposer.address));
  const save = () => writeJson(journalPath, journal);
  const endpoint = process.env.SOLVE_API_URL ?? 'http://127.0.0.1:3000';
  async function solve() {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(`${endpoint}/api/solve`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intentHashes: journal.plan.intents.map(i => i.hash) }), signal: AbortSignal.timeout(120000) });
      const result = await response.json();
      if (response.ok) return result;
      if (![429, 502, 503, 504].includes(response.status) || attempt === 3) throw new Error('Backend control solve unavailable.');
      await new Promise(resolve => setTimeout(resolve, 2000 * 2 ** attempt));
    }
  }
  async function transact(label, account, tx, expectRevert = false) {
    let step = journal.steps[label];
    if (!step) {
      if (expectRevert) {
        assert.equal(label, 'attack');
        assert.equal(tx.data, proposalData(journal.malicious));
        const result = await simulateProposal(client, deployment, journal.malicious, proposer.address, await client.getBlockNumber());
        assert.equal(result.rejection?.errorName, 'SeatsNotAdjacent', 'Refusing to broadcast a different failure');
        assert.equal(result.rejection.args[0], inspectAttack(journal.control.proposal, journal.malicious).targetIntentHash);
      } else await client.call({ account: account.address, ...tx });
      const wallet = createWalletClient({ account, chain, transport });
      const raw = await wallet.signTransaction(await wallet.prepareTransactionRequest(tx));
      step = journal.steps[label] = { raw, hash: keccak256(raw) }; save();
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
    assert.equal(receipt.status, expectRevert ? 'reverted' : 'success', `Unexpected receipt: ${label}`);
    step.status = receipt.status; step.blockNumber = String(receipt.blockNumber); save();
    console.log(`${label}: ${step.hash} (${receipt.status})`);
    return receipt;
  }
  const contractTx = (label, name, functionName, args, account) => transact(label, account, { to: deployment.contracts[name],
    data: encodeFunctionData({ abi: abis[name], functionName, args }), gas: 1000000n });
  if (!journal.plan) {
    const health = await fetch(`${endpoint}/api/demo`, { signal: AbortSignal.timeout(30000) });
    assert(health.ok, 'Start the Next.js backend first.');
    const firstId = await read('TicketNFT', 'nextTokenId');
    const tickets = Array.from({ length: 4 }, (_, i) => ({ tokenId: String(firstId + BigInt(i)), owner: accounts[1].address,
      eventId: 1, sessionId: 0, sectionId: 0, row: 4, seat: i + 1 }));
    const deadline = (await client.getBlock()).timestamp + 30n * 86400n;
    const intents = [];
    for (let i = 0; i < 3; i++) {
      let nonce = 0n;
      while (await read('IntentRegistry', 'usedNonce', [accounts[i].address, nonce])) nonce++;
      const intent = { owner: accounts[i].address, offered: i === 1 ? tickets.map(t => BigInt(t.tokenId)) : [], eventId: 1,
        sessionMask: 1n, sectionMask: 1n, exactCount: i === 1 ? 0 : 2, mustShareSession: i !== 1,
        mustShareSection: i !== 1, mustBeAdjacent: i !== 1, maxNetPay: i === 1 ? -200000n : 100000n, deadline, nonce };
      intents.push({ ...intent, hash: hashIntent(intent) });
    }
    journal.plan = JSON.parse(json({ tickets, intents })); save();
  }
  assert(journal.plan.intents.every((i, index) => same(i.owner, accounts[index].address)));
  if (!journal.steps.attack) {
    const prepared = [0, 1, 2].every(i => journal.steps[`commit:${i}`]?.status === 'success');
    if (!prepared) {
      for (let i = 1; i < 4; i++) {
        const balance = await client.getBalance({ address: accounts[i].address });
        if (balance < 200000000000000000n) await transact(`gas:${i}`, accounts[0], { to: accounts[i].address, value: 1000000000000000000n - balance, gas: 100000n });
      }
      for (const [index, ticket] of journal.plan.tickets.entries()) {
        if (!journal.steps[`mint:${index}`]) assert.equal(await read('TicketNFT', 'nextTokenId'), BigInt(ticket.tokenId));
        await contractTx(`mint:${index}`, 'TicketNFT', 'mint', [ticket.owner, ticket.eventId, ticket.sessionId, ticket.sectionId, ticket.row, ticket.seat], accounts[0]);
      }
      const types = { Intent: abis.IntentRegistry.find(a => a.name === 'commit').inputs[0].components.map(({ name, type }) => ({ name, type })) };
      for (let i = 0; i < 3; i++) {
        const intent = restoreIntent(journal.plan.intents[i]);
        assert.equal(await read('IntentRegistry', 'hashIntent', [intent]), intent.hash);
        if (intent.offered.length) {
          if (!(await read('TicketNFT', 'isApprovedForAll', [accounts[i].address, deployment.contracts.Escrow]))) await contractTx(`approval:${i}`, 'TicketNFT', 'setApprovalForAll', [deployment.contracts.Escrow, true], accounts[i]);
          await contractTx(`deposit:${i}`, 'Escrow', 'deposit', [intent.offered], accounts[i]);
        } else {
          const allowance = await client.readContract({ address: deployment.usdc, abi: erc20Abi, functionName: 'allowance', args: [accounts[i].address, deployment.contracts.Settlement] });
          if (allowance < 200000n) await transact(`usdc:approval:${i}`, accounts[i], { to: deployment.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [deployment.contracts.Settlement, 200000n] }), gas: 200000n });
        }
        const signature = await accounts[i].signTypedData({ domain: { name: 'RESHUFFLE', version: '1', chainId: 5042002, verifyingContract: deployment.contracts.IntentRegistry }, types, primaryType: 'Intent', message: intent });
        await contractTx(`commit:${i}`, 'IntentRegistry', 'commit', [intent, signature], accounts[0]);
      }
    }
    journal.control = await solve();
    assert(journal.control.simulationResult?.success && journal.control.proposal?.intents.length === 3);
    assert(same(journal.control.transaction.to, deployment.contracts.Settlement));
    assert.equal(journal.control.transaction.data, proposalData(journal.control.proposal));
    assert.deepEqual(journal.control.proposal.legs.map(l => l.intentHash).sort(), journal.plan.intents.map(i => i.hash).sort());
    journal.malicious = structuredClone(journal.control.proposal);
    const buyers = journal.malicious.intents.flatMap((i, index) => i.exactCount === 2 ? [index] : []);
    assert.equal(buyers.length, 2);
    const ids = journal.plan.tickets.map(t => t.tokenId);
    journal.malicious.legs[buyers[0]].receives = [ids[0], ids[2]];
    journal.malicious.legs[buyers[1]].receives = [ids[1], ids[3]];
    const { targetIntentHash } = inspectAttack(journal.control.proposal, journal.malicious);
    const blockNumber = await client.getBlockNumber();
    const good = await simulateProposal(client, deployment, journal.control.proposal, proposer.address, blockNumber);
    const bad = await simulateProposal(client, deployment, journal.malicious, proposer.address, blockNumber);
    assert(good.success); assert.equal(bad.rejection?.errorName, 'SeatsNotAdjacent'); assert.equal(bad.rejection.args[0], targetIntentHash);
    journal.preflight = { good, bad }; save();
    if (options.includes('--prepare-only')) { console.log('Valid control passed; malicious ticket allocation reverted with decoded SeatsNotAdjacent. No attack transaction sent.'); return; }
  }
  const receipt = await transact('attack', proposer, { to: deployment.contracts.Settlement, data: proposalData(journal.malicious), gas: 8000000n }, true);
  const record = { title: 'Act three: an untrusted proposer is rejected by on-chain adjacency checks', proposer: proposer.address,
    transactionHash: receipt.transactionHash, control: journal.control, malicious: journal.malicious, preflight: journal.preflight,
    setupTransactions: Object.entries(journal.steps).filter(([label]) => label !== 'attack').map(([label, step]) => ({ label, transactionHash: step.hash, blockNumber: step.blockNumber })) };
  record.proof = await auditActThree(client, deployment, record);
  writeJson(publicPath, record);
  console.log(`CONFIRMED REJECTION: ${record.proof.rejection.errorName}; all tickets escrowed, intents LIVE, participant USDC unchanged.`);
  console.log(`https://testnet.arcscan.app/tx/${receipt.transactionHash}`);
}
main().catch(error => { console.error(error.shortMessage ? `Arc request failed (${error.name}); private journal retained.` : error.message); process.exitCode = 1; });
