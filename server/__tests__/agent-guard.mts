import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAnswer, guard, AgentEvidenceMismatch, type ToolLogEntry } from '../agent/guard';
import { answerOptions } from '../agent/answer-options';
import { renderEvidence } from '../agent/template';
import type { Evidence } from '../agent/diagnose';
import type { WhatIfResult } from '../agent/what-if';
import { SEARCH_CONFIG } from '../solve';

const block = '61000000';
const hash = `0x${'1'.repeat(64)}`;
const otherHash = `0x${'2'.repeat(64)}`;
const counterparty = `0x${'a'.repeat(40)}` as const;
const baseline: Evidence = {
  block, timestamp: '1789173368', intent: hash, status: 'SETTLEABLE',
  settleable: { participantCount: 2, counterparties: [counterparty], counterpartyIntents: [], targetNetPay: '12500001', receives: ['7'] },
  relaxations: [], bounds: { ...SEARCH_CONFIG, budgetCapUsdc: 100, groupSearchCap: 40 },
  counterpartyIntents: [], runtimeMs: 0,
};
const entry = (output: Evidence = baseline): ToolLogEntry => ({ tool: 'diagnose_intent', input: { intentHash: output.intent }, output });
const log = [entry()];
const good = renderEvidence(baseline);

test('guard requires the exact opening and rejects a second snapshot reference', async t => {
  for (const [name, text, reason] of [
    ['leading heading', `Answer: ${good}`, 'INVALID_PREFIX'],
    ['leading space', ` ${good}`, 'INVALID_PREFIX'],
    ['case change', good.replace('At Arc', 'at Arc'), 'INVALID_PREFIX'],
    ['missing comma', good.replace(`${block},`, block), 'INVALID_PREFIX'],
    ['appended block', `${good} At block #999, the result changes.`, 'WRONG_BLOCK'],
    ['unprefixed block number', `${good} See block 999.`, 'WRONG_BLOCK'],
    ['formatted block number', `${good} Block #61,000,001 agrees.`, 'WRONG_BLOCK'],
    ['bare wrong hash tag', `${good} Snapshot #999.`, 'UNSUPPORTED_CLAIM'],
  ] as const) await t.test(name, () => assert.equal(checkAnswer(text, log, block), reason));
  assert.equal(checkAnswer(good, log, block), null);
});

test('guard binds amounts to direction, counts and candidate status', async t => {
  for (const [name, text] of [
    ['wrong amount', good.replace('12.500001 USDC', '12.500002 USDC')],
    ['wrong direction', good.replace('paying', 'receiving')],
    ['wrong sign', good.replace('12.500001 USDC', '-12.500001 USDC')],
    ['wrong units', good.replace('12.500001 USDC', '12500001 USDC')],
    ['wrong participant count', good.replace('2 participants', '3 participants')],
    ['wrong counterparty count', good.replace('1 counterparty', '2 counterparties')],
    ['candidate stated as completed', good.replace('was found', 'was executed')],
    ['unsupported short address', `${good} Owner: 0xabcd...1234.`],
  ]) await t.test(name, () => assert.equal(checkAnswer(text, log, block), 'UNSUPPORTED_CLAIM'));
  const receipt = { ...baseline, settleable: { ...baseline.settleable!, targetNetPay: '-12500001' } };
  assert.match(renderEvidence(receipt), /receiving 12\.500001 USDC/);
  assert.equal(checkAnswer(renderEvidence(receipt), [entry(receipt)], block), null);
  const even = { ...baseline, settleable: { ...baseline.settleable!, targetNetPay: '0' } };
  assert.equal(checkAnswer(renderEvidence(even), [entry(even)], block), null);
});

test('guard does not accept identifiers or answers supplied in model tool input', () => {
  const invented = `0x${'9'.repeat(40)}`;
  const poisoned = [{ ...entry(), input: { intentHash: hash, address: invented, answer: good } }];
  assert.equal(checkAnswer(`${good} Counterparty: ${invented}.`, poisoned, block), 'UNSUPPORTED_IDENTIFIER');
  assert.equal(checkAnswer(good, [{ tool: 'diagnose_intent', input: { answer: good }, output: { block, error: 'failed' } }], block), 'UNSUPPORTED_CLAIM');
  assert.equal(checkAnswer(good, [{ tool: 'fake_tool', input: {}, output: baseline }], block), 'UNSUPPORTED_CLAIM');
});

test('guard rejects stale evidence and another intent even when the answer cites the selected block', () => {
  assert.equal(checkAnswer(good, [entry({ ...baseline, block: '60999999' })], block), 'EVIDENCE_BLOCK_MISMATCH');
  assert.equal(checkAnswer(good, [entry({ ...baseline, intent: otherHash })], block, hash), 'UNSUPPORTED_CLAIM');
  assert.throws(() => guard(good, log, block, { ...baseline, block: '60999999' }), AgentEvidenceMismatch);
});

test('ticket identifiers and historical closing metadata do not replace the snapshot block', () => {
  const demand: Evidence = { ...baseline, status: 'NOT_FOUND_WITHIN_BOUND', settleable: undefined,
    demand: { perTicket: [{ ticket: '7', acceptingIntents: 0 }], unwanted: ['7'] } };
  assert.match(renderEvidence(demand), /#7/);
  assert.equal(checkAnswer(renderEvidence(demand), [entry(demand)], block), null);
  const closed: Evidence = { ...baseline, status: 'CLOSED', closed: { state: 'REVOKED', tx: otherHash, block: '60999990' } };
  assert.equal(checkAnswer(renderEvidence(closed), [entry(closed)], block), null);
  assert.equal(checkAnswer(renderEvidence(closed).replace(otherHash, `0x${'3'.repeat(64)}`), [entry(closed)], block), 'UNSUPPORTED_IDENTIFIER');
});

test('hypothetical limit, actual payment and received tickets cannot be interchanged', () => {
  const result: WhatIfResult = { block, intent: hash, submittable: false, changes: { maxNetPayUsdc: 30 },
    found: true, participantCount: 2, counterparties: [counterparty], counterpartyIntents: [], targetNetPay: '12500001', receives: ['7'], bounds: SEARCH_CONFIG };
  const source = { tool: 'what_if', input: {}, output: result };
  const answer = answerOptions(source, block, hash)[0];
  assert.match(answer, /ceiling of 30 USDC/);
  assert.match(answer, /paying 12\.500001 USDC/);
  assert.equal(checkAnswer(answer, [source], block, hash), null);
  for (const tampered of [
    answer.replace('paying 12.500001 USDC', 'paying 30 USDC'),
    answer.replace('ceiling of 30 USDC', 'ceiling of 12.500001 USDC'),
    answer.replace('IDs would be 7', 'IDs would be 8'),
    answer.replace('hypothetically ', ''),
    answer.replace('This does not change the committed intent.', 'This changed the committed intent.'),
  ]) assert.equal(checkAnswer(tampered, [source], block, hash), 'UNSUPPORTED_CLAIM');
  const receiver = { ...source, output: { ...result, changes: { maxNetPayUsdc: -12.5 }, targetNetPay: '-12500001' } };
  const receiveAnswer = answerOptions(receiver, block, hash)[0];
  assert.match(receiveAnswer, /minimum receipt of 12\.5 USDC/);
  assert.match(receiveAnswer, /receiving 12\.500001 USDC/);
  assert.equal(checkAnswer(receiveAnswer, [receiver], block, hash), null);
});

test('pool counts stay attached to their section and session', () => {
  const source = { tool: 'pool_overview', input: {}, output: { block, liveIntents: 2, escrowedTickets: 7,
    pureBuyers: 0, pureSellers: 1, excludedByReason: {}, bySection: [{ sectionId: 3, tickets: 7 }], bySession: [{ sessionId: 0, tickets: 7 }] } };
  const answer = answerOptions(source, block)[0];
  assert.equal(checkAnswer(answer, [source], block), null);
  assert.equal(checkAnswer(answer.replace('section 3: 7', 'section 7: 3'), [source], block), 'UNSUPPORTED_CLAIM');
});

test('fallback supplies its own evidence and never counts an uncalled tool as a model result', () => {
  const result = guard(good, [], block, baseline);
  assert.equal(result.guardFallback, true);
  assert.equal(result.guardReason, 'UNSUPPORTED_CLAIM');
  assert.equal(result.answer, good);
  assert.equal(result.evidence[0].source, 'fallback');
  assert.equal(checkAnswer(result.answer, result.evidence, block, hash), null);
  assert.equal(guard(good, log, block, baseline).evidence.length, 1);
});
