import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi, erc721Abi, type Address, type Hex } from 'viem';
import { confirmedReceiptPayments } from '../receipt-payments';
import { settlementReceipt } from '../receipt';
import { abi, chainConfig } from '../chain';

const A = `0x${'1'.repeat(40)}` as Address, B = `0x${'2'.repeat(40)}` as Address;
const C = `0x${'3'.repeat(40)}` as Address, D = `0x${'4'.repeat(40)}` as Address;
const S = `0x${'5'.repeat(40)}` as Address;
const transfer = (from: Address, to: Address, value: bigint) => ({ from, to, value });
const pair = (amount: bigint) => [{ owner: A, netPayment: amount }, { owner: B, netPayment: -amount }];

test('a 0.06 USDC payment is counted once despite two routing transfers', () => {
  const result = confirmedReceiptPayments(pair(60_000n), [transfer(A, S, 60_000n), transfer(S, B, 60_000n)], S);
  assert.equal(result.totalTransferred, '60000');
  assert.deepEqual(result.wallets, [{ owner: A, paid: '60000', received: '0' }, { owner: B, paid: '0', received: '60000' }]);
});

test('multiple payers and receivers produce the total paid, not a zero net sum', () => {
  const legs = [A, B, C, D].map((owner, i) => ({ owner, netPayment: [100n, 50n, -120n, -30n][i] }));
  const result = confirmedReceiptPayments(legs, [transfer(A, S, 100n), transfer(B, S, 50n), transfer(S, C, 120n), transfer(S, D, 30n)], S);
  assert.equal(result.totalTransferred, '150');
  assert.deepEqual(result.wallets.map(row => [row.paid, row.received]), [['100', '0'], ['50', '0'], ['0', '120'], ['0', '30']]);
});

test('multiple intents for one wallet use the net amount actually pulled', () => {
  const result = confirmedReceiptPayments([{ owner: A, netPayment: 80n }, { owner: A, netPayment: -30n }, { owner: B, netPayment: -50n }],
    [transfer(A, S, 50n), transfer(S, B, 50n)], S);
  assert.equal(result.totalTransferred, '50');
  assert.equal(result.wallets.length, 2);
});

test('zero-payment swaps remain zero regardless of an approved spending allowance', () => {
  const result = confirmedReceiptPayments(pair(0n), [], S);
  assert.equal(result.totalTransferred, '0');
  assert.ok(result.wallets.every(row => row.paid === '0' && row.received === '0'));
});

test('receipt totals retain precision above the safe integer limit', () => {
  const amount = 9_007_199_254_740_993n;
  assert.equal(confirmedReceiptPayments(pair(amount), [transfer(A, S, amount), transfer(S, B, amount)], S).totalTransferred, amount.toString());
});

test('missing payment logs and even one micro-USDC mismatch cannot show payment confirmed', () => {
  assert.throws(() => confirmedReceiptPayments(pair(60_000n), [], S), /do not match/);
  assert.throws(() => confirmedReceiptPayments(pair(60_000n), [transfer(A, S, 60_000n), transfer(S, B, 59_999n)], S), /do not match/);
});

test('a credit sent to the wrong participant or an unknown wallet is rejected', () => {
  assert.throws(() => confirmedReceiptPayments([...pair(60_000n), { owner: C, netPayment: 0n }], [transfer(A, S, 60_000n), transfer(S, C, 60_000n)], S), /do not match/);
  assert.throws(() => confirmedReceiptPayments(pair(60_000n), [transfer(A, S, 60_000n), transfer(S, C, 60_000n)], S), /outside this settlement/);
});

test('self-transfers and transfers outside settlement cannot inflate its total', () => {
  assert.throws(() => confirmedReceiptPayments(pair(0n), [transfer(S, S, 60_000n)], S), /Invalid settlement USDC transfer route/);
  assert.throws(() => confirmedReceiptPayments(pair(0n), [transfer(A, B, 60_000n)], S), /Invalid settlement USDC transfer route/);
});

test('the receipt endpoint decodes and reconciles real ERC-20 log amounts, ignoring other token transfers', async t => {
  const { addresses, usdc } = chainConfig();
  const txHash = `0x${'6'.repeat(64)}` as Hex, blockHash = `0x${'7'.repeat(64)}` as Hex;
  const intents = [A, B].map((owner, i) => ({ owner, offered: [BigInt(i + 1)], eventId: 1, sessionMask: 1n, sectionMask: 1n,
    exactCount: 1, mustShareSession: false, mustShareSection: false, mustBeAdjacent: false,
    maxNetPay: i ? -60_000n : 60_000n, deadline: 2_000_000_000n, nonce: 1n }));
  const hashes = [`0x${'8'.repeat(64)}`, `0x${'9'.repeat(64)}`] as Hex[];
  const legs = intents.map((_, i) => ({ intentHash: hashes[i], receives: [BigInt(2 - i)], netPayment: i ? -60_000n : 60_000n }));
  const input = encodeFunctionData({ abi: abi('Settlement'), functionName: 'settle', args: [intents, legs] });
  const logs = [
    ...intents.map((intent, i) => ({ address: addresses.TicketNFT,
      topics: encodeEventTopics({ abi: erc721Abi, eventName: 'Transfer', args: { from: addresses.Escrow, to: intent.owner, tokenId: legs[i].receives[0] } }), data: '0x' })),
    ...[[A, addresses.Settlement], [addresses.Settlement, B]].map(([from, to]) => ({ address: usdc,
      topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from, to } }), data: encodeAbiParameters([{ type: 'uint256' }], [60_000n]) })),
    { address: C, topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: A, to: addresses.Settlement } }), data: encodeAbiParameters([{ type: 'uint256' }], [999_000_000n]) },
    { address: addresses.Settlement, topics: encodeEventTopics({ abi: abi('Settlement'), eventName: 'Settled', args: { proposer: A } }),
      data: encodeAbiParameters([{ type: 'bytes32[]' }, { type: 'uint256' }], [hashes, 2n]) },
  ].map((log, i) => ({ ...log, transactionHash: txHash, transactionIndex: '0x0', blockNumber: '0x100', blockHash, logIndex: `0x${i.toString(16)}`, removed: false }));
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const ok = (result: unknown) => Response.json({ jsonrpc: '2.0', id: body.id, result });
    if (body.method === 'eth_chainId') return ok('0x4cef52');
    if (body.method === 'eth_getTransactionByHash') return ok({ hash: txHash, blockNumber: '0x100', blockHash, transactionIndex: '0x0', from: A,
      to: addresses.Settlement, input, gas: '0x100000', value: '0x0', nonce: '0x1', gasPrice: '0x1', type: '0x0' });
    assert.equal(body.method, 'eth_getTransactionReceipt');
    return ok({ transactionHash: txHash, blockNumber: '0x100', blockHash, transactionIndex: '0x0', from: A, to: addresses.Settlement,
      contractAddress: null, status: '0x1', gasUsed: '0x10000', cumulativeGasUsed: '0x10000', effectiveGasPrice: '0x1', logsBloom: `0x${'00'.repeat(256)}`, type: '0x0', logs });
  });
  const result = await settlementReceipt(txHash);
  assert.equal(result.usdcTransfers, 2);
  assert.equal(result.payments?.totalTransferred, '60000');
  assert.deepEqual(result.payments?.wallets, [{ owner: A, paid: '60000', received: '0' }, { owner: B, paid: '0', received: '60000' }]);
});
