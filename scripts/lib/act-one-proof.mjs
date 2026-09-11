import assert from 'node:assert/strict';
import { encodeFunctionData, parseEventLogs, erc20Abi } from 'viem';
import abis from '../../server/abis.json' with { type: 'json' };
import { restoreIntent } from './demo-state.mjs';

const lower = value => value.toLowerCase();

// Receipt checks are independent of the runner's transaction submission path.
export function inspectActOneReceipt(deployment, evidence, transaction, receipt, block) {
  return inspectSceneReceipt(deployment, evidence, transaction, receipt, block, 'cycle');
}

export function inspectActTwoReceipt(deployment, evidence, transaction, receipt, block) {
  return inspectSceneReceipt(deployment, evidence, transaction, receipt, block, 'open-chain');
}

function inspectSceneReceipt(deployment, evidence, transaction, receipt, block, shape) {
  assert.equal(transaction.chainId, 5042002, 'Wrong transaction chain');
  assert.equal(receipt.status, 'success', 'Settlement reverted');
  assert.equal(lower(transaction.to), lower(deployment.contracts.Settlement), 'Wrong destination');
  assert.equal(transaction.hash, receipt.transactionHash, 'Receipt/transaction mismatch');
  assert.equal(block.hash, receipt.blockHash, 'Receipt/block mismatch');
  assert(block.transactions.includes(transaction.hash), 'Transaction missing from receipt block');
  // Some Arc eth_getTransactionByHash responses leave blockHash null even after
  // inclusion. The full block's transaction list above provides the binding.
  if (transaction.blockHash !== null) assert.equal(transaction.blockHash, receipt.blockHash, 'Receipt/transaction block mismatch');
  const intents = evidence.proposal.intents.map(restoreIntent);
  const legs = evidence.proposal.legs.map(l => ({ ...l, receives: l.receives.map(BigInt), netPayment: BigInt(l.netPayment) }));
  const count = shape === 'cycle' ? 3 : 4;
  assert.equal(intents.length, count);
  assert.equal(new Set(intents.map(i => lower(i.owner))).size, count);
  assert.equal(legs.length, count);
  if (shape === 'cycle') {
    assert(intents.every(i => i.offered.length === 2 && i.exactCount === 2));
    assert(legs.every(l => l.receives.length === 2));
  } else {
    assert.equal(intents.filter(i => i.offered.length === 0 && i.exactCount === 2).length, 1, 'Missing pure buyer');
    assert.equal(intents.filter(i => i.offered.length === 2 && i.exactCount === 0).length, 1, 'Missing pure seller');
    assert.equal(intents.filter(i => i.offered.length === 2 && i.exactCount === 2).length, 2, 'Expected two swappers');
    assert(legs.every((l, i) => l.receives.length === intents[i].exactCount));
  }
  assert.equal(transaction.input, encodeFunctionData({ abi: abis.Settlement, functionName: 'settle', args: [intents, legs] }), 'Calldata differs from simulated proposal');
  const offered = new Map(intents.flatMap(i => i.offered.map(id => [String(id), i.owner])));
  assert.equal(offered.size, 6);
  const events = (abi, address, eventName) => parseEventLogs({ abi, eventName, strict: true, logs: receipt.logs.filter(l => lower(l.address) === lower(address)) });
  const settled = events(abis.Settlement, deployment.contracts.Settlement, 'Settled');
  assert.equal(settled.length, 1);
  assert.equal(settled[0].args.participantCount, BigInt(count));
  assert.deepEqual(settled[0].args.intentHashes, legs.map(l => l.intentHash));
  const transfers = events(abis.TicketNFT, deployment.contracts.TicketNFT, 'Transfer');
  assert.equal(transfers.length, 6, 'Must contain exactly six NFT Transfer events');
  assert.equal(new Set(transfers.map(t => String(t.args.tokenId))).size, 6, 'Duplicate NFT transfer');
  const tickets = legs.flatMap((leg, i) => leg.receives.map(id => {
    const transfer = transfers.find(t => t.args.tokenId === id);
    assert(transfer, 'Missing NFT transfer');
    assert.equal(lower(transfer.args.from), lower(deployment.contracts.Escrow));
    assert.equal(lower(transfer.args.to), lower(intents[i].owner));
    assert(offered.has(String(id)), 'Received ticket was not offered');
    assert.notEqual(lower(offered.get(String(id))), lower(intents[i].owner), 'Ticket must change beneficial owner');
    return { tokenId: String(id), previousParticipant: offered.get(String(id)), recipient: intents[i].owner,
      transferFrom: transfer.args.from, logIndex: transfer.logIndex };
  }));
  assert.equal(new Set(tickets.map(t => t.tokenId)).size, 6);
  if (shape === 'open-chain') {
    const seller = intents.find(i => i.exactCount === 0);
    const buyer = intents.find(i => i.offered.length === 0);
    const visited = new Set();
    let cursor = seller.owner;
    // Follow the actual NFT recipients: every pair must travel along one open
    // path from the pure seller through both swappers to the pure buyer.
    while (!sameOwner(cursor, buyer.owner)) {
      assert(!visited.has(lower(cursor)), 'Ticket route contains a cycle');
      visited.add(lower(cursor));
      const outgoing = tickets.filter(t => sameOwner(t.previousParticipant, cursor));
      assert.equal(outgoing.length, 2);
      assert(sameOwner(outgoing[0].recipient, outgoing[1].recipient), 'Pair split across recipients');
      cursor = outgoing[0].recipient;
    }
    assert.equal(visited.size, 3, 'Ticket path does not include both swappers');
    assert.equal(legs[intents.indexOf(buyer)].netPayment > 0n, true, 'Buyer must pay');
    assert.equal(legs[intents.indexOf(seller)].netPayment < 0n, true, 'Seller must receive USDC');
  }
  assert.equal(legs.reduce((n, l) => n + l.netPayment, 0n), 0n);
  const payments = events(erc20Abi, deployment.usdc, 'Transfer');
  const settlement = lower(deployment.contracts.Settlement);
  for (let i = 0; i < intents.length; i++) {
    const owner = lower(intents[i].owner);
    const debit = payments.filter(p => lower(p.args.from) === owner && lower(p.args.to) === settlement).reduce((n, p) => n + p.args.value, 0n);
    const credit = payments.filter(p => lower(p.args.from) === settlement && lower(p.args.to) === owner).reduce((n, p) => n + p.args.value, 0n);
    assert.equal(debit - credit, legs[i].netPayment, 'USDC transfer does not match owner net');
  }
  return { tickets, participants: intents.map((intent, i) => ({ owner: intent.owner, offered: intent.offered.map(String),
    received: legs[i].receives.map(String), netPayment: String(legs[i].netPayment), intentHash: legs[i].intentHash })) };
}

export async function auditActOne(client, deployment, evidence, hash) {
  return auditScene(client, deployment, evidence, hash, inspectActOneReceipt);
}

export async function auditActTwo(client, deployment, evidence, hash) {
  return auditScene(client, deployment, evidence, hash, inspectActTwoReceipt);
}

const sameOwner = (a, b) => lower(a) === lower(b);

async function auditScene(client, deployment, evidence, hash, inspect) {
  assert.equal(await client.getChainId(), 5042002);
  const [transaction, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  const proof = inspect(deployment, evidence, transaction, receipt, block);
  const read = (name, functionName, args, blockNumber) => client.readContract({ address: deployment.contracts[name], abi: abis[name], functionName, args, blockNumber });
  const beforeBlock = receipt.blockNumber - 1n;
  for (const participant of proof.participants) {
    assert.equal(await read('IntentRegistry', 'state', [participant.intentHash], beforeBlock), 1, 'Intent was not LIVE before settlement');
    assert.equal(await read('IntentRegistry', 'state', [participant.intentHash], receipt.blockNumber), 3, 'Intent did not become SETTLED');
  }
  for (const ticket of proof.tickets) {
    const id = BigInt(ticket.tokenId);
    assert.equal(lower(await read('TicketNFT', 'ownerOf', [id], beforeBlock)), lower(deployment.contracts.Escrow));
    assert.equal(lower(await read('Escrow', 'depositor', [id], beforeBlock)), lower(ticket.previousParticipant));
    assert.equal(lower(await read('TicketNFT', 'ownerOf', [id], receipt.blockNumber)), lower(ticket.recipient));
    assert.equal(await read('Escrow', 'depositor', [id], receipt.blockNumber), '0x0000000000000000000000000000000000000000');
    const [eventId, sessionId, sectionId, row, seat, status] = await read('TicketNFT', 'meta', [id], receipt.blockNumber);
    ticket.meta = { eventId, sessionId, sectionId, row, seat, status };
  }
  return { chainId: 5042002, transactionHash: hash, blockNumber: String(receipt.blockNumber), blockHash: receipt.blockHash,
    beforeBlock: String(beforeBlock), checkedAt: new Date().toISOString(), status: 'verified',
    settlement: deployment.contracts.Settlement, ticketNFT: deployment.contracts.TicketNFT, escrow: deployment.contracts.Escrow,
    participantCount: proof.participants.length, ticketTransferCount: proof.tickets.length, settlementTransactionCount: 1, ...proof };
}
