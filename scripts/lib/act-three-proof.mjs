import assert from 'node:assert/strict';
import { decodeErrorResult, encodeFunctionData, erc20Abi } from 'viem';
import { hashIntent } from '../../solver/dist/index.js';
import abis from '../../server/abis.json' with { type: 'json' };
import { restoreIntent } from './demo-state.mjs';

const same = (a, b) => a.toLowerCase() === b.toLowerCase();
export const restoreProposal = proposal => ({ intents: proposal.intents.map(restoreIntent),
  legs: proposal.legs.map(l => ({ ...l, receives: l.receives.map(BigInt), netPayment: BigInt(l.netPayment) })) });
export function proposalData(proposal) {
  const restored = restoreProposal(proposal);
  return encodeFunctionData({ abi: abis.Settlement, functionName: 'settle', args: [restored.intents, restored.legs] });
}
export function decodeRejection(rawData) {
  const decoded = decodeErrorResult({ abi: abis.Settlement, data: rawData });
  return { errorName: decoded.errorName, args: decoded.args ?? [], rawData, selector: rawData.slice(0, 10) };
}
export async function simulateProposal(client, deployment, proposal, proposer, blockNumber) {
  const restored = restoreProposal(proposal);
  try {
    await client.simulateContract({ address: deployment.contracts.Settlement, abi: abis.Settlement, functionName: 'settle',
      args: [restored.intents, restored.legs], account: proposer, gas: 8000000n, blockNumber });
    return { success: true, blockNumber: String(blockNumber), rejection: null };
  } catch (error) {
    const reverted = error.walk?.(e => e.name === 'ContractFunctionRevertedError');
    if (!reverted?.raw || reverted.raw === '0x') throw new Error('RPC did not return decodable contract revert data.');
    return { success: false, blockNumber: String(blockNumber), rejection: decodeRejection(reverted.raw) };
  }
}
export function inspectAttack(valid, malicious) {
  const good = restoreProposal(valid);
  const bad = restoreProposal(malicious);
  assert.deepEqual(bad.intents, good.intents, 'Signed intents were changed');
  assert.equal(bad.intents.length, 3);
  assert.equal(new Set(bad.intents.map(i => i.owner.toLowerCase())).size, 3);
  assert.equal(bad.legs.length, 3);
  const buyers = bad.intents.flatMap((i, index) => i.exactCount === 2 && i.mustBeAdjacent && i.offered.length === 0 ? [index] : []);
  assert.equal(buyers.length, 2);
  assert.equal(bad.intents.filter(i => i.exactCount === 0 && i.offered.length === 4).length, 1);
  const offered = bad.intents.flatMap(i => i.offered).map(String).sort();
  assert.equal(new Set(offered).size, 4);
  assert.deepEqual(bad.legs.flatMap(l => l.receives).map(String).sort(), offered, 'Ticket conservation changed');
  assert.deepEqual(good.legs.flatMap(l => l.receives).map(String).sort(), offered);
  bad.legs.forEach((l, i) => {
    assert.equal(l.intentHash, hashIntent(bad.intents[i]), 'Hash mismatch');
    assert.equal(l.intentHash, good.legs[i].intentHash);
    assert.equal(l.netPayment, good.legs[i].netPayment, 'Payment changed');
    assert(l.netPayment <= bad.intents[i].maxNetPay);
    assert.equal(l.receives.length, bad.intents[i].exactCount);
  });
  assert.equal(bad.legs.reduce((n, l) => n + l.netPayment, 0n), 0n);
  assert.notEqual(proposalData(valid), proposalData(malicious), 'No attack mutation');
  return { buyers, targetIntentHash: bad.legs[buyers[0]].intentHash };
}

export async function auditActThree(client, deployment, record) {
  assert.equal(await client.getChainId(), 5042002);
  const { targetIntentHash } = inspectAttack(record.control.proposal, record.malicious);
  const hash = record.transactionHash;
  const receipt = await client.getTransactionReceipt({ hash });
  const tx = await client.getTransaction({ hash });
  assert.equal(receipt.status, 'reverted', 'Attack transaction did not revert');
  assert.equal(tx.chainId, 5042002);
  assert(same(tx.to, deployment.contracts.Settlement));
  assert(same(tx.from, record.proposer));
  assert.equal(tx.input, proposalData(record.malicious), 'Transaction is not the inspected attack');
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  assert.equal(block.hash, receipt.blockHash);
  assert(block.transactions.includes(hash));
  const beforeBlock = receipt.blockNumber - 1n;
  const good = await simulateProposal(client, deployment, record.control.proposal, record.proposer, beforeBlock);
  const bad = await simulateProposal(client, deployment, record.malicious, record.proposer, beforeBlock);
  assert(good.success, 'Control did not pass at the historical block');
  assert.equal(bad.rejection?.errorName, 'SeatsNotAdjacent');
  assert.equal(bad.rejection.args[0], targetIntentHash, 'Wrong rejected intent');
  const read = (name, functionName, args, blockNumber) => client.readContract({ address: deployment.contracts[name], abi: abis[name], functionName, args, blockNumber });
  const participants = [];
  const tickets = [];
  for (const intent of record.malicious.intents) {
    assert(!same(intent.owner, record.proposer), 'Proposer must be separate from participants');
    const intentHash = hashIntent(restoreIntent(intent));
    const beforeState = await read('IntentRegistry', 'state', [intentHash], beforeBlock);
    const afterState = await read('IntentRegistry', 'state', [intentHash], receipt.blockNumber);
    assert.equal(beforeState, 1); assert.equal(afterState, 1);
    const balances = [];
    const allowances = [];
    for (const blockNumber of [beforeBlock, receipt.blockNumber]) {
      balances.push(await client.readContract({ address: deployment.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [intent.owner], blockNumber }));
      allowances.push(await client.readContract({ address: deployment.usdc, abi: erc20Abi, functionName: 'allowance', args: [intent.owner, deployment.contracts.Settlement], blockNumber }));
    }
    assert.equal(balances[0], balances[1], 'Participant USDC balance changed');
    assert.equal(allowances[0], allowances[1], 'Participant allowance changed');
    participants.push({ owner: intent.owner, intentHash, beforeState, afterState,
      usdcBefore: String(balances[0]), usdcAfter: String(balances[1]), allowanceBefore: String(allowances[0]), allowanceAfter: String(allowances[1]) });
    for (const id of intent.offered) {
      const tokenId = BigInt(id);
      for (const blockNumber of [beforeBlock, receipt.blockNumber]) {
        assert(same(await read('TicketNFT', 'ownerOf', [tokenId], blockNumber), deployment.contracts.Escrow));
        assert(same(await read('Escrow', 'depositor', [tokenId], blockNumber), intent.owner));
      }
      const [eventId, sessionId, sectionId, row, seat, status] = await read('TicketNFT', 'meta', [tokenId], beforeBlock);
      assert.equal(status, 0);
      tickets.push({ tokenId: String(id), depositor: intent.owner, ownerBefore: deployment.contracts.Escrow, ownerAfter: deployment.contracts.Escrow,
        eventId, sessionId, sectionId, row, seat });
    }
  }
  assert(tickets.every(t => t.eventId === tickets[0].eventId && t.sessionId === tickets[0].sessionId && t.sectionId === tickets[0].sectionId && t.row === tickets[0].row));
  assert.deepEqual(tickets.map(t => t.seat).sort((a, b) => a - b), [1, 2, 3, 4]);
  assert.equal(receipt.logs.filter(l => same(l.address, deployment.contracts.TicketNFT) || same(l.address, deployment.contracts.Settlement)).length, 0, 'Unexpected ticket/settlement logs');
  const settlementBalances = await Promise.all([beforeBlock, receipt.blockNumber].map(blockNumber => client.readContract({ address: deployment.usdc, abi: erc20Abi,
    functionName: 'balanceOf', args: [deployment.contracts.Settlement], blockNumber })));
  assert.equal(settlementBalances[0], settlementBalances[1]);
  return { chainId: 5042002, transactionHash: hash, blockNumber: String(receipt.blockNumber), blockHash: receipt.blockHash,
    beforeBlock: String(beforeBlock), checkedAt: new Date().toISOString(), status: receipt.status,
    proposer: tx.from, settlement: tx.to, rejection: bad.rejection, rejectionSource: 'Historical eth_call of the exact transaction calldata at the preceding block; receipts contain status, not revert bytes.',
    control: good, participants, tickets, ticketTransfers: 0, settlementPayments: '0',
    settlementUsdcBefore: String(settlementBalances[0]), settlementUsdcAfter: String(settlementBalances[1]) };
}
