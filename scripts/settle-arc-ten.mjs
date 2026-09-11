import fs from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createPublicClient, createWalletClient, defineChain, http, encodeFunctionData, erc20Abi, keccak256, hashStruct, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

loadEnvFile('.env');
loadEnvFile('.env.seed');
const manifest = JSON.parse(fs.readFileSync('deployments/arc-testnet.json', 'utf8'));
const abis = JSON.parse(fs.readFileSync('server/abis.json', 'utf8'));
const endpoint = process.env.SOLVE_API_URL ?? 'http://127.0.0.1:3101';
const chain = defineChain({ id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [process.env.ARC_RPC] } } });
const transport = http(process.env.ARC_RPC, { timeout: 20000, retryCount: 1 });
const client = createPublicClient({ chain, transport });
if (await client.getChainId() !== 5042002) throw new Error('Wrong chain');
const accounts = [process.env.PRIVATE_KEY, process.env.SEED_B_PRIVATE_KEY, process.env.SEED_C_PRIVATE_KEY].map(privateKeyToAccount);
if (accounts.some((a, i) => a.address !== manifest.seed.accounts[i])) throw new Error('Participant wallet mismatch');
const path = '.arc-settlements.json';
const journal = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : { settlement: manifest.contracts.Settlement, steps: {}, rounds: {} };
if (journal.settlement !== manifest.contracts.Settlement) throw new Error('Journal deployment mismatch');
const stringify = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
function save() { fs.writeFileSync(`${path}.tmp`, stringify(journal)); fs.renameSync(`${path}.tmp`, path); }
async function api(path, body) {
  const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Backend HTTP ${response.status}`);
  return result;
}
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
  if (receipt.status !== 'success') throw new Error(`Reverted: ${label} ${step.hash}`);
  step.blockNumber = receipt.blockNumber.toString();
  step.status = receipt.status;
  save();
  console.log(`${label}: ${step.hash}`);
  return receipt;
}
const read = (name, functionName, args) => client.readContract({ address: manifest.contracts[name], abi: abis[name], functionName, args });
const write = (label, name, functionName, args, account) => transact(label, account, { to: manifest.contracts[name], data: encodeFunctionData({ abi: abis[name], functionName, args }), gas: 1000000n });
const types = { Intent: abis.IntentRegistry.find(a => a.name === 'commit').inputs[0].components.map(({ name, type }) => ({ name, type })) };
function restore(record) {
  const intent = { ...record, offered: record.offered.map(BigInt) };
  for (const field of ['sessionMask', 'sectionMask', 'maxNetPay', 'deadline', 'nonce']) intent[field] = BigInt(intent[field]);
  return intent;
}
async function prepareRound(round) {
  let record = journal.rounds[round];
  if (!record) {
    const originalLive = round === 1 && (await Promise.all(manifest.seed.intents.map(i => read('IntentRegistry', 'state', [i.hash])))).every(s => s === 1);
    if (originalLive) {
      record = { intents: manifest.seed.intents, existing: true };
    } else {
      const holdings = accounts.map(() => []);
      for (const t of manifest.seed.tickets) {
        const id = BigInt(t.tokenId);
        const owner = await read('TicketNFT', 'ownerOf', [id]);
        const i = accounts.findIndex(a => a.address.toLowerCase() === owner.toLowerCase());
        if (i < 0) throw new Error('Expected ticket in participant wallet before new round');
        holdings[i].push(id);
      }
      if (holdings.some(ids => ids.length !== 4)) throw new Error('Expected four tickets per participant');
      const deadline = (await client.getBlock()).timestamp + 30n * 86400n;
      const intents = [];
      for (let i = 0; i < accounts.length; i++) {
        const [, sessionId, sectionId] = await read('TicketNFT', 'meta', [holdings[(i + 1) % 3][0]]);
        let nonce = BigInt(round - 1);
        while (await read('IntentRegistry', 'usedNonce', [accounts[i].address, nonce])) nonce++;
        const intent = { owner: accounts[i].address, offered: holdings[i], eventId: 1, sessionMask: 1n << BigInt(sessionId), sectionMask: 1n << BigInt(sectionId), exactCount: 4, mustShareSession: true, mustShareSection: true, mustBeAdjacent: true, maxNetPay: [100000n, 0n, -100000n][i], deadline, nonce };
        const hash = await read('IntentRegistry', 'hashIntent', [intent]);
        if (hash !== hashStruct({ primaryType: 'Intent', types, data: intent })) throw new Error('Hash mismatch');
        intents.push({ ...intent, hash });
      }
      record = JSON.parse(stringify({ intents }));
    }
    journal.rounds[round] = record;
    save();
  }
  if (!record.existing && !record.prepared) {
    for (let i = 0; i < accounts.length; i++) {
      const intent = restore(record.intents[i]);
      await write(`round:${round}:deposit:${i}`, 'Escrow', 'deposit', [intent.offered], accounts[i]);
      await transact(`round:${round}:approve:${i}`, accounts[i], { to: manifest.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [manifest.contracts.Settlement, 500000n] }), gas: 200000n });
      const signature = await accounts[i].signTypedData({ domain: { name: 'RESHUFFLE', version: '1', chainId: 5042002, verifyingContract: manifest.contracts.IntentRegistry }, types, primaryType: 'Intent', message: intent });
      await write(`round:${round}:commit:${i}`, 'IntentRegistry', 'commit', [intent, signature], accounts[0]);
    }
  }
  record.prepared = true;
  save();
  return record;
}
fs.mkdirSync('deployments/settlements', { recursive: true });
for (let round = 1; round <= 10; round++) {
  const record = await prepareRound(round);
  if (!record.confirmed) {
    if (!record.evidence || !journal.steps[`round:${round}:settle`]) {
      record.evidence = await api('/api/solve', { intentHashes: record.intents.map(i => i.hash) });
      save();
    }
    const evidence = record.evidence;
    if (!evidence.transaction || !evidence.simulationResult?.success) throw new Error(`Backend did not produce a simulated proposal in round ${round}`);
    const receipt = await transact(`round:${round}:settle`, accounts[0], { to: evidence.transaction.to, data: evidence.transaction.data, gas: BigInt(evidence.transaction.gas) });
    const [settled] = parseEventLogs({ abi: abis.Settlement, eventName: 'Settled', logs: receipt.logs.filter(l => l.address.toLowerCase() === manifest.contracts.Settlement.toLowerCase()) });
    if (!settled || settled.args.participantCount !== 3n) throw new Error('Missing three-participant settlement event');
    for (let i = 0; i < evidence.proposal.legs.length; i++) {
      const intent = evidence.proposal.intents[i];
      const leg = evidence.proposal.legs[i];
      if (await read('IntentRegistry', 'state', [leg.intentHash]) !== 3) throw new Error('Intent did not settle');
      for (const id of leg.receives) {
        if ((await read('TicketNFT', 'ownerOf', [BigInt(id)])).toLowerCase() !== intent.owner.toLowerCase()) throw new Error('Recipient mismatch');
      }
    }
    record.confirmed = await api(`/api/evidence/${evidence.id}/receipt`, { transactionHash: receipt.transactionHash });
    save();
  }
  fs.writeFileSync(`deployments/settlements/${String(round).padStart(2, '0')}.json`, stringify(record.confirmed) + '\n');
  console.log(`CONFIRMED ${round}/10: ${record.confirmed.transactionHash}`);
}
// Leave another signed round available for the interactive demo after measurements.
const ready = await prepareRound(11);
fs.writeFileSync('deployments/demo-ready.json', stringify({ chainId: 5042002, settlement: manifest.contracts.Settlement, intents: ready.intents }) + '\n');
const settlements = Object.entries(journal.rounds).filter(([, r]) => r.confirmed).map(([round, r]) => ({ round: Number(round), transactionHash: r.confirmed.transactionHash, blockNumber: r.confirmed.receipt.blockNumber, evidenceId: r.confirmed.id }));
fs.writeFileSync('deployments/settlements.json', stringify(settlements) + '\n');
const rows = settlements.map(s => `| ${s.round} | ${s.blockNumber} | [${s.transactionHash}](https://testnet.arcscan.app/tx/${s.transactionHash}) |`).join('\n');
const section = `<!-- BEGIN ARC SETTLEMENTS -->\n## Confirmed Arc Testnet settlements\n\nTen demonstration settlements on Arc Testnet (chain ID 5042002), using the same 12 tickets across three controlled test wallets. Each round commits fresh signed conditions; the backend searches current chain state and simulates before the local runner submits. These are repeatable integration demonstrations, not evidence of organic market demand.\n\n| Round | Block | Confirmed transaction |\n| --- | --- | --- |\n${rows}\n\nFull per-round proposals, exclusions, simulation results and verified receipts: [settlement evidence](deployments/settlements/). Backend setup: [server documentation](server/README.md).\n<!-- END ARC SETTLEMENTS -->`;
let readme = fs.readFileSync('README.md', 'utf8');
const region = /<!-- BEGIN ARC SETTLEMENTS -->[\s\S]*?<!-- END ARC SETTLEMENTS -->/;
readme = region.test(readme) ? readme.replace(region, section) : `${readme}\n\n${section}\n`;
fs.writeFileSync('README.md', readme);
console.log('Ten confirmed settlements saved. Round 11 is LIVE for the demo.');
