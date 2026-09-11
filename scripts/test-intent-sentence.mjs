import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
const { intentSentence, maskClasses, paymentLabel } = await import('../lib/ui-copy.ts');
const { initialIntent } = await import('../lib/intent-draft.ts');
const { demoPriceQuote } = await import('../lib/demo-pricing.ts');
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
assert.equal(draft.maxNetPay, 1000000n);
assert.match(baseline, /pay at most 1 USDC/);
assert.match(intentSentence({ ...draft, maxNetPay: 0n }), /pay at most 0 USDC/);
assert.equal(paymentLabel(0n), 'No net payment');
assert.equal(paymentLabel(1000000n), 'I pay up to 1 USDC');
assert.equal(paymentLabel(-1000000n), 'I must receive at least 1 USDC');
console.log('PASS all 12 signed fields change the review; masks match issued classes; USDC signs and precision preserved.');
const pricedTickets = [{ tokenId: '1', eventId: 1, sectionId: 0 }, { tokenId: '2', eventId: 1, sectionId: 0 }];
assert.deepEqual(demoPriceQuote({ ...draft, sectionMask: 2n }, pricedTickets), { offeredTotal: 2000000n, wantedMin: 3000000n, wantedMax: 3000000n, suggestedLimit: 1000000n });
assert.equal(demoPriceQuote({ ...draft, sectionMask: 1n }, pricedTickets).suggestedLimit, 0n);
assert.equal(demoPriceQuote({ ...draft, sectionMask: 1n }, pricedTickets.map(t => ({ ...t, sectionId: 1 }))).suggestedLimit, -1000000n);
assert.equal(demoPriceQuote({ ...draft, sectionMask: 2n, exactCount: 1 }, pricedTickets).suggestedLimit, -500000n);
assert.equal(demoPriceQuote({ ...draft, sectionMask: 3n }, pricedTickets).wantedMin, 2000000n);
assert.equal(demoPriceQuote({ ...draft, sectionMask: 4n }, pricedTickets), null);
assert.equal(demoPriceQuote({ ...draft, offered: [99n] }, pricedTickets), null);
console.log('PASS demo quote: upgrade, even swap, downgrade, changed count, mixed sections and unknown-price fallbacks.');
