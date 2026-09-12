import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from '../agent/diagnose';
import { renderEvidence } from '../agent/template';
import { checkAnswer } from '../agent/guard';
import { applyChanges, parseWhatIfChanges, whatIf, WhatIfError } from '../agent/what-if';
import { dispatcher } from '../agent/tools';
import { solveHypothetical } from '../solve-hypothetical';
import { checkReceivedBundle } from '../../solver/dist/index.js';
import { hashIntent, type Address, type Intent, type TicketMeta } from '../../shared/intent';
import type { Snapshot } from '../../shared/graph';

const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
const tx = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const A = address(1), B = address(2);
const makeIntent = (over: Partial<Intent> = {}): Intent => ({ owner: A, offered: [], eventId: 1,
  sessionMask: 1n, sectionMask: 1n, exactCount: 2, mustShareSession: false,
  mustShareSection: false, mustBeAdjacent: true, maxNetPay: 0n, deadline: 9999999999n, nonce: 0n, ...over });
const seat = (section: number, number = 1): TicketMeta => ({ eventId: 1, sessionId: 0, sectionId: section, row: 1, seat: number, status: 0 });
function snapshot(intents: Intent[], metadata: [bigint, TicketMeta][]): Snapshot {
  return { block: 100n, timestamp: 100n, deployment: 'fixture', excluded: [],
    intents: intents.map((i, n) => ({ ...i, hash: hashIntent(i), committedTx: tx(n + 1), committedAtBlock: 1n })),
    ticketMeta: new Map(metadata), depositor: new Map(intents.flatMap(i => i.offered.map(id => [id, i.owner] as const))) };
}
const capacity = (snap: Snapshot, amount = 0n) => ({ block: snap.block,
  usdcBalance: new Map(snap.intents.map(i => [i.owner, amount])),
  usdcAllowance: new Map(snap.intents.map(i => [i.owner, amount])) });

test('grouping beyond the ticket cap is inconclusive, even when the unsearched pair fits', async () => {
  const target = makeIntent(), intents = [target], metadata: [bigint, TicketMeta][] = [];
  let id = 0n;
  for (let n = 0; n < 11; n++) {
    const offered: bigint[] = [];
    for (let t = 0; t < (n === 10 ? 2 : 4); t++) {
      offered.push(++id);
      metadata.push([id, seat(0, n === 10 ? 1000 + t : Number(id) * 2)]);
    }
    intents.push(makeIntent({ owner: address(n + 2), offered, exactCount: 0, mustBeAdjacent: false, maxNetPay: -1000000n }));
  }
  const snap = snapshot(intents, metadata), funds = capacity(snap);
  const evidence = await diagnose(snap, hashIntent(target), funds);
  assert.equal(evidence.status, 'NOT_FOUND_WITHIN_BOUND');
  assert.equal(checkReceivedBundle(target, [41n, 42n], { ...funds, ticketMeta: snap.ticketMeta, depositor: snap.depositor, intentState: new Map(), blockTimestamp: snap.timestamp }), null);
  assert.equal(evidence.supply?.truncated, true);
  assert.equal(evidence.supply.groupSearched, 40);
  assert.equal(evidence.supply.groupCandidates, 42);
  assert.equal(evidence.supply.largestGroup, 1);
  assert.equal(evidence.supply.blockedAt, null, 'a subset cannot prove a pool-wide grouping shortfall');
  assert.equal(evidence.supply.firstZero, null);
  const text = renderEvidence(evidence), log = [{ tool: 'diagnose_intent', input: {}, output: evidence }];
  assert.match(text, /Grouping checked 40 of 42 acceptable tickets/);
  assert.match(text, /largest group found in that subset is 1/);
  assert.match(text, /remaining tickets were not checked/);
  assert.equal(checkAnswer(text, log, '100', evidence.intent), null);
  const overclaim = text.replace(/Grouping checked.*?grouping\./, 'The largest group of acceptable tickets is 1.');
  assert.equal(checkAnswer(overclaim, log, '100', evidence.intent), 'UNSUPPORTED_CLAIM');
});

test('a fully checked supply shortfall still names the grouping condition', async () => {
  const target = makeIntent();
  const snap = snapshot([target, makeIntent({ owner: B, offered: [1n, 2n], exactCount: 0, mustBeAdjacent: false })], [[1n, seat(0, 1)], [2n, seat(0, 3)]]);
  const evidence = await diagnose(snap, hashIntent(target), capacity(snap));
  assert.equal(evidence.supply?.truncated, false);
  assert.equal(evidence.supply.groupSearched, 2);
  assert.equal(evidence.supply.groupCandidates, 2);
  assert.equal(evidence.supply.blockedAt, 'cohesiveGroup');
  assert.equal(evidence.supply.largestGroup, 1);
  assert.equal(evidence.relaxations.find(r => r.change === 'mustBeAdjacent=false')?.found, true);
});

test('what-if rejects malformed containers, unsupported fields and invalid field types', async t => {
  const cases: [string, unknown][] = [
    ['missing changes', undefined], ['null changes', null], ['array changes', []], ['string changes', 'false'],
    ...['owner', 'offered', 'eventId', 'exactCount', 'deadline', 'nonce', 'sectionMask', 'extra'].map(field => [`unsupported ${field}`, { [field]: 1 }] as [string, unknown]),
    ...['mustBeAdjacent', 'mustShareSession', 'mustShareSection'].flatMap(field => ['false', 0, 1, null, undefined].map((value, n) => [`${field} invalid ${n}`, { [field]: value }] as [string, unknown])),
    ...['addSections', 'addSessions'].flatMap(field => ['12', null, [1.5], [-1], [256], ['1'], [true], Array(257).fill(0)].map((value, n) => [`${field} invalid ${n}`, { [field]: value }] as [string, unknown])),
    ...['12', NaN, Infinity, -Infinity, null, 1000001, -1000001].map((value, n) => [`payment invalid ${n}`, { maxNetPayUsdc: value }] as [string, unknown]),
  ];
  for (const [name, input] of cases) await t.test(name, () => {
    assert.throws(() => applyChanges(makeIntent(), input), { name: 'WhatIfError' });
  });
});

test('valid false, signed micro-USDC and mask boundaries are preserved without mutation', () => {
  const target = makeIntent({ exactCount: 1, mustBeAdjacent: false });
  const changes = { mustBeAdjacent: false, mustShareSession: true, mustShareSection: false,
    maxNetPayUsdc: -12.500001, addSections: [0, 255], addSessions: [1, 255] };
  const before = structuredClone(changes), result = applyChanges(target, changes);
  assert.equal(result.mustBeAdjacent, false);
  assert.equal(result.mustShareSession, true);
  assert.equal(result.maxNetPay, -12500001n);
  assert.equal(result.sectionMask, 1n | (1n << 255n));
  assert.equal(result.sessionMask, 3n | (1n << 255n));
  assert.deepEqual(changes, before);
  assert.equal(target.maxNetPay, 0n);
  assert.deepEqual(parseWhatIfChanges({}), {});
  assert.throws(() => applyChanges(target, { mustBeAdjacent: true }), WhatIfError);
});

test('invalid tool input is named before any RPC or search, including a non-live intent', async t => {
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async () => { reads++; throw new Error('unexpected external read'); });
  const target = makeIntent(), snap = snapshot([target], []), hash = hashIntent(target);
  const run = dispatcher(snap, hash).run;
  for (const input of [null, [], {}, { changes: {} }, { intentHash: hash },
    { intentHash: 'invalid', changes: {} }, { intentHash: hash, changes: null },
    { intentHash: hash, changes: { mustBeAdjacent: 'false' } },
    { intentHash: hash, changes: { exactCount: 5 } }, { intentHash: hash, changes: {}, extra: true }]) {
    const result = await run('what_if', input) as { code: string; error: string; submittable: boolean };
    assert.equal(result.code, 'WhatIfError');
    assert.equal(result.submittable, false);
    assert.equal(typeof result.error, 'string');
  }
  await assert.rejects(whatIf(snapshot([], []), hash, { exactCount: 5 }), { name: 'WhatIfError' });
  assert.equal(reads, 0);
});

function duplicateOwnerPool(debit = 0n) {
  const target = makeIntent({ offered: [1n], exactCount: 1, mustBeAdjacent: false, sectionMask: 2n });
  const other = makeIntent({ owner: B, offered: [2n], exactCount: 1, mustBeAdjacent: false, maxNetPay: -debit });
  const unrelated = { ...other, offered: [3n], sectionMask: 4n, nonce: 1n };
  return { target, other, unrelated, snap: snapshot([target, other, unrelated], [[1n, seat(0)], [2n, seat(1)], [3n, seat(1, 2)]]) };
}

test('a candidate links its exact commitment when the same wallet has an unrelated later intent', async () => {
  const { target, other, unrelated, snap } = duplicateOwnerPool();
  const expected = [{ intentHash: hashIntent(other), owner: B, committedTx: tx(2) }];
  for (const intents of [snap.intents, [...snap.intents].reverse()]) {
    const evidence = await diagnose({ ...snap, intents }, hashIntent(target), capacity(snap));
    assert.equal(evidence.status, 'SETTLEABLE');
    assert.deepEqual(evidence.settleable?.receives, ['2']);
    assert.deepEqual(evidence.settleable?.counterpartyIntents, expected);
    assert.deepEqual(evidence.counterpartyIntents, expected);
    assert.ok(!JSON.stringify(evidence.counterpartyIntents).includes(hashIntent(unrelated)));
    assert.ok(!('counterpartyTx' in evidence));
  }
});

test('relaxations and explicit what-if preserve the actual counterparty commitment', async () => {
  const { target, other, snap } = duplicateOwnerPool(10000000n), funds = capacity(snap, 100000000n);
  const expected = [{ intentHash: hashIntent(other), owner: B, committedTx: tx(2) }];
  const evidence = await diagnose(snap, hashIntent(target), funds);
  assert.equal(evidence.status, 'NOT_FOUND_WITHIN_BOUND');
  const raised = evidence.relaxations.find(r => r.change === 'maxNetPay->cap');
  assert.equal(raised?.found, true);
  assert.deepEqual(raised.counterpartyIntents, expected);
  assert.deepEqual(evidence.counterpartyIntents, expected);
  const result = await whatIf(snap, hashIntent(target), { maxNetPayUsdc: 10 }, funds);
  assert.equal(result.found, true);
  assert.equal(result.submittable, false);
  assert.deepEqual(result.counterpartyIntents, expected);
});

test('two participating intents from one owner retain two separate commitment links', async () => {
  const target = makeIntent(), seller = makeIntent({ owner: B, offered: [1n], exactCount: 0, mustBeAdjacent: false });
  const second = { ...seller, offered: [2n], nonce: 1n };
  const snap = snapshot([target, seller, second], [[1n, seat(0, 1)], [2n, seat(0, 2)]]);
  const result = await solveHypothetical(snap, { replaceHash: hashIntent(target), intent: target }, capacity(snap));
  assert.equal(result.found, true);
  assert.equal(result.participantCount, 3);
  assert.deepEqual(result.counterpartyIntents, [
    { intentHash: hashIntent(seller), owner: B, committedTx: tx(2) },
    { intentHash: hashIntent(second), owner: B, committedTx: tx(3) },
  ]);
  const evidence = await diagnose(snap, hashIntent(target), capacity(snap));
  assert.deepEqual(evidence.counterpartyIntents, result.counterpartyIntents);
});
