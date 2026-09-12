// Hypothetical-mode tests — plan 6-C, and the contract step 7's what_if depends on.
//
// Run with:  npx tsx --conditions=react-server --test server/__tests__/solve-hypothetical.mts
// The condition makes `server-only` resolve to its empty module, the same way Next resolves it
// on the server. Without it the import throws before any test runs.
//
// Capacity is injected, so these tests touch no RPC and are deterministic.

import test from 'node:test';
import assert from 'node:assert/strict';
import { solveHypothetical } from '../solve-hypothetical';
import { hashIntent } from '../../shared/intent';
import type { Intent, Address, Hex } from '../../shared/intent';
import type { Snapshot } from '../../shared/graph';

const A = '0xaaaa000000000000000000000000000000000001' as Address;
const B = '0xbbbb000000000000000000000000000000000002' as Address;
const C = '0xcccc000000000000000000000000000000000003' as Address;
const D = '0xdddd000000000000000000000000000000000004' as Address;
const NOW = 1789173368n;
const USDC = 1_000_000n;

// Section 0 is bit 0, section 1 is bit 1; session 1 is bit 1. Masks are bit positions, not ids.
const SECTION_0 = 1n;
const SECTION_1 = 2n;
const SESSION_1 = 2n;

const intent = (over: Partial<Intent> & { owner: Address }): Intent => ({
  offered: [],
  eventId: 1,
  sessionMask: SESSION_1,
  sectionMask: SECTION_0,
  exactCount: 1,
  mustShareSession: false,
  mustShareSection: false,
  mustBeAdjacent: false,
  maxNetPay: 0n,
  deadline: NOW + 10_000n,
  nonce: 1n,
  ...over,
});

const live = (i: Intent) => ({ ...i, hash: hashIntent(i), committedTx: '0xtx', committedAtBlock: 100n });

const meta = (sectionId: number, seat: number) => ({ eventId: 1, sessionId: 1, sectionId, row: 1, seat, status: 0 });

/** A offers a section-0 seat and wants a section-1 seat; B wants section 0 and must be paid 10. */
const aOffers = intent({ owner: A, offered: [1n], sectionMask: SECTION_1, maxNetPay: 0n });
const bOffers = intent({ owner: B, offered: [2n], sectionMask: SECTION_0, maxNetPay: -10n * USDC });

function snapshot(intents: Intent[], tickets: [bigint, number, number, Address][]): Snapshot {
  return {
    block: 61_000_000n,
    timestamp: NOW,
    deployment: 'QmTest',
    intents: intents.map(live),
    ticketMeta: new Map(tickets.map(([id, section, seat]) => [id, meta(section, seat)])),
    depositor: new Map(tickets.map(([id, , , owner]) => [id, owner])),
    excluded: [],
  };
}

const capacity = (owners: Address[]) => ({
  block: 61_000_000n,
  usdcBalance: new Map(owners.map((o) => [o, 1000n * USDC])),
  usdcAllowance: new Map(owners.map((o) => [o, 1000n * USDC])),
});

test('a hypothetical result is never submittable', async () => {
  const snap = snapshot([aOffers, bOffers], [[1n, 0, 1, A], [2n, 1, 1, B]]);
  const result = await solveHypothetical(
    snap,
    { replaceHash: hashIntent(aOffers), intent: { ...aOffers, maxNetPay: 10n * USDC } },
    capacity([A, B])
  );

  assert.equal(result.submittable, false);
  // Structural, not stylistic: there is no proposal, no calldata and no simulation anywhere in
  // this shape, so there is nothing a settle path could pick up even by mistake.
  for (const key of ['proposal', 'transaction', 'intents', 'legs', 'simulationResult']) {
    assert.ok(!(key in result), `hypothetical result must not carry ${key}`);
  }
  assert.equal(result.snapshotBlock, '61000000');
});

test('raising the budget unlocks a settlement that the committed intent cannot reach', async () => {
  const snap = snapshot([aOffers, bOffers], [[1n, 0, 1, A], [2n, 1, 1, B]]);
  const replaceHash = hashIntent(aOffers) as Hex;

  // The committed conditions, restated as a hypothetical: A pays nothing, B must receive 10.
  // V7 forces the payments to sum to zero, so there is no reshuffle here.
  const unchanged = await solveHypothetical(snap, { replaceHash, intent: aOffers }, capacity([A, B]));
  assert.equal(unchanged.found, false, 'the committed budget must not settle');
  assert.equal(unchanged.targetNetPay, null);

  const raised = await solveHypothetical(
    snap,
    { replaceHash, intent: { ...aOffers, maxNetPay: 10n * USDC } },
    capacity([A, B])
  );
  assert.equal(raised.found, true, 'raising the budget to 10 USDC must settle');
  assert.deepEqual(raised.counterparties, [B]);
  assert.equal(raised.participantCount, 2);
  // Signed, in contract units: A pays exactly what B's floor requires, not the new ceiling.
  assert.equal(raised.targetNetPay, (10n * USDC).toString());
  assert.deepEqual(raised.receives, ['2']);
});

test('a settlement that excludes the hypothetical is not reported as found', async () => {
  // C and D can swap with each other at zero payment. The hypothetical A wants a section that
  // does not exist in the pool, so nothing that includes A can settle - and a C+D reshuffle
  // says nothing about A.
  const cOffers = intent({ owner: C, offered: [3n], sectionMask: SECTION_1 });
  const dOffers = intent({ owner: D, offered: [4n], sectionMask: SECTION_0 });
  const snap = snapshot(
    [aOffers, cOffers, dOffers],
    [[1n, 0, 1, A], [3n, 0, 2, C], [4n, 1, 2, D]]
  );

  const result = await solveHypothetical(
    snap,
    { replaceHash: hashIntent(aOffers), intent: { ...aOffers, sectionMask: 1n << 5n } },
    capacity([A, C, D])
  );

  assert.equal(result.found, false);
  assert.deepEqual(result.counterparties, []);
  assert.equal(result.participantCount, null);
  assert.equal(result.targetNetPay, null);
  // The C+D reshuffle is not counted, because the search never enumerates a subset without
  // the asker. Spending the bound on other people's reshuffles is what made "no settlement
  // found" the answer for almost every intent in a real pool; the question asked here is
  // whether THIS participant can settle, and only candidates including them can answer it.
  assert.equal(result.candidatesFound, 0, 'candidates are counted only if they include the asker');
});

test('payment capacity is enforced, so a relaxation cannot promise what V8 would reject', async () => {
  const snap = snapshot([aOffers, bOffers], [[1n, 0, 1, A], [2n, 1, 1, B]]);
  const broke = {
    block: snap.block,
    usdcBalance: new Map([[A, 1n * USDC], [B, 1000n * USDC]]),
    usdcAllowance: new Map([[A, 1000n * USDC], [B, 1000n * USDC]]),
  };
  const result = await solveHypothetical(
    snap,
    { replaceHash: hashIntent(aOffers), intent: { ...aOffers, maxNetPay: 10n * USDC } },
    broke
  );
  assert.equal(result.found, false, 'A cannot pay 10 USDC holding 1');
});
