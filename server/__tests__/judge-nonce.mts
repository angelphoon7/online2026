import test from 'node:test';
import assert from 'node:assert/strict';
import { nextJudgeNonce } from '../judge-nonce.js';

const owner = `0x${'a'.repeat(40)}` as const;
test('old intent edit starts above this owner\'s indexed nonces, not another owner\'s', async () => {
  const reads: bigint[] = [];
  const nonce = await nextJudgeNonce({ owner, nonce: 15n }, [{ owner, nonce: 78n }, { owner: `0x${'b'.repeat(40)}`, nonce: 900n }], async n => { reads.push(n); return false; });
  assert.equal(nonce, 79n);
  assert.deepEqual(reads, [79n]);
});
test('registry reservations override the indexed hint, including closed commitments', async () => {
  const reads: bigint[] = [];
  const nonce = await nextJudgeNonce({ owner, nonce: 15n }, [], async n => { reads.push(n); return n < 18n; });
  assert.equal(nonce, 18n);
  assert.deepEqual(reads, [16n, 17n, 18n]);
});
test('nonce lookup failures and exhaustion stop before any signature or transaction', async () => {
  const failure = new Error('RPC unavailable');
  await assert.rejects(nextJudgeNonce({ owner, nonce: 0n }, [], async () => { throw failure; }), error => error === failure);
  let count = 0;
  await assert.rejects(nextJudgeNonce({ owner, nonce: 0n }, [], async () => { count++; return true; }), /No unused intent nonce found within 64 registry checks/);
  assert.equal(count, 64);
});
