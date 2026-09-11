import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi } from 'viem';
import { solve, hashIntent } from '../solver/dist/index.js';
import abis from '../server/abis.json' with { type: 'json' };
import { inspectActTwoReceipt } from './lib/act-one-proof.mjs';

const address = n => `0x${n.toString(16).padStart(40, '0')}`;
const hash = n => `0x${n.toString(16).padStart(64, '0')}`;
const config = { maxParticipants: 4, maxCandidates: 100, timeoutMs: 2000 };
function scenario(offset = 0) {
  const owners = [1, 2, 3, 4].map(i => address(i + offset));
  const intents = owners.map((owner, i) => ({ owner, offered: i === 0 ? [] : [BigInt((i - 1) * 2), BigInt((i - 1) * 2 + 1)],
    eventId: 1, sessionMask: i < 3 ? 1n << BigInt(i) : 7n, sectionMask: 1n,
    exactCount: i === 3 ? 0 : 2, mustShareSession: i !== 3, mustShareSection: i !== 3, mustBeAdjacent: i !== 3,
    maxNetPay: i === 3 ? -300000n : 100000n, deadline: 9999999999n, nonce: 0n }));
  const state = { ticketMeta: new Map(), depositor: new Map(), intentState: new Map(), usdcBalance: new Map(), usdcAllowance: new Map(), blockTimestamp: 1n };
  intents.forEach((intent, i) => {
    state.intentState.set(hashIntent(intent), 1);
    state.usdcBalance.set(intent.owner, 1000000n); state.usdcAllowance.set(intent.owner, 1000000n);
    intent.offered.forEach((id, j) => {
      state.ticketMeta.set(id, { eventId: 1, sessionId: i - 1, sectionId: 0, row: 3, seat: j + 1, status: 0 });
      state.depositor.set(id, intent.owner);
    });
  });
  return { intents, state };
}
function fixture(shortcut = false) {
  const { intents, state } = scenario();
  const proposal = solve(intents, state, config).chosen;
  assert(proposal);
  if (shortcut) {
    // Six moves and four participants can also be a buyer/seller trade alongside
    // a disconnected swap cycle; that is not the single open path being claimed.
    [[4n, 5n], [2n, 3n], [0n, 1n], []].forEach((ids, i) => { proposal.legs[i].receives = ids; });
  }
  const deployment = { contracts: { Settlement: address(10), Escrow: address(11), TicketNFT: address(12) }, usdc: address(13) };
  const evidence = { proposal };
  const transaction = { chainId: 5042002, to: deployment.contracts.Settlement, hash: hash(20), blockHash: hash(21),
    input: encodeFunctionData({ abi: abis.Settlement, functionName: 'settle', args: [proposal.intents, proposal.legs] }) };
  const logs = proposal.legs.flatMap((l, i) => l.receives.map(tokenId => ({ address: deployment.contracts.TicketNFT, data: '0x',
    topics: encodeEventTopics({ abi: abis.TicketNFT, eventName: 'Transfer', args: { from: deployment.contracts.Escrow, to: proposal.intents[i].owner, tokenId } }) })));
  proposal.legs.forEach((leg, i) => {
    const paying = leg.netPayment > 0n;
    logs.push({ address: deployment.usdc, topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: {
      from: paying ? proposal.intents[i].owner : deployment.contracts.Settlement,
      to: paying ? deployment.contracts.Settlement : proposal.intents[i].owner,
    } }), data: encodeAbiParameters([{ type: 'uint256' }], [paying ? leg.netPayment : -leg.netPayment]) });
  });
  logs.push({ address: deployment.contracts.Settlement, topics: encodeEventTopics({ abi: abis.Settlement, eventName: 'Settled', args: { proposer: address(1) } }),
    data: encodeAbiParameters([{ type: 'bytes32[]' }, { type: 'uint256' }], [proposal.legs.map(l => l.intentHash), 4n]) });
  const receipt = { status: 'success', transactionHash: transaction.hash, blockHash: transaction.blockHash, logs: logs.map((l, i) => ({ ...l, logIndex: i })) };
  return { deployment, evidence, transaction, receipt, block: { hash: transaction.blockHash, transactions: [transaction.hash] } };
}
const inspect = f => inspectActTwoReceipt(f.deployment, f.evidence, f.transaction, f.receipt, f.block);

test('existing solver finds a four-party open chain with no offered tickets for buyer and no received tickets for seller', () => {
  const f = fixture();
  const proof = inspect(f);
  assert.equal(proof.participants.length, 4);
  assert.equal(proof.tickets.length, 6);
  assert.deepEqual(proof.participants.find(p => p.offered.length === 0).received, ['0', '1']);
  assert.equal(proof.participants.find(p => p.received.length === 0).netPayment, '-300000');
});
test('removing buyer or seller finds no candidate, restoring both finds a candidate', () => {
  const { intents, state } = scenario();
  for (const removed of [0, 3]) assert.equal(solve(intents.filter((_, i) => i !== removed), state, config).chosen, null);
  assert(solve(intents, state, config).chosen);
});
test('different wallet addresses and input ordering still solve the open chain', () => {
  const { intents, state } = scenario(100);
  const result = solve([...intents].reverse(), state, config);
  assert.equal(result.chosen.intents.length, 4);
  for (const [i, leg] of result.chosen.legs.entries()) {
    assert.equal(leg.receives.length, result.chosen.intents[i].exactCount);
  }
});
test('changing the buyer signed budget or revoking the seller invalidates this chain', () => {
  const { intents, state } = scenario();
  const changed = { ...intents[0], maxNetPay: 0n };
  state.intentState.set(hashIntent(changed), 1);
  assert.equal(solve([changed, ...intents.slice(1)], state, config).chosen, null);
  state.intentState.set(hashIntent(intents[3]), 2);
  assert.equal(solve(intents, state, config).chosen, null);
});
test('receipt audit refuses wrong recipients and missing seller payments', () => {
  const wrong = fixture(); wrong.receipt.logs[0].topics = encodeEventTopics({ abi: abis.TicketNFT, eventName: 'Transfer', args: { from: wrong.deployment.contracts.Escrow, to: address(99), tokenId: 0n } });
  assert.throws(() => inspect(wrong));
  const unpaid = fixture(); unpaid.receipt.logs = unpaid.receipt.logs.filter(l => !(l.address === unpaid.deployment.usdc && l.data === encodeAbiParameters([{ type: 'uint256' }], [300000n])));
  assert.throws(() => inspect(unpaid), /USDC transfer/);
});
test('receipt audit rejects a disconnected swap cycle even with four participants and six transfers', () => {
  assert.throws(() => inspect(fixture(true)), /does not include both swappers/);
});
