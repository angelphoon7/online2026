import test from 'node:test';
import assert from 'node:assert/strict';
import { readDiagnosis, readDrawerEvidence } from '../../lib/agent-evidence';

const hash = (n: string) => `0x${n.repeat(64)}`;
const A = hash('a'), B = hash('b');
const bounds = { maxParticipants: 4, maxCandidates: 100, timeoutMs: 2000, budgetCapUsdc: 40 };
const diagnosis = (intent = A, block = '100') => ({ block, intent, status: 'UNKNOWN', relaxations: [], bounds, runtimeMs: 1 });
const reference = { intentHash: B, owner: `0x${'b'.repeat(40)}`, committedTx: hash('c') };
const hypothetical = (over = {}) => ({ block: '100', intent: A, submittable: false, found: true,
  changes: { maxNetPayUsdc: -0.000001, mustBeAdjacent: false, mustShareSection: true, addSections: [0, 255], addSessions: [] },
  bounds, counterparties: [reference.owner], counterpartyIntents: [reference], participantCount: 2,
  targetNetPay: '-1', receives: ['41', '42'], ...over });
const overview = (over = {}) => ({ block: '100', liveIntents: 3, escrowedTickets: 6, pureBuyers: 0, pureSellers: 1,
  bySession: [{ sessionId: 0, tickets: 6 }], bySection: [{ sectionId: 2, tickets: 6 }], excludedByReason: { EXPIRED: 2 }, ...over });

test('drawer selects returned identity regardless of tool order or request input', () => {
  const other = { tool: 'diagnose_intent', input: { intentHash: A }, output: diagnosis(B) };
  const selected = { tool: 'diagnose_intent', input: { intentHash: B }, output: diagnosis(A.toUpperCase()) };
  for (const entries of [[other, selected], [selected, other]]) {
    const view = readDrawerEvidence(entries, A, '100');
    assert.equal(view.diagnosis?.intent, A.toUpperCase());
    assert.equal(view.omitted, 1);
    assert.deepEqual(view.entries, [selected]);
  }
});

test('direct diagnosis rejects another intent even when the request URL selected this one', () => {
  assert.throws(() => readDiagnosis(diagnosis(B), A), { name: 'AgentEvidenceScopeMismatch' });
  assert.throws(() => readDiagnosis(diagnosis(A, '99'), A, '100'), { name: 'AgentEvidenceScopeMismatch' });
  assert.equal(readDiagnosis(diagnosis(A.toUpperCase()), A).intent, A.toUpperCase());
});

test('what-if-only evidence preserves changes, signed units, tickets and commitment identity', () => {
  const result = hypothetical();
  const view = readDrawerEvidence([{ tool: 'what_if', output: result }], A, '100');
  assert.equal(view.diagnosis, null);
  assert.deepEqual(view.hypotheticals[0].output, result);
  assert.equal(view.hypotheticals[0].output.changes.mustBeAdjacent, false);
  assert.equal(view.hypotheticals[0].output.targetNetPay, '-1');
  assert.deepEqual(view.hypotheticals[0].output.receives, ['41', '42']);
  assert.deepEqual(view.hypotheticals[0].output.counterpartyIntents, [reference]);
});

test('all hypothetical calls are retained including no candidate and not evaluated', () => {
  const miss = hypothetical({ found: false, participantCount: null, targetNetPay: null, counterparties: [], counterpartyIntents: [], receives: [] });
  const unavailable = { ...miss, unavailable: 'NOT_LIVE_AT_THIS_BLOCK' };
  const results = [hypothetical(), miss, unavailable];
  const view = readDrawerEvidence(results.map(output => ({ tool: 'what_if', output })), A, '100');
  assert.deepEqual(view.hypotheticals.map(r => r.output), results);
  assert.equal(view.hypotheticals[1].output.unavailable, undefined);
  assert.equal(view.hypotheticals[2].output.unavailable, 'NOT_LIVE_AT_THIS_BLOCK');
});

test('pool overview stands alone and retains zero counts and empty distributions', () => {
  const empty = overview({ liveIntents: 0, escrowedTickets: 0, pureSellers: 0, bySession: [], bySection: [], excludedByReason: {} });
  for (const result of [overview(), empty]) {
    const view = readDrawerEvidence([{ tool: 'pool_overview', output: result }], A, '100');
    assert.equal(view.diagnosis, null);
    assert.deepEqual(view.overviews[0].output, result);
  }
});

test('all scoped tools must match the answer block, including additional results', async t => {
  for (const [tool, output] of [['diagnose_intent', diagnosis(A, '99')], ['what_if', hypothetical({ block: '99' })], ['pool_overview', overview({ block: '101' })]] as const) {
    await t.test(tool, () => assert.throws(() => readDrawerEvidence([
      { tool: 'diagnose_intent', output: diagnosis() }, { tool, output },
    ], A, '100'), { name: 'AgentEvidenceScopeMismatch' }));
  }
});

test('another intent cannot replace the selected diagnosis or what-if evidence', () => {
  assert.throws(() => readDrawerEvidence([{ tool: 'diagnose_intent', output: diagnosis(B) }], A, '100'), { name: 'AgentEvidenceInvalid' });
  const view = readDrawerEvidence([
    { tool: 'diagnose_intent', output: diagnosis(B, '99') },
    { tool: 'what_if', input: { intentHash: A }, output: hypothetical({ intent: B }) },
    { tool: 'pool_overview', output: overview() },
  ], A, '100');
  assert.equal(view.diagnosis, null);
  assert.equal(view.hypotheticals.length, 0);
  assert.equal(view.omitted, 2);
  assert.equal(view.entries.length, 1);
});

test('call errors are retained separately with fallback provenance', () => {
  const failure = { tool: 'what_if', input: { intentHash: A, changes: { mustBeAdjacent: 'false' } }, output: { code: 'WhatIfError', error: 'Boolean required', submittable: false } };
  const fallback = { tool: 'diagnose_intent', source: 'fallback', output: diagnosis() };
  const view = readDrawerEvidence([failure, fallback], A, '100');
  assert.deepEqual(view.failures, [{ index: 0, tool: 'what_if', code: 'WhatIfError', error: 'Boolean required' }]);
  assert.equal(view.hypotheticals.length, 0);
  assert.equal(view.diagnoses[0].source, 'fallback');
  assert.deepEqual(view.entries, [failure, fallback]);
});

test('malformed tool results are rejected before rendering', async t => {
  const cases: [string, string, unknown][] = [
    ['missing intent', 'what_if', hypothetical({ intent: undefined })],
    ['missing changes', 'what_if', hypothetical({ changes: undefined })],
    ['string boolean', 'what_if', hypothetical({ changes: { mustBeAdjacent: 'false' } })],
    ['unknown change', 'what_if', hypothetical({ changes: { owner: reference.owner } })],
    ['invalid signed amount', 'what_if', hypothetical({ targetNetPay: 'one' })],
    ['wrong commit link', 'what_if', hypothetical({ counterpartyIntents: [{ ...reference, committedTx: 'https://example.com' }] })],
    ['missing tickets', 'what_if', hypothetical({ receives: undefined })],
    ['missing bound', 'what_if', hypothetical({ bounds: undefined })],
    ['missing total', 'pool_overview', overview({ liveIntents: undefined })],
    ['negative total', 'pool_overview', overview({ pureBuyers: -1 })],
    ['missing distribution', 'pool_overview', overview({ bySection: undefined })],
    ['string count', 'pool_overview', overview({ excludedByReason: { EXPIRED: '2' } })],
    ['missing diagnosis status', 'diagnose_intent', { ...diagnosis(), status: undefined }],
    ['invalid diagnosis payment', 'diagnose_intent', { ...diagnosis(), settleable: { participantCount: 2, targetNetPay: 'one', counterpartyIntents: [] } }],
    ['missing funnel stages', 'diagnose_intent', { ...diagnosis(), supply: {} }],
    ['missing demand rows', 'diagnose_intent', { ...diagnosis(), demand: {} }],
    ['malformed relaxation', 'diagnose_intent', { ...diagnosis(), relaxations: [null] }],
  ];
  for (const [name, tool, output] of cases) await t.test(name, () => {
    assert.throws(() => readDrawerEvidence([{ tool, output }], A, '100'), { name: 'AgentEvidenceInvalid' });
  });
});
