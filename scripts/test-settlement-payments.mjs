import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { decodeFunctionData } from 'viem';
import { settlementPayments } from '../lib/settlement-payments.ts';
import { formatUSDC } from '../lib/format.ts';

test('displays wallet changes for two payers and two receivers, with an exact zero sum', () => {
  const result = settlementPayments([100n, 50n, -120n, -30n].map((amount, index) => ({
    owner: `0x${index}`, netPayment: amount * 1_000_000n,
  })));
  assert.deepEqual(result.rows.map(row => formatUSDC(row.amount)), ['-100', '-50', '120', '30']);
  assert.equal(result.paid, 150_000_000n);
  assert.equal(result.received, 150_000_000n);
  assert.equal(result.total, 0n);
  assert.equal(result.balanced, true);
});

test('nets multiple intents from the same wallet before reporting actual cash paid', () => {
  const result = settlementPayments([
    { owner: '0xAbCd', netPayment: 80_000_000n },
    { owner: '0xabcd', netPayment: -30_000_000n },
    { owner: '0x1234', netPayment: -50_000_000n },
  ]);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].amount, -50_000_000n);
  assert.equal(result.paid, 50_000_000n);
  assert.equal(result.received, 50_000_000n);
  assert.equal(result.balanced, true);
});

test('keeps micro-USDC precision above the JavaScript safe integer limit', () => {
  const amount = 9_007_199_254_740_993n;
  const result = settlementPayments([{ owner: 'payer', netPayment: amount }, { owner: 'receiver', netPayment: -amount }]);
  assert.equal(formatUSDC(result.rows[0].amount), '-9007199254.740993');
  assert.equal(result.total, 0n);
});

test('does not label even a one-micro-USDC imbalance as balanced', () => {
  const result = settlementPayments([{ owner: 'payer', netPayment: 100_001n }, { owner: 'receiver', netPayment: -100_000n }]);
  assert.equal(result.balanced, false);
  assert.equal(formatUSDC(result.total), '-0.000001');
});

test('retains wallets with no cash payment but does not mark missing data as balanced', () => {
  assert.equal(settlementPayments([]).balanced, false);
  const result = settlementPayments([{ owner: 'a', netPayment: 0n }, { owner: 'b', netPayment: 0n }]);
  assert.equal(result.rows.length, 2);
  assert.equal(result.paid, 0n);
  assert.equal(result.balanced, true);
});

test('reconciles all ten saved confirmed settlements against their transaction calldata', () => {
  const abis = JSON.parse(readFileSync(new URL('../server/abis.json', import.meta.url), 'utf8'));
  for (let round = 1; round <= 10; round++) {
    const record = JSON.parse(readFileSync(new URL(`../deployments/settlements/${String(round).padStart(2, '0')}.json`, import.meta.url), 'utf8'));
    assert.equal(record.receipt.confirmed, true);
    const decoded = decodeFunctionData({ abi: abis.Settlement, data: record.transaction.data });
    assert.equal(decoded.functionName, 'settle');
    const [intents, legs] = decoded.args;
    const actual = settlementPayments(legs.map((leg, index) => ({ owner: intents[index].owner, netPayment: leg.netPayment })));
    const displayed = settlementPayments(record.proposal.legs.map((leg, index) => ({ owner: record.proposal.intents[index].owner, netPayment: BigInt(leg.netPayment) })));
    assert.deepEqual(displayed, actual);
    assert.equal(displayed.balanced, true);
    assert.equal(displayed.paid, 100_000n);
    assert.equal(displayed.received, 100_000n);
  }
});
