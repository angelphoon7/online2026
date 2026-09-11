import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeErrorResult } from 'viem';
import { hashIntent, validateSettlement } from '../solver/dist/index.js';
import { decodeRejection, inspectAttack, restoreProposal, simulateProposal } from './lib/act-three-proof.mjs';
import abis from '../server/abis.json' with { type: 'json' };

const address = n => `0x${n.toString(16).padStart(40, '0')}`;
function fixture() {
  const intents = [1, 2, 3].map((n, i) => ({ owner: address(n), offered: i === 1 ? [0n, 1n, 2n, 3n] : [], eventId: 1,
    sessionMask: 1n, sectionMask: 1n, exactCount: i === 1 ? 0 : 2, mustShareSession: i !== 1, mustShareSection: i !== 1,
    mustBeAdjacent: i !== 1, maxNetPay: i === 1 ? -200000n : 100000n, deadline: 9999999999n, nonce: 0n }));
  const valid = { intents, legs: intents.map((i, index) => ({ intentHash: hashIntent(i), receives: [[0n, 1n], [], [2n, 3n]][index], netPayment: i.maxNetPay })) };
  const malicious = structuredClone(valid);
  malicious.legs[0].receives = [0n, 2n]; malicious.legs[2].receives = [1n, 3n];
  const state = { ticketMeta: new Map(), depositor: new Map(), intentState: new Map(), usdcBalance: new Map(), usdcAllowance: new Map(), blockTimestamp: 1n };
  intents.forEach(intent => {
    state.intentState.set(hashIntent(intent), 1); state.usdcBalance.set(intent.owner, 1000000n); state.usdcAllowance.set(intent.owner, 1000000n);
    intent.offered.forEach((id, j) => { state.depositor.set(id, intent.owner); state.ticketMeta.set(id, { eventId: 1, sessionId: 0, sectionId: 0, row: 4, seat: j + 1, status: 0 }); });
  });
  return { valid, malicious, state };
}
test('the unchanged signed intents and payments accept adjacent pairs but reject only adjacency in the malicious allocation', () => {
  const { valid, malicious, state } = fixture();
  assert.equal(validateSettlement(valid.intents, valid.legs, state), null);
  const failure = validateSettlement(malicious.intents, malicious.legs, state);
  assert.equal(failure.check, 'V5'); assert.equal(failure.error, 'SeatsNotAdjacent');
  assert.equal(inspectAttack(valid, malicious).targetIntentHash, valid.legs[0].intentHash);
});
test('attack evidence refuses modified signed conditions, changed payment and missing tickets', () => {
  for (const mutate of [p => { p.intents[0].mustBeAdjacent = false; }, p => { p.legs[0].netPayment = 0n; }, p => { p.legs[0].receives = [0n, 1n]; }]) {
    const f = fixture(); mutate(f.malicious); assert.throws(() => inspectAttack(f.valid, f.malicious));
  }
});
test('error name and intent hash are decoded from returned EVM bytes', () => {
  const f = fixture(); const target = f.valid.legs[0].intentHash;
  const raw = encodeErrorResult({ abi: abis.Settlement, errorName: 'SeatsNotAdjacent', args: [target] });
  const decoded = decodeRejection(raw);
  assert.equal(decoded.errorName, 'SeatsNotAdjacent'); assert.equal(decoded.args[0], target); assert.equal(decoded.rawData, raw);
  assert.throws(() => decodeRejection('0x'));
});
test('transport failures are never shown as SeatsNotAdjacent and other named errors retain their identity', async () => {
  const f = fixture(); const deployment = { contracts: { Settlement: address(10) } };
  const brokenClient = { simulateContract: async () => { throw new Error('RPC unavailable'); } };
  await assert.rejects(() => simulateProposal(brokenClient, deployment, f.malicious, address(4), 1n), /did not return decodable/);
  const raw = encodeErrorResult({ abi: abis.Settlement, errorName: 'IntentNotLive', args: [f.valid.legs[0].intentHash] });
  const rejectedClient = { simulateContract: async () => { throw { walk: () => ({ raw }) }; } };
  assert.equal((await simulateProposal(rejectedClient, deployment, f.malicious, address(4), 1n)).rejection.errorName, 'IntentNotLive');
});
test('public JSON proposal restores the exact bigint values and the same attack hash', () => {
  const f = fixture();
  const serialized = JSON.parse(JSON.stringify(f.malicious, (_, v) => typeof v === 'bigint' ? String(v) : v));
  assert.deepEqual(restoreProposal(serialized), f.malicious);
  assert.equal(inspectAttack(f.valid, serialized).targetIntentHash, f.valid.legs[0].intentHash);
});
