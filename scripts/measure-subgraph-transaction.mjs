// Step 4-A: one real Arc Testnet Transfer, from a ticket holder to the SAME holder.
// --check TOKEN_ID is read-only. --send TOKEN_ID signs once; reruns never rebroadcast.
// A private journal prevents accidental duplicate samples. No keys or raw signatures are exported.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createPublicClient, createWalletClient, defineChain, http, encodeFunctionData, parseEventLogs, keccak256, parseEther, formatEther, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadDeployment } from './lib/deployment.mjs';
import { json, queryGraph, observeIndexedTransfer } from './lib/graph-acceptance.mjs';
import abis from '../server/abis.json' with { type: 'json' };

const [mode = '--check', id = '10'] = process.argv.slice(2);
assert.ok(['--check', '--send'].includes(mode) && /^\d{1,8}$/.test(id) && process.argv.length <= 4, 'Use --check TOKEN_ID or --send TOKEN_ID');
const tokenId = BigInt(id);
const d = loadDeployment('arc-testnet');
assert.equal(d.chainId, 5042002, 'Only Arc Testnet is supported');
// Address and public endpoints come from the committed deployment, never from a secret.
const owner = d.deployer;
const chain = defineChain({ id: d.chainId, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [d.rpc] } } });
const client = createPublicClient({ chain, transport: http(d.rpc, { timeout: 20000, retryCount: 2 }) });
const nft = d.contracts.TicketNFT.address;
const journalFile = `.data/graph-acceptance/transfer-${tokenId}.json`;
const evidenceFile = `docs/checks/graph-transfer-${tokenId}.json`;
const lockFile = '.data/demo-tickets/issuer.lock';
const write = (file, value) => { fs.writeFileSync(`${file}.tmp`, json(value)); fs.renameSync(`${file}.tmp`, file); };
const read = (functionName, args) => client.readContract({ address: nft, abi: abis.TicketNFT, functionName, args });
const query = `query TransferIndexed($id: ID!, $minBlock: Int!) {
  _meta(block: { number_gte: $minBlock }) { block { number timestamp } hasIndexingErrors deployment }
  ticket(id: $id, block: { number_gte: $minBlock }) { id owner escrowed updatedAtBlock }
}`;

async function main() {
  assert.equal(await client.getChainId(), 5042002, 'RPC chain mismatch');
  if (fs.existsSync(journalFile)) {
    if (fs.existsSync(evidenceFile)) { console.log(`Existing completed sample: ${evidenceFile}. No transaction sent.`); return; }
    throw new Error('An interrupted sample journal exists. Inspect its transaction before measuring again; do not replay an old receipt as a new latency measurement.');
  }
  assert.equal((await read('ownerOf', [tokenId])).toLowerCase(), owner.toLowerCase(), 'Ticket must be held by the public deployment operator');
  assert.equal(await read('isRedeemed', [tokenId]), false, 'Redeemed ticket');
  assert.equal((await read('getApproved', [tokenId])).toLowerCase(), zeroAddress, 'Self-transfer would clear an existing ticket approval');
  assert.equal((await client.readContract({ address: d.contracts.Escrow.address, abi: abis.Escrow, functionName: 'depositor', args: [tokenId] })).toLowerCase(), zeroAddress, 'Ticket is deposited');
  const [latestNonce, pendingNonce] = await Promise.all([
    client.getTransactionCount({ address: owner, blockTag: 'latest' }),
    client.getTransactionCount({ address: owner, blockTag: 'pending' }),
  ]);
  assert.equal(pendingNonce, latestNonce, 'Operator has pending transactions');
  const before = await queryGraph(d.subgraphUrl, query, { id: String(tokenId), minBlock: 0 });
  assert.ok(!before.errors && before.data?.ticket, 'Ticket must already be indexed');
  assert.equal(before.data._meta.hasIndexingErrors, false);
  assert.equal(before.data._meta.deployment, d.raw.subgraphDeployment);
  assert.equal(before.data.ticket.owner.toLowerCase(), owner.toLowerCase());
  const gas = 150000n;
  const args = [owner, owner, tokenId];
  await client.simulateContract({ account: owner, address: nft, abi: abis.TicketNFT, functionName: 'transferFrom', args, gas });
  console.log(`Arc Testnet ticket #${tokenId}: ${owner} -> same owner; Transfer updates the indexed ticket. Gas limit ${gas}; fee ceiling 0.02 test USDC.`);
  if (mode === '--check') return;

  fs.mkdirSync('.data/graph-acceptance', { recursive: true });
  fs.mkdirSync('.data/demo-tickets', { recursive: true });
  fs.mkdirSync('docs/checks', { recursive: true });
  const lock = fs.openSync(lockFile, 'wx');
  try {
    // Load a signing credential only for --send. It stays local; it is never sent to Studio.
    if (fs.existsSync('.env')) loadEnvFile('.env');
    const key = process.env.DEMO_ISSUER_PRIVATE_KEY || process.env.PRIVATE_KEY;
    assert.ok(key, 'Missing local testnet signing credential');
    const account = privateKeyToAccount(key);
    assert.equal(account.address.toLowerCase(), owner.toLowerCase(), 'Signing credential does not match the public operator');
    const wallet = createWalletClient({ account, chain, transport: http(d.rpc) });
    const request = await wallet.prepareTransactionRequest({ to: nft, data: encodeFunctionData({ abi: abis.TicketNFT, functionName: 'transferFrom', args }), gas, nonce: pendingNonce });
    const maximumFee = gas * (request.maxFeePerGas ?? request.gasPrice ?? 0n);
    assert.ok(maximumFee > 0n && maximumFee <= parseEther('0.02'), 'Transaction exceeds the 0.02 test USDC fee ceiling');
    assert.ok(await client.getBalance({ address: owner }) >= maximumFee, 'Insufficient native USDC for gas');
    const raw = await wallet.signTransaction(request);
    const hash = keccak256(raw);
    const journal = { chainId: 5042002, owner, tokenId, hash, raw, maximumFee, before: before.data, createdAt: new Date().toISOString() };
    write(journalFile, journal); // ignored private journal, persisted before broadcasting
    const sentAt = performance.now();
    assert.equal(await client.sendRawTransaction({ serializedTransaction: raw }), hash);
    console.log(`Broadcast ${hash}`);
    const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 500, timeout: 60000 });
    const receiptObservedClock = performance.now();
    const receiptObservedAt = new Date().toISOString();
    const submissionToReceiptObservedMs = Math.round(receiptObservedClock - sentAt);
    assert.equal(receipt.status, 'success', 'Probe transaction reverted');
    const transfers = parseEventLogs({ abi: abis.TicketNFT, eventName: 'Transfer', logs: receipt.logs.filter(log => log.address.toLowerCase() === nft.toLowerCase()) });
    assert.equal(transfers.length, 1);
    assert.equal(transfers[0].args.from.toLowerCase(), owner.toLowerCase());
    assert.equal(transfers[0].args.to.toLowerCase(), owner.toLowerCase());
    assert.equal(transfers[0].args.tokenId, tokenId);
    const result = await observeIndexedTransfer({
      startedAt: receiptObservedClock,
      read: () => queryGraph(d.subgraphUrl, query, { id: String(tokenId), minBlock: Number(receipt.blockNumber) }),
      expected: { block: receipt.blockNumber, owner, tokenId, deployment: d.raw.subgraphDeployment },
    });
    const record = {
      measuredAt: new Date().toISOString(), chainId: 5042002, endpoint: d.subgraphUrl,
      kind: 'receipt-observed-to-indexed-ticket-observed', transactionHash: hash, tokenId, owner,
      blockNumber: receipt.blockNumber, receiptObservedAt,
      submissionToReceiptObservedMs, ...result,
      gasUsed: receipt.gasUsed, gasFeeUSDC: formatEther(receipt.gasUsed * receipt.effectiveGasPrice),
      ownershipChanged: false, before: before.data,
      scope: 'One observed sample, including Graph request time and polling. Not exact graph-node processing latency, a median, or a worst-case bound.',
    };
    write(evidenceFile, record);
    write(journalFile, { ...journal, completed: true, evidenceFile });
    console.log(json({ transactionHash: hash, blockNumber: receipt.blockNumber, receiptToIndexedObservedMs: result.receiptToIndexedObservedMs, polls: result.polls.length, gasFeeUSDC: record.gasFeeUSDC, evidenceFile }));
  } finally { fs.closeSync(lock); fs.unlinkSync(lockFile); }
}

main().catch(error => {
  // Never print viem request objects: they can contain raw signed transactions or endpoints.
  console.error(error.name === 'AssertionError' || error.constructor === Error ? error.message : `Measurement failed (${error.name}). Inspect the private journal before retrying.`);
  process.exitCode = 1;
});
