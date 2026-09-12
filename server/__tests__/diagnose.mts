// Diagnosis and guard tests - step 9 of docs/RESHUFFLE_GRAPH_PLAN.md.
//
// Run with:  npx --yes tsx --conditions=react-server --test server/__tests__/diagnose.mts
//
// Every case asserts a NAMED result - which stage blocks, which relaxation worked, what the
// participant would pay - not merely that something non-empty came back. A diagnosis that is
// "not empty" is indistinguishable from a wrong one, and these are the tests that decide
// whether the agent's answers can be trusted.
//
// Payment capacity is injected, so no RPC is touched and the results are deterministic.

import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnose, smallestWorkingChange } from '../agent/diagnose';
import { renderEvidence } from '../agent/template';
import { guard, checkAnswer } from '../agent/guard';
import { poolOverview } from '../agent/overview';
import { whatIf, applyChanges, WhatIfError } from '../agent/what-if';
import { hashIntent } from '../../shared/intent';
import type { Intent, Address, Hex, TicketMeta } from '../../shared/intent';
import type { Snapshot } from '../../shared/graph';

const A = '0xaaaa000000000000000000000000000000000001' as Address;
const B = '0xbbbb000000000000000000000000000000000002' as Address;
const C = '0xcccc000000000000000000000000000000000003' as Address;
const NOW = 1789173368n;
const USDC = 1_000_000n;
const BLOCK = 61_000_000n;

// Masks index bit positions: session 1 is bit 1, section 0 is bit 0, section 1 is bit 1.
const SESSION_1 = 1n << 1n;
const SECTION_0 = 1n << 0n;
const SECTION_1 = 1n << 1n;

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

type Seat = { id: bigint; section: number; row: number; seat: number; owner: Address };

const meta = (s: Seat): TicketMeta => ({
  eventId: 1,
  sessionId: 1,
  sectionId: s.section,
  row: s.row,
  seat: s.seat,
  status: 0,
});

function snapshot(intents: Intent[], seats: Seat[]): Snapshot {
  return {
    block: BLOCK,
    timestamp: NOW,
    deployment: 'QmTest',
    intents: intents.map((i) => ({ ...i, hash: hashIntent(i), committedTx: `0xtx${hashIntent(i).slice(2, 10)}`, committedAtBlock: 100n })),
    ticketMeta: new Map(seats.map((s) => [s.id, meta(s)])),
    depositor: new Map(seats.map((s) => [s.id, s.owner])),
    excluded: [],
  };
}

const capacity = (owners: Address[]) => ({
  usdcBalance: new Map(owners.map((o) => [o, 1000n * USDC])),
  usdcAllowance: new Map(owners.map((o) => [o, 1000n * USDC])),
});
const funds = capacity([A, B, C]);

const relaxation = (evidence: Awaited<ReturnType<typeof diagnose>>, change: string) =>
  evidence.relaxations.find((r) => r.change === change);

// ---------------------------------------------------------------- budget blocked

test('budget blocked: supply and demand both pass, and raising the limit settles', async () => {
  // A will pay nothing; B must receive 10. V7 forces payments to sum to zero, so nothing
  // settles until A's limit moves.
  const a = intent({ owner: A, offered: [1n], sectionMask: SECTION_1, maxNetPay: 0n });
  const b = intent({ owner: B, offered: [2n], sectionMask: SECTION_0, maxNetPay: -10n * USDC });
  const snap = snapshot([a, b], [
    { id: 1n, section: 0, row: 1, seat: 1, owner: A },
    { id: 2n, section: 1, row: 1, seat: 1, owner: B },
  ]);

  const evidence = await diagnose(snap, hashIntent(a) as Hex, funds);

  assert.equal(evidence.status, 'NOT_FOUND_WITHIN_BOUND');
  assert.equal(evidence.block, '61000000');
  // Nothing is wrong with supply or demand - the tickets exist and someone wants A's ticket.
  assert.equal(evidence.supply?.blockedAt, null, 'the wanted ticket exists and can be grouped');
  assert.equal(evidence.supply?.largestGroup, 1);
  assert.deepEqual(evidence.demand?.unwanted, [], 'B accepts the ticket A offers');

  const budget = relaxation(evidence, 'maxNetPay->cap');
  assert.equal(budget?.found, true, 'raising the limit must produce a settlement');
  // Exactly B's floor, not the raised ceiling: the solver minimises gross cash moved.
  assert.equal(budget?.targetNetPay, (10n * USDC).toString());
  assert.deepEqual(budget?.counterparties, [B]);
  assert.equal(smallestWorkingChange(evidence)?.change, 'maxNetPay->cap');

  const sentence = renderEvidence(evidence);
  assert.match(sentence, /^At Arc Testnet block #61000000,/);
  assert.match(sentence, /no settlement was found within the search bound/);
  assert.match(sentence, /smallest change among those tried/);
});

// ---------------------------------------------------------------- adjacency blocked

test('adjacency blocked: the grouping stage is named, and dropping adjacency settles', async () => {
  // A wants two adjacent seats in section 1. Two are available there, but in different rows.
  const a = intent({
    owner: A,
    offered: [1n, 2n],
    sectionMask: SECTION_1,
    exactCount: 2,
    mustBeAdjacent: true,
    maxNetPay: 0n,
  });
  const b = intent({ owner: B, offered: [3n], sectionMask: SECTION_0, exactCount: 1 });
  const c = intent({ owner: C, offered: [4n], sectionMask: SECTION_0, exactCount: 1 });
  const snap = snapshot([a, b, c], [
    { id: 1n, section: 0, row: 1, seat: 1, owner: A },
    { id: 2n, section: 0, row: 1, seat: 2, owner: A },
    { id: 3n, section: 1, row: 1, seat: 1, owner: B },
    { id: 4n, section: 1, row: 5, seat: 9, owner: C },
  ]);

  const evidence = await diagnose(snap, hashIntent(a) as Hex, funds);

  assert.equal(evidence.status, 'NOT_FOUND_WITHIN_BOUND');
  // Both acceptable tickets survive every per-ticket filter; adjacency is what fails, and it
  // is a property of the group, so no stage reaches zero.
  assert.equal(evidence.supply?.stages.find((s) => s.stage === 'section')?.remaining, 2);
  assert.equal(evidence.supply?.firstZero, null);
  assert.equal(evidence.supply?.blockedAt, 'cohesiveGroup');
  assert.equal(evidence.supply?.largestGroup, 1, 'only one of the two seats can be taken adjacently');
  assert.equal(evidence.supply?.need, 2);

  assert.equal(relaxation(evidence, 'mustBeAdjacent=false')?.found, true);
  assert.match(renderEvidence(evidence), /grouping conditions is 1, and it asks for exactly 2/);
});

// ---------------------------------------------------------------- section blocked

test('section blocked: the funnel reaches zero at the section stage, and adding it settles', async () => {
  // A accepts section 0 only; the one ticket on offer is in section 1.
  const a = intent({ owner: A, offered: [1n], sectionMask: SECTION_0, maxNetPay: 0n });
  const b = intent({ owner: B, offered: [2n], sectionMask: SECTION_0, maxNetPay: 0n });
  const snap = snapshot([a, b], [
    { id: 1n, section: 0, row: 1, seat: 1, owner: A },
    { id: 2n, section: 1, row: 1, seat: 1, owner: B },
  ]);

  const evidence = await diagnose(snap, hashIntent(a) as Hex, funds);

  assert.equal(evidence.supply?.firstZero, 'section');
  assert.equal(evidence.supply?.blockedAt, 'section');
  assert.equal(evidence.supply?.stages.find((s) => s.stage === 'session')?.remaining, 1);
  assert.equal(relaxation(evidence, 'addSection=1')?.found, true, 'accepting section 1 must settle');
  assert.match(renderEvidence(evidence), /no offered ticket is in a section this intent accepts/);
});

// ---------------------------------------------------------------- demand side

test('nobody accepts the offered tickets: the answer says changing own conditions will not help', async () => {
  const a = intent({ owner: A, offered: [1n], sectionMask: SECTION_1 });
  // B holds what A wants but accepts only a section nobody has, so B will never take A's seat.
  const b = intent({ owner: B, offered: [2n], sectionMask: 1n << 5n });
  const snap = snapshot([a, b], [
    { id: 1n, section: 0, row: 1, seat: 1, owner: A },
    { id: 2n, section: 1, row: 1, seat: 1, owner: B },
  ]);

  const evidence = await diagnose(snap, hashIntent(a) as Hex, funds);

  assert.equal(evidence.status, 'NOT_FOUND_WITHIN_BOUND');
  assert.deepEqual(evidence.demand?.unwanted, ['1'], 'A ticket nobody accepts');
  assert.equal(evidence.demand?.perTicket[0].acceptingIntents, 0);
  assert.match(renderEvidence(evidence), /would not help/);
});

// ---------------------------------------------------------------- settleable

test('settleable: a reshuffle including this intent is found and reported as submittable', async () => {
  const a = intent({ owner: A, offered: [1n], sectionMask: SECTION_1, maxNetPay: 10n * USDC });
  const b = intent({ owner: B, offered: [2n], sectionMask: SECTION_0, maxNetPay: -10n * USDC });
  const snap = snapshot([a, b], [
    { id: 1n, section: 0, row: 1, seat: 1, owner: A },
    { id: 2n, section: 1, row: 1, seat: 1, owner: B },
  ]);

  const evidence = await diagnose(snap, hashIntent(a) as Hex, funds);

  assert.equal(evidence.status, 'SETTLEABLE');
  assert.equal(evidence.settleable?.participantCount, 2);
  assert.deepEqual(evidence.settleable?.counterparties, [B]);
  assert.deepEqual(evidence.settleable?.receives, ['2']);
  assert.equal(evidence.relaxations.length, 0, 'no counterfactuals are needed when it settles');
  assert.match(renderEvidence(evidence), /Propose and settle/);
});

// ---------------------------------------------------------------- excluded and closed

test('excluded: the snapshot reason is reported instead of a counterfactual', async () => {
  const a = intent({ owner: A, offered: [1n] });
  const snap = snapshot([], [{ id: 1n, section: 0, row: 1, seat: 1, owner: A }]);
  const hash = hashIntent(a) as Hex;
  snap.excluded = [{ id: hash, owner: A, reason: 'TICKET_NOT_IN_ESCROW', detail: '1' }];

  const evidence = await diagnose(snap, hash, funds);

  assert.equal(evidence.status, 'EXCLUDED');
  assert.equal(evidence.exclusion?.reason, 'TICKET_NOT_IN_ESCROW');
  assert.equal(evidence.exclusion?.detail, '1');
  assert.equal(evidence.relaxations.length, 0);
  assert.match(renderEvidence(evidence), /ticket #1 is no longer escrowed by its owner/);
});

test('revoked: status is CLOSED and the revoking transaction is named', async () => {
  const a = intent({ owner: A, offered: [1n] });
  const snap = snapshot([], []);
  const original = globalThis.fetch;
  // The registry lookup is a real GraphQL call; point it at a stub rather than Studio.
  process.env.SUBGRAPH_URL = 'http://stub.invalid/graphql';
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ data: { intent: { id: hashIntent(a), state: 'REVOKED', closedTx: '0xdead', closedAtBlock: '61000001' } } }),
      { headers: { 'content-type': 'application/json' } }
    )) as typeof fetch;
  try {
    const evidence = await diagnose(snap, hashIntent(a) as Hex, funds);
    assert.equal(evidence.status, 'CLOSED');
    assert.equal(evidence.closed?.state, 'REVOKED');
    assert.equal(evidence.closed?.tx, '0xdead');
    assert.match(renderEvidence(evidence), /revoked in transaction 0xdead/);
  } finally {
    globalThis.fetch = original;
  }
});

// ---------------------------------------------------------------- what-if

test('what_if is never submittable and validates the changes it accepts', async () => {
  const a = intent({ owner: A, offered: [1n], sectionMask: SECTION_1, maxNetPay: 0n });
  const b = intent({ owner: B, offered: [2n], sectionMask: SECTION_0, maxNetPay: -10n * USDC });
  const snap = snapshot([a, b], [
    { id: 1n, section: 0, row: 1, seat: 1, owner: A },
    { id: 2n, section: 1, row: 1, seat: 1, owner: B },
  ]);

  const result = await whatIf(snap, hashIntent(a) as Hex, { maxNetPayUsdc: 10 }, funds);
  assert.equal(result.submittable, false);
  assert.equal(result.found, true);
  assert.equal(result.targetNetPay, (10n * USDC).toString());
  assert.ok(!('proposal' in result) && !('transaction' in result), 'nothing submittable may appear in the shape');

  // A negative signed limit must survive the USDC conversion with its sign intact.
  assert.equal(applyChanges({ ...a }, { maxNetPayUsdc: -12.5 }).maxNetPay, -12_500_000n);

  // Adjacency below two tickets is rejected at commit, so the hypothetical refuses it too
  // rather than answering about an intent nobody could sign.
  assert.throws(() => applyChanges({ ...a }, { mustBeAdjacent: true }), WhatIfError);
});

// ---------------------------------------------------------------- overview

test('pool overview counts the pinned block, including pure sellers and buyers', () => {
  const seller = intent({ owner: A, offered: [1n], exactCount: 0 });
  const buyer = intent({ owner: B, offered: [], sectionMask: SECTION_0 });
  const snap = snapshot([seller, buyer], [
    { id: 1n, section: 0, row: 1, seat: 1, owner: A },
    { id: 2n, section: 1, row: 1, seat: 1, owner: B },
  ]);

  const overview = poolOverview(snap);
  assert.equal(overview.block, '61000000');
  assert.equal(overview.liveIntents, 2);
  assert.equal(overview.escrowedTickets, 2);
  assert.equal(overview.pureSellers, 1, 'exactCount 0 is valid - a pure seller');
  assert.equal(overview.pureBuyers, 1);
  assert.deepEqual(overview.bySection, [{ sectionId: 0, tickets: 1 }, { sectionId: 1, tickets: 1 }]);
});

// ---------------------------------------------------------------- the guard

test('guard rejects banned language, unsupported identifiers, and the wrong block', async () => {
  const a = intent({ owner: A, offered: [1n], sectionMask: SECTION_1, maxNetPay: 0n });
  const b = intent({ owner: B, offered: [2n], sectionMask: SECTION_0, maxNetPay: -10n * USDC });
  const snap = snapshot([a, b], [
    { id: 1n, section: 0, row: 1, seat: 1, owner: A },
    { id: 2n, section: 1, row: 1, seat: 1, owner: B },
  ]);
  const evidence = await diagnose(snap, hashIntent(a) as Hex, funds);
  const log = [{ tool: 'diagnose_intent', input: { intentHash: hashIntent(a) }, output: evidence }];
  const block = '61000000';

  const good = `At Arc Testnet block #${block}, no settlement was found within the search bound. Raising the limit is the smallest change among those tried.`;
  assert.equal(checkAnswer(good, log, block), null);
  assert.equal(guard(good, log, block, evidence).guardFallback, false);

  // 1. A promise nothing here can keep.
  assert.equal(checkAnswer(`At Arc Testnet block #${block}, this is the optimal reshuffle.`, log, block), 'BANNED_LANGUAGE');
  assert.equal(checkAnswer(`At Arc Testnet block #${block}, no solution exists.`, log, block), 'BANNED_LANGUAGE');

  // 2. A counterparty address no tool returned.
  const invented = '0x9999000000000000000000000000000000009999';
  assert.equal(
    checkAnswer(`At Arc Testnet block #${block}, your counterparty is ${invented}.`, log, block),
    'UNSUPPORTED_IDENTIFIER'
  );
  // B's address IS in the evidence, so stating it is allowed.
  assert.equal(checkAnswer(`At Arc Testnet block #${block}, ${B} holds the seat you want.`, log, block), null);

  // 3. A claim about some other moment, or no moment at all.
  assert.equal(checkAnswer('At Arc Testnet block #999, nothing was found.', log, block), 'WRONG_BLOCK');
  assert.equal(checkAnswer('No settlement was found within the search bound.', log, block), 'WRONG_BLOCK');
  assert.equal(checkAnswer('', log, block), 'EMPTY');

  // A rejected answer is replaced by the deterministic sentence, never shown with a warning.
  const fallback = guard('this is the optimal outcome', log, block, evidence);
  assert.equal(fallback.guardFallback, true);
  assert.equal(fallback.guardReason, 'BANNED_LANGUAGE');
  assert.equal(fallback.answer, renderEvidence(evidence));
  assert.equal(checkAnswer(fallback.answer, log, block), null, 'the fallback must itself pass the guard');
});
