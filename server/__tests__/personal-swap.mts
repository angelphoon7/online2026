import test from 'node:test';
import assert from 'node:assert/strict';
import type { Address, Hex } from 'viem';
import type { ChainReceipt } from '../../lib/market-types';
import type { SettlementProposal } from '../../lib/solve-api';
import { proposalForWallet, receiptOutcomes, receiptTitle, walletChangesTickets } from '../../lib/personal-swap';

const A = `0x${'a'.repeat(40)}` as Address, B = `0x${'b'.repeat(40)}` as Address;
const hash = `0x${'1'.repeat(64)}` as Hex, otherHash = `0x${'2'.repeat(64)}` as Hex;
const receipt: ChainReceipt = { hash, status: 'success', blockNumber: '100', proposer: A, independent: true,
  ticketTransfers: 4, usdcTransfers: 0, netSum: '0', rejection: null,
  participants: [{ owner: B, offered: ['78', '79'], receives: ['78', '79'], netPayment: '0' },
    { owner: B.toUpperCase().replace('0X', '0x') as Address, offered: ['60', '61'], receives: ['60', '61'], netPayment: '0' }],
};

test('the reported same-owner receipt is grouped once and described as returned tickets', () => {
  assert.equal(receiptTitle(receipt, A), 'Tickets returned.');
  assert.equal(receiptTitle(receipt, B), 'Tickets returned.');
  assert.equal(walletChangesTickets(receipt.participants, B), false);
  const grouped = receiptOutcomes(receipt);
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].offered, ['78', '79', '60', '61']);
  assert.deepEqual(grouped[0].receives, grouped[0].offered);
});

test('internal reassignment between two requests is not a change of wallet ownership', () => {
  const outcomes = receipt.participants.map((row, i) => ({ ...row, receives: receipt.participants[1 - i].offered }));
  assert.equal(walletChangesTickets(outcomes, B), false);
  assert.equal(receiptTitle({ ...receipt, participants: outcomes }, A), 'Tickets returned.');
});

test('a successful exchange is personal only to its participants', () => {
  const participants = [{ owner: A, offered: ['34', '35'], receives: ['170', '171'], netPayment: '0' },
    { owner: B, offered: ['170', '171'], receives: ['34', '35'], netPayment: '0' }];
  const exchanged = { ...receipt, participants };
  assert.equal(receiptTitle(exchanged, A), 'Your swap confirmed.');
  assert.equal(receiptTitle(exchanged, null), 'Settlement confirmed.');
  assert.equal(receiptTitle(exchanged, `0x${'c'.repeat(40)}`), 'Settlement confirmed.');
  const proposal = { intents: participants, legs: participants.map((row, i) => ({ ...row, intentHash: i ? otherHash : hash })) } as unknown as SettlementProposal;
  assert.equal(proposalForWallet(proposal, A, hash), true);
  assert.equal(proposalForWallet(proposal, A, otherHash), false);
  assert.equal(proposalForWallet(proposal, B, hash), false);
});

test('receipt grouping preserves the signed net sum across one owner multiple requests', () => {
  const grouped = receiptOutcomes({ ...receipt, participants: receipt.participants.map((row, i) => ({ ...row, netPayment: i ? '-30' : '80' })) });
  assert.equal(grouped[0].netPayment, '50');
});
