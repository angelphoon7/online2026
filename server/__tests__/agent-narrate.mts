// SDK transport fixtures exercise the real ask route and tool loop; these are not live-model acceptance.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters } from 'viem';
import { POST } from '../../app/api/agent/ask/route';
import { hashIntent, type Intent } from '../../shared/intent';
import { checkAnswer } from '../agent/guard';

const A = `0x${'a'.repeat(40)}` as const, B = `0x${'b'.repeat(40)}` as const;
const block = '61000000', now = 1800000000n;
const makeIntent = (owner: typeof A, offered: bigint[], sectionMask: bigint, maxNetPay: bigint): Intent => ({
  owner, offered, sectionMask, maxNetPay, eventId: 1, sessionMask: 1n, exactCount: 1,
  mustBeAdjacent: false, mustShareSession: false, mustShareSection: false, deadline: now + 10000n, nonce: 1n,
});
const intents = [makeIntent(A, [1n], 2n, 0n), makeIntent(B, [2n], 1n, -12_500_001n)];
const selected = hashIntent(intents[0]);
type Mode = 'copy' | 'corrupt' | 'no-tool' | 'loop' | 'refusal' | 'truncated';
function transport(t: TestContext, tool: string, mode: Mode = 'copy') {
  let modelCalls = 0, graphCalls = 0, rpcCalls = 0;
  for (const [key, value] of Object.entries({ ANTHROPIC_API_KEY: 'test-fixture-only', ANTHROPIC_BASE_URL: 'https://model.invalid', SUBGRAPH_URL: 'https://graph.invalid', ARC_RPC: 'https://rpc.invalid' })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    const body = await request.json();
    if (url.hostname === 'rpc.invalid') {
      rpcCalls++;
      assert.equal(body.method, 'eth_call');
      assert.equal(body.params[1], `0x${BigInt(block).toString(16)}`);
      return Response.json({ jsonrpc: '2.0', id: body.id, result: encodeAbiParameters([{ type: 'uint256' }], [100_000_000n]) });
    }
    if (url.hostname === 'graph.invalid') {
      graphCalls++;
      return Response.json({ data: {
        _meta: { block: { number: Number(block), timestamp: String(now) }, deployment: 'QmFixture', hasIndexingErrors: false },
        intents: intents.map(i => ({ ...i, id: hashIntent(i), offered: i.offered.map(String), sessionMask: String(i.sessionMask), sectionMask: String(i.sectionMask), maxNetPay: String(i.maxNetPay), deadline: String(i.deadline), nonce: String(i.nonce), committedAtBlock: '60000000', committedTx: selected,
          offeredTickets: i.offered.map(id => ({ id: String(id), escrowed: true, depositor: i.owner, redeemed: false })) })),
        tickets: intents.map((i, index) => ({ id: String(index + 1), eventId: 1, sessionId: 0, sectionId: index, row: 1, seat: 1, depositor: i.owner, redeemed: false })),
      } });
    }
    assert.equal(url.hostname, 'model.invalid');
    modelCalls++;
    const wantsTool = mode === 'loop' || (modelCalls === 1 && !['no-tool', 'refusal', 'truncated'].includes(mode));
    let answer = `At Arc Testnet block #${block}, invented response.`;
    if (!wantsTool && modelCalls > 1) {
      const result = JSON.parse(body.messages.at(-1).content[0].content);
      assert.equal(result.result.block, block);
      assert.equal(result.answerOptions.length, 1);
      answer = result.answerOptions[0];
      if (mode === 'corrupt') answer = answer.replace('paying 12.500001 USDC', 'receiving 12.500001 USDC');
    }
    return Response.json({
      id: `msg_fixture_${modelCalls}`, type: 'message', role: 'assistant', model: body.model,
      stop_reason: wantsTool ? 'tool_use' : mode === 'refusal' ? 'refusal' : mode === 'truncated' ? 'max_tokens' : 'end_turn',
      stop_sequence: null, usage: { input_tokens: 100, output_tokens: 50 },
      content: wantsTool ? [{ type: 'tool_use', id: `tool_fixture_${modelCalls}`, name: tool,
        input: tool === 'pool_overview' ? {} : { intentHash: selected, ...(tool === 'what_if' ? { changes: { maxNetPayUsdc: 30 } } : {}) } }]
        : [{ type: 'text', text: answer }],
    }, { headers: { 'request-id': `req_fixture_${modelCalls}` } });
  });
  return () => ({ modelCalls, graphCalls, rpcCalls });
}
const request = () => POST(new Request('http://localhost/api/agent/ask', { method: 'POST', body: JSON.stringify({ intentHash: selected, question: 'What would change with a 30 USDC payment ceiling?' }) }));

for (const tool of ['diagnose_intent', 'what_if', 'pool_overview']) test(`ask SDK fixture: ${tool} result is accepted with model provenance`, async t => {
  const counts = transport(t, tool);
  const response = await request();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.guardFallback, false);
  assert.equal(body.narration, 'evidence-passages-v1');
  assert.equal(body.modelCalls.length, 2);
  assert.equal(body.modelCalls[0].requestId, 'req_fixture_1');
  assert.equal(body.modelCalls[1].messageId, 'msg_fixture_2');
  assert.equal(checkAnswer(body.answer, body.evidence, block, selected), null);
  assert.ok(body.evidence.some((e: { tool: string; source: string }) => e.tool === tool && e.source === 'model'));
  assert.deepEqual(counts(), { modelCalls: 2, graphCalls: 1, rpcCalls: 4 });
  if (tool === 'what_if') { assert.match(body.answer, /ceiling of 30 USDC/); assert.match(body.answer, /paying 12\.500001 USDC/); }
});

test('ask SDK fixture: incorrect payment direction is replaced with a pinned diagnosis', async t => {
  transport(t, 'what_if', 'corrupt');
  const body = await (await request()).json();
  assert.equal(body.guardFallback, true);
  assert.equal(body.guardReason, 'UNSUPPORTED_CLAIM');
  assert.match(body.answer, /no settlement was found within the search bound/);
  assert.doesNotMatch(body.answer, /receiving 12\.500001/);
  assert.equal(body.evidence.at(-1).source, 'fallback');
});

for (const mode of ['no-tool', 'loop', 'refusal', 'truncated'] as const) test(`ask SDK fixture: ${mode} returns labelled fallback evidence`, async t => {
  const counts = transport(t, 'pool_overview', mode);
  const response = await request();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.guardFallback, true);
  assert.equal(body.guardReason, mode === 'no-tool' ? 'UNSUPPORTED_CLAIM' : 'EMPTY');
  assert.equal(body.evidence.at(-1).source, 'fallback');
  assert.equal(body.modelCalls.length, mode === 'loop' ? 4 : 1);
  assert.equal(counts().rpcCalls, 4);
});
