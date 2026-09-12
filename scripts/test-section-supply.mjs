import assert from 'node:assert/strict';
import { sectionSupply } from '../lib/section-supply.ts';

const owner = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const escrow = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const zero = '0x0000000000000000000000000000000000000000';
const ticket = (id, patch = {}) => ({ tokenId: String(id), eventId: 1, sessionId: 0, sectionId: 0, status: 0, owner: escrow, depositor: owner, ...patch });
const intent = (ids, patch = {}) => ({ offered: ids.map(String), eventId: 1, owner, state: 1, expired: false, deadline: '200', ...patch });
const snapshot = {
  timestamp: '100',
  tickets: [ticket(1), ticket(2), ticket(3), ticket(4, { owner, depositor: zero }), ticket(5, { sessionId: 1 }), ticket(6, { sectionId: 1 }), ticket(7, { eventId: 2 })],
  intents: [intent([1, 2]), intent([1, 2]), intent([5, 6]), intent([7], { eventId: 2 })],
};
const count = (data = snapshot, session = 0, section = 0) => sectionSupply(data, 1, session, escrow).get(section);
assert.deepEqual(count(), { issued: 4, deposited: 3, offered: 2 });
assert.deepEqual(count(snapshot, 1), { issued: 1, deposited: 1, offered: 1 });
assert.deepEqual(count(snapshot, 0, 1), { issued: 1, deposited: 1, offered: 1 });
assert.equal(sectionSupply(snapshot, 1, null, escrow).size, 0);
assert.equal(count(snapshot, 0, 3), undefined);
for (const patch of [{ state: 2 }, { state: 3 }, { expired: true }, { deadline: '99' }, { owner: other }, { eventId: 2 }]) {
  assert.equal(count({ ...snapshot, intents: [intent([1, 2], patch)] }).offered, 0);
}
// A live registry entry alone is insufficient: losing one offered ticket
// makes the remaining bundle unavailable, including tickets in another section.
for (const patch of [{ owner, depositor: zero }, { status: 1 }, { depositor: other }, { eventId: 2 }, { owner: other }]) {
  const tickets = snapshot.tickets.map(t => t.tokenId === '2' ? { ...t, ...patch } : t);
  assert.equal(count({ ...snapshot, tickets }).offered, 0);
}
assert.equal(count({ ...snapshot, intents: [intent([1, 99])] }).offered, 0);
assert.equal(count({ ...snapshot, intents: [intent([1, 2], { deadline: '100', owner: owner.toUpperCase() })] }).offered, 2);
assert.equal(count({ ...snapshot, intents: [] }).offered, 0);
assert.equal(count({ ...snapshot, intents: [] }).deposited, 3);
console.log('PASS section supply: unique live offers, custody of whole bundle, revoked/settled/expired intents, redemption, event/night/section isolation, and deposited-but-uncommitted tickets.');
