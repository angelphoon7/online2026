import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
const { intentSentence, maskClasses, paymentLabel } = await import('../lib/ui-copy.ts');
const { initialIntent } = await import('../lib/intent-draft.ts');
const owner = '0x1111111111111111111111111111111111111111';
const draft = initialIntent({ timestamp: '1789160000', intents: [], tickets: [
  { eventId: 1, sessionId: 0, sectionId: 0 },
  { eventId: 1, sessionId: 1, sectionId: 1 },
  { eventId: 2, sessionId: 2, sectionId: 2 },
] }, owner);
draft.offered = [1n, 2n];
assert.equal(draft.sessionMask, 3n);
assert.equal(draft.sectionMask, 3n);
assert.deepEqual(maskClasses(draft.sectionMask), [0, 1]);
const baseline = intentSentence(draft);
assert.match(baseline, /sections 0, 1;/);
assert.doesNotMatch(baseline, /sections 0, 1, 2/);
const mutations = {
  owner: ['0x2222222222222222222222222222222222222222', /owner 0x2222/],
  offered: [[4n, 5n], /my tickets #4, #5/],
  eventId: [2, /Event 2/],
  sessionMask: [2n, /sessions 1;/],
  sectionMask: [1n, /sections 0;/],
  exactCount: [3, /exactly 3 tickets/],
  mustShareSession: [false, /mixed sessions permitted/],
  mustShareSection: [false, /mixed sections permitted/],
  mustBeAdjacent: [false, /adjacency not required/],
  maxNetPay: [-1500000n, /receive at least 1\.5 USDC/],
  deadline: [draft.deadline + 3600n, new RegExp(new Date(Number(draft.deadline + 3600n) * 1000).toISOString().replaceAll('.', '\\.'))],
  nonce: [9n, /nonce 9/],
};
assert.deepEqual(Object.keys(mutations).sort(), Object.keys(draft).sort(), 'Every signed field must have a mutation test');
for (const [field, [value, expected]] of Object.entries(mutations)) {
  const sentence = intentSentence({ ...draft, [field]: value });
  assert.notEqual(sentence, baseline, field);
  assert.match(sentence, expected, field);
}
assert.match(baseline, /pay at most 0 USDC/);
assert.equal(paymentLabel(0n), 'No net payment');
assert.equal(paymentLabel(1000000n), 'I pay up to 1 USDC');
assert.equal(paymentLabel(-1000000n), 'I must receive at least 1 USDC');
console.log('PASS all 12 signed fields change the review; masks match issued classes; USDC signs and precision preserved.');
