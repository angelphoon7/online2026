import assert from 'node:assert/strict';
import { automaticSelection, latestRequest, matchingStatus } from '../lib/matching-status.ts';

const owner = '0x1111111111111111111111111111111111111111';
const hash = n => `0x${n.toString(16).padStart(64, '0')}`;
const intents = Array.from({ length: 6 }, (_, n) => ({ hash: hash(n), owner: n === 5 ? owner : '0x2222222222222222222222222222222222222222', nonce: String(n), eventId: 1, state: 1, expired: false }));
const market = { intents, defaultHashes: [hash(0), hash(1), hash(2)] };
assert.deepEqual(automaticSelection(market), intents.map(i => i.hash));
assert.deepEqual(automaticSelection({ ...market, defaultHashes: [] }), intents.map(i => i.hash));
assert.equal(latestRequest({ ...market, intents: [...intents, { ...intents[5], nonce: '10', hash: hash(10) }] }, owner).nonce, '10');
const request = intents[5], selected = [request.hash, hash(0)];
const result = (patch = {}, proposal = null, evidence = null) => matchingStatus({ ...request, ...patch }, selected, false, '', proposal, evidence).title;
const successful = { simulationResult: { success: true } };
assert.equal(result(), 'Waiting for a match');
assert.equal(result({}, { legs: [{ intentHash: hash(0) }] }, successful), 'Waiting for a match');
assert.equal(result({}, { legs: [{ intentHash: request.hash }] }, { simulationResult: { success: false } }), 'Waiting for a match');
assert.equal(result({}, { legs: [{ intentHash: request.hash }] }, successful), 'Match found - awaiting settlement');
assert.equal(result({ state: 3 }), 'Swap confirmed');
assert.equal(result({ state: 2 }), 'Request revoked');
assert.equal(result({ expired: true }), 'Request expired');
assert.equal(matchingStatus(request, selected, false, 'RPC failed', null, null).title, 'Matching temporarily unavailable');
assert.equal(matchingStatus(request, [hash(0)], false, '', null, null).title, 'Your request is outside this search');
for (const patch of [{ state: 2 }, { state: 3 }, { expired: true }]) {
  assert.deepEqual(automaticSelection({ ...market, intents: [...intents.slice(0, 5), { ...request, ...patch }] }), intents.slice(0, 5).map(i => i.hash));
}
console.log('PASS automatic selection includes every live event intent beyond four and continues after a personal request ends; only its on-chain settled state means success.');
