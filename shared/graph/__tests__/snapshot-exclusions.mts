// Snapshot exclusion paths - step 9 of docs/RESHUFFLE_GRAPH_PLAN.md.
//
// Run with:  npx --yes tsx --conditions=react-server --test shared/graph/__tests__/snapshot-exclusions.mts
//
// Each case asserts the NAMED exclusion reason, not merely that something was excluded. These
// reasons mirror the contract's own checks (V1-V3) and become the agent's diagnosis, so a case
// that passed for the wrong reason would put a wrong explanation in front of a user - and be
// indistinguishable from one that passed correctly.
//
// Every case goes through the real getPoolSnapshot with fetch stubbed, so the hash binding and
// the signed-integer conversion are exercised, not bypassed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { getPoolSnapshot } from '../snapshot';
import { hashIntent } from '../../intent';
import type { ExclusionReason } from '../snapshot';

const OWNER = '0xa8dae73bde3a5c0e412884c9be2039a79dfb31fd';
const OTHER = '0x8c3345e88cb68f16dc31f88ee21b2032a5250e90';
const NOW = 1789173368n;

type GraphIntentBody = Record<string, unknown> & { id: string };

/** A committed intent as the subgraph returns it, with a genuinely matching hash. */
function makeIntent(over: Record<string, unknown> = {}): GraphIntentBody {
  const base = {
    owner: OWNER, offered: ['1', '2'], eventId: 1,
    sessionMask: '2', sectionMask: '1', exactCount: 2,
    mustShareSession: true, mustShareSection: true, mustBeAdjacent: true,
    maxNetPay: '100000', deadline: String(NOW + 10000n), nonce: '7',
    ...over,
  };
  const id = hashIntent({
    owner: base.owner as `0x${string}`, offered: base.offered.map(BigInt), eventId: Number(base.eventId),
    sessionMask: BigInt(base.sessionMask), sectionMask: BigInt(base.sectionMask), exactCount: Number(base.exactCount),
    mustShareSession: base.mustShareSession, mustShareSection: base.mustShareSection,
    mustBeAdjacent: base.mustBeAdjacent, maxNetPay: BigInt(base.maxNetPay),
    deadline: BigInt(base.deadline), nonce: BigInt(base.nonce),
  });
  return { ...base, id, committedAtBlock: '100', committedTx: '0xtx' };
}

const ticket = (id: string, over = {}) => ({ id, escrowed: true, depositor: OWNER, redeemed: false, ...over });
const universe = (over = {}) =>
  ['1', '2'].map(id => ({ id, eventId: 1, sessionId: 1, sectionId: 0, row: 1, seat: Number(id), depositor: OWNER, redeemed: false, ...over }));

type Outcome = { kept: number; reason?: ExclusionReason; detail?: string; id?: string };

async function parse(intent: GraphIntentBody, offeredTickets: unknown[], tickets = universe()): Promise<Outcome> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: {
    _meta: { block: { number: 999, timestamp: String(NOW) }, hasIndexingErrors: false, deployment: 'Qm' },
    intents: [{ ...intent, offeredTickets }],
    tickets,
  }}), { headers: { 'content-type': 'application/json' } })) as typeof fetch;
  try {
    const snapshot = await getPoolSnapshot({ url: 'http://stub.invalid/graphql' });
    const excluded = snapshot.excluded[0];
    return { kept: snapshot.intents.length, reason: excluded?.reason, detail: excluded?.detail, id: excluded?.id };
  } finally {
    globalThis.fetch = original;
  }
}

const good = makeIntent();

test('a valid intent is kept and nothing is excluded', async () => {
  const result = await parse(good, [ticket('1'), ticket('2')]);
  assert.equal(result.kept, 1);
  assert.equal(result.reason, undefined);
});

test('HASH_MISMATCH: one altered field means the intent was never signed as presented', async () => {
  // Trust rule 1. maxNetPay is altered while the published id is left alone - the shape a
  // mapping bug or a tampering indexer would produce.
  const result = await parse({ ...good, maxNetPay: '999999' }, [ticket('1'), ticket('2')]);
  assert.equal(result.kept, 0);
  assert.equal(result.reason, 'HASH_MISMATCH');
  assert.equal(result.id?.toLowerCase(), good.id.toLowerCase());
});

test('EXPIRED: a passed deadline is a rejection, mirroring V1', async () => {
  const result = await parse(makeIntent({ deadline: String(NOW - 1n) }), [ticket('1'), ticket('2')]);
  assert.equal(result.kept, 0);
  assert.equal(result.reason, 'EXPIRED');
});

test('deadline exactly at the block timestamp is not yet expired', async () => {
  // V1 checks that the deadline has passed, not that it has arrived. Off by one here would
  // silently drop an intent that the contract would still accept.
  const result = await parse(makeIntent({ deadline: String(NOW) }), [ticket('1'), ticket('2')]);
  assert.equal(result.kept, 1);
  assert.equal(result.reason, undefined);
});

test('TICKET_UNKNOWN: an offered id with no indexed ticket', async () => {
  const result = await parse(good, [ticket('1')]);
  assert.equal(result.kept, 0);
  assert.equal(result.reason, 'TICKET_UNKNOWN');
});

test('TICKET_REDEEMED: a redeemed offered ticket, mirroring V3', async () => {
  const result = await parse(good, [ticket('1'), ticket('2', { redeemed: true })]);
  assert.equal(result.kept, 0);
  assert.equal(result.reason, 'TICKET_REDEEMED');
  assert.equal(result.detail, 'ticket 2', 'the offending ticket must be named');
});

test('TICKET_NOT_IN_ESCROW: a withdrawn ticket, mirroring V2', async () => {
  // Withdrawing tickets does not revoke the intents referencing them; this is the check that
  // catches it before the solver wastes a proposal on it.
  const result = await parse(good, [ticket('1'), ticket('2', { escrowed: false, depositor: null })]);
  assert.equal(result.kept, 0);
  assert.equal(result.reason, 'TICKET_NOT_IN_ESCROW');
  assert.equal(result.detail, 'ticket 2 is not in escrow');
});

test('TICKET_NOT_IN_ESCROW: escrowed, but by somebody else', async () => {
  // V2 requires the offered ticket to be escrowed by THAT intent's owner. Escrowed-by-anyone
  // would let a participant offer a ticket they never held.
  const result = await parse(good, [ticket('1'), ticket('2', { depositor: OTHER })]);
  assert.equal(result.kept, 0);
  assert.equal(result.reason, 'TICKET_NOT_IN_ESCROW');
  // Naming both parties is what makes this actionable: the ticket is escrowed, just not by
  // the participant who offered it.
  assert.ok(result.detail?.includes(OTHER) && result.detail?.includes(OWNER), result.detail);
});

test('WRONG_EVENT: an offered ticket from another event, mirroring V2', async () => {
  // Clearing happens within one event, so eventId is the market, not just a desired outcome.
  const result = await parse(good, [ticket('1'), ticket('2')], universe({ eventId: 9 }));
  assert.equal(result.kept, 0);
  assert.equal(result.reason, 'WRONG_EVENT');
});
