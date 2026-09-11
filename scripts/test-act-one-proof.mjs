import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi } from 'viem';
import abis from '../server/abis.json' with { type: 'json' };
import { inspectActOneReceipt } from './lib/act-one-proof.mjs';

const address = n => `0x${n.toString(16).padStart(40, '0')}`;
const hash = n => `0x${n.toString(16).padStart(64, '0')}`;
function fixture() {
  const deployment = { contracts: { Settlement: address(10), Escrow: address(11), TicketNFT: address(12) }, usdc: address(13) };
  const owners = [address(1), address(2), address(3)];
  const intents = owners.map((owner, i) => ({ owner, offered: [String(i * 2), String(i * 2 + 1)], eventId: 1,
    sessionMask: '1', sectionMask: '1', exactCount: 2, mustShareSession: true, mustShareSection: true,
    mustBeAdjacent: true, maxNetPay: '0', deadline: '9999999999', nonce: '0' }));
  const legs = intents.map((_, i) => ({ intentHash: hash(i + 1), receives: intents[(i + 1) % 3].offered, netPayment: '0' }));
  const evidence = { proposal: { intents, legs } };
  const input = encodeFunctionData({ abi: abis.Settlement, functionName: 'settle', args: [intents, legs] });
  const transaction = { chainId: 5042002, to: deployment.contracts.Settlement, hash: hash(20), blockHash: hash(21), input };
  const logs = legs.flatMap((leg, i) => leg.receives.map(id => ({ address: deployment.contracts.TicketNFT,
    topics: encodeEventTopics({ abi: abis.TicketNFT, eventName: 'Transfer', args: { from: deployment.contracts.Escrow, to: owners[i], tokenId: BigInt(id) } }), data: '0x' })));
  logs.push({ address: deployment.contracts.Settlement,
    topics: encodeEventTopics({ abi: abis.Settlement, eventName: 'Settled', args: { proposer: owners[0] } }),
    data: encodeAbiParameters([{ type: 'bytes32[]' }, { type: 'uint256' }], [legs.map(l => l.intentHash), 3n]) });
  const receipt = { status: 'success', transactionHash: transaction.hash, blockHash: transaction.blockHash,
    logs: logs.map((l, i) => ({ ...l, logIndex: i })) };
  return { deployment, evidence, transaction, receipt, block: { hash: transaction.blockHash, transactions: [transaction.hash] } };
}
const inspect = f => inspectActOneReceipt(f.deployment, f.evidence, f.transaction, f.receipt, f.block);

test('accepts six distinct escrow releases and reconstructs each previous participant', () => {
  const result = inspect(fixture());
  assert.equal(result.tickets.length, 6);
  assert.equal(result.participants.length, 3);
  assert(result.tickets.every(t => t.previousParticipant !== t.recipient));
});
test('rejects five releases and unrelated NFT lookalike logs', () => {
  const f = fixture(); f.receipt.logs[0].address = address(99);
  assert.throws(() => inspect(f), /exactly six/);
});
test('rejects six events that include a duplicate token', () => {
  const f = fixture(); f.receipt.logs[1] = { ...f.receipt.logs[0] };
  assert.throws(() => inspect(f), /Duplicate NFT/);
});
test('rejects a transfer to the wrong participant', () => {
  const f = fixture(); f.receipt.logs[0].topics = encodeEventTopics({ abi: abis.TicketNFT, eventName: 'Transfer', args: { from: f.deployment.contracts.Escrow, to: address(99), tokenId: 2n } });
  assert.throws(() => inspect(f));
});
test('rejects calldata from a different proposal, failed receipts and another chain', () => {
  const f = fixture(); f.transaction.input = '0x';
  assert.throws(() => inspect(f), /Calldata/);
  const failed = fixture(); failed.receipt.status = 'reverted';
  assert.throws(() => inspect(failed), /reverted/);
  const foreign = fixture(); foreign.transaction.chainId = 31337;
  assert.throws(() => inspect(foreign), /Wrong transaction chain/);
});
test('rejects USDC moving contrary to signed zero-net legs', () => {
  const f = fixture();
  f.receipt.logs.push({ address: f.deployment.usdc, topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: address(1), to: f.deployment.contracts.Settlement } }), data: encodeAbiParameters([{ type: 'uint256' }], [1n]), logIndex: 7 });
  assert.throws(() => inspect(f), /USDC transfer/);
});
test('accepts an Arc transaction with null blockHash only when the receipt block contains it', () => {
  const f = fixture(); f.transaction.blockHash = null;
  assert.equal(inspect(f).tickets.length, 6);
  f.block.transactions = [];
  assert.throws(() => inspect(f), /missing from receipt block/);
});
