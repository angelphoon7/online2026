// Exercise actual Graph/RPC request encoding and the API, with advancing-head fixtures.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, numberToHex } from 'viem';
import { diagnose } from '../agent/diagnose';
import { dispatcher } from '../agent/tools';
import { readCapacity, solveHypothetical } from '../solve-hypothetical';
import { GET } from '../../app/api/agent/diagnose/[hash]/route';
import { POST } from '../../app/api/agent/ask/route';
import { hashIntent, type Intent, type Hex } from '../../shared/intent';
import type { Snapshot } from '../../shared/graph';

const A = `0x${'a'.repeat(40)}` as const, B = `0x${'b'.repeat(40)}` as const;
const HASH = `0x${'c'.repeat(64)}` as Hex, TX = `0x${'d'.repeat(64)}` as Hex;
const BLOCK = 100n, NOW = 1800000000n;
const makeIntent = (owner: typeof A | typeof B, token: bigint, sectionMask: bigint, maxNetPay: bigint): Intent => ({ owner, offered: [token], eventId: 1, sessionMask: 1n, sectionMask, exactCount: 1, mustShareSession: false, mustShareSection: false, mustBeAdjacent: false, maxNetPay, nonce: 1n, deadline: NOW + 10000n });
function snapshot(empty = false): Snapshot {
  const intents = empty ? [] : [makeIntent(A, 1n, 2n, 10_000_000n), makeIntent(B, 2n, 1n, -10_000_000n)];
  return {
    block: BLOCK, timestamp: NOW, deployment: 'QmSnapshot', excluded: [],
    intents: intents.map(i => ({ ...i, hash: hashIntent(i), committedTx: TX, committedAtBlock: 90n })),
    ticketMeta: new Map(empty ? [] : [1n, 2n].map(id => [id, { eventId: 1, sessionId: 0, sectionId: Number(id - 1n), row: 1, seat: 1, status: 0 }])),
    depositor: new Map(empty ? [] : [[1n, A], [2n, B]]),
  };
}
type Call = { method?: string; params?: [unknown, string]; query?: string; variables?: { block?: number; id?: string } };
type Options = { rpcError?: boolean; graphError?: boolean; historyPruned?: boolean; money?: bigint; lookup?: Record<string, unknown> | null; metaBlock?: bigint; deployment?: string };
function transport(t: TestContext, snap: Snapshot, options: Options = {}) {
  const calls: Call[] = [];
  const reply = (body: unknown) => new Response(JSON.stringify(body, (_, v) => typeof v === 'bigint' ? String(v) : v), { headers: { 'content-type': 'application/json' } });
  for (const [key, value] of Object.entries({ SUBGRAPH_URL: 'https://graphql.invalid', ARC_RPC: 'https://rpc.invalid', ANTHROPIC_API_KEY: '' })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const call = JSON.parse(init.body as string); calls.push(call);
    if (call.method) {
      if (options.rpcError) return Response.json({ jsonrpc: '2.0', id: call.id, error: { code: -32602, message: 'Historical state unavailable' } });
      // If a caller accidentally reads latest, it sees funds that did not exist at BLOCK.
      const amount = call.params[1] === 'latest' ? 100_000_000n : options.money ?? 0n;
      return Response.json({ jsonrpc: '2.0', id: call.id, result: encodeAbiParameters([{ type: 'uint256' }], [amount]) });
    }
    if (call.query.includes('IntentById')) {
      if (options.historyPruned) return Response.json({ errors: [{ message: 'Failed to decode block.number value: subgraph QmSnapshot only has data starting at block number 101 and data for block number 100 is therefore not available' }] });
      if (options.graphError) return Response.json({ errors: [{ message: 'Historical snapshot unavailable' }] });
      return Response.json({ data: {
        _meta: { block: { number: Number(options.metaBlock ?? snap.block) }, deployment: options.deployment ?? snap.deployment, hasIndexingErrors: false },
        intent: call.variables.block === Number(snap.block) ? options.lookup ?? null : { id: HASH, state: 'REVOKED', closedTx: TX, closedAtBlock: '101' },
      } });
    }
    return reply({ data: {
      _meta: { block: { number: Number(snap.block), timestamp: String(snap.timestamp) }, deployment: snap.deployment, hasIndexingErrors: false },
      intents: snap.intents.map(i => ({ ...i, id: i.hash, committedAtBlock: String(i.committedAtBlock), offered: i.offered.map(String), offeredTickets: i.offered.map(id => ({ id: String(id), escrowed: true, depositor: i.owner, redeemed: false })) })),
      tickets: [...snap.ticketMeta].map(([id, m]) => ({ id: String(id), ...m, depositor: snap.depositor.get(id), redeemed: false })),
    } });
  });
  return calls;
}
const rpcCalls = (calls: Call[]) => calls.filter(c => c.method);
const checkPins = (calls: Call[], count: number) => {
  assert.equal(rpcCalls(calls).length, count);
  for (const c of rpcCalls(calls)) { assert.equal(c.method, 'eth_call'); assert.equal(c.params?.[1], numberToHex(BLOCK)); }
};

test('USDC balance and allowance both use the snapshot block; later funding cannot change diagnosis', async t => {
  const snap = snapshot(), calls = transport(t, snap);
  const evidence = await diagnose(snap, snap.intents[0].hash);
  assert.equal(evidence.status, 'NOT_FOUND_WITHIN_BOUND');
  assert.equal(evidence.block, String(BLOCK));
  assert.ok(evidence.relaxations.every(r => !r.found));
  checkPins(calls, 4); // Baseline and all relaxations shared one read per owner/field.
});

test('dispatcher caches payment capacity once at N across diagnosis, what-if and fallback', async t => {
  const snap = snapshot(), calls = transport(t, snap, { money: 100_000_000n });
  const tools = dispatcher(snap, snap.intents[0].hash);
  const first = await tools.baseline();
  assert.equal(first.status, 'SETTLEABLE');
  const varied = await tools.run('what_if', { intentHash: snap.intents[0].hash, changes: { maxNetPayUsdc: 20 } }) as { block: string; found: boolean };
  assert.equal(varied.block, String(BLOCK)); assert.equal(varied.found, true);
  const other = await tools.run('diagnose_intent', { intentHash: snap.intents[1].hash }) as { block: string };
  assert.equal(other.block, String(BLOCK)); assert.strictEqual(await tools.baseline(), first);
  checkPins(calls, 4);
});

test('a cached capacity from another block is rejected by both diagnosis and hypothetical solving', async t => {
  const snap = snapshot(), calls = transport(t, snap);
  const wrong = { block: BLOCK + 1n, usdcBalance: new Map(), usdcAllowance: new Map() };
  await assert.rejects(diagnose(snap, snap.intents[0].hash, wrong), { name: 'SnapshotCapacityMismatch' });
  await assert.rejects(solveHypothetical(snap, { replaceHash: snap.intents[0].hash, intent: snap.intents[0] }, wrong), { name: 'SnapshotCapacityMismatch' });
  assert.equal(calls.length, 0);
});

test('a later commitment or revocation cannot appear in an older snapshot lookup', async t => {
  const snap = snapshot(true), calls = transport(t, snap);
  const result = await diagnose(snap, HASH);
  assert.equal(result.status, 'UNKNOWN'); assert.equal(result.block, String(BLOCK));
  assert.equal(result.closed, undefined); assert.equal(calls.length, 1);
  assert.equal(calls[0].variables?.block, Number(BLOCK));
  assert.equal((calls[0].query?.match(/number: \$block/g) ?? []).length, 2);
});

test('closed intent lookup is pinned and does not read unrelated USDC capacity', async t => {
  const snap = snapshot(), calls = transport(t, snap, { lookup: { id: HASH, state: 'REVOKED', closedTx: TX, closedAtBlock: '99' }, rpcError: true });
  const result = await dispatcher(snap, HASH).baseline();
  assert.equal(result.status, 'CLOSED'); assert.equal(result.closed?.state, 'REVOKED');
  assert.equal(result.closed?.tx, TX); assert.equal(result.closed?.block, '99');
  assert.equal(calls.length, 1); assert.equal(calls[0].variables?.block, 100);
});

test('closed lookup rejects mismatched block, deployment and future closure metadata', async t => {
  for (const options of [{ metaBlock: 101n }, { deployment: 'QmOther' }, { lookup: { id: HASH, state: 'REVOKED', closedTx: TX, closedAtBlock: '101' } }]) {
    await t.test(JSON.stringify(options, (_, v) => typeof v === 'bigint' ? String(v) : v), async child => {
      const snap = snapshot(true); transport(child, snap, options);
      await assert.rejects(diagnose(snap, HASH), { name: 'IntentSnapshotMismatch' });
    });
  }
});

test('historical RPC failure is named and never falls back to latest', async t => {
  const calls = transport(t, snapshot(), { rpcError: true });
  await assert.rejects(readCapacity([A], BLOCK), { name: 'SnapshotCapacityReadError', block: BLOCK });
  assert.ok(rpcCalls(calls).length > 0);
  for (const c of rpcCalls(calls)) assert.equal(c.params?.[1], numberToHex(BLOCK));
});

test('diagnosis and no-model ask APIs return 503 for unavailable historical state', async t => {
  const snap = snapshot(), calls = transport(t, snap, { rpcError: true });
  const hash = snap.intents[0].hash;
  const get = await GET(new Request(`http://localhost/api/agent/diagnose/${hash}`), { params: Promise.resolve({ hash }) });
  assert.equal(get.status, 503);
  const error = await get.json();
  assert.equal(error.code, 'SnapshotCapacityReadError'); assert.equal(error.snapshotBlock, String(BLOCK));
  assert.equal(error.status, undefined);
  const ask = await POST(new Request('http://localhost/api/agent/ask', { method: 'POST', body: JSON.stringify({ intentHash: hash, question: "Why can't this intent settle?" }) }));
  assert.equal(ask.status, 503); assert.equal((await ask.json()).answer, undefined);
  assert.ok(rpcCalls(calls).length >= 4, 'Both API failures must reach historical USDC reads');
  for (const c of rpcCalls(calls)) assert.equal(c.params?.[1], numberToHex(BLOCK));
});

test('unavailable historical Graph lookup fails the API instead of inventing UNKNOWN or CLOSED', async t => {
  const calls = transport(t, snapshot(true), { graphError: true });
  const response = await GET(new Request(`http://localhost/api/agent/diagnose/${HASH}`), { params: Promise.resolve({ hash: HASH }) });
  assert.equal(response.status, 503); assert.equal((await response.json()).status, undefined);
  assert.equal(rpcCalls(calls).length, 0);
  const lookup = calls.find(c => c.query?.includes('IntentById'));
  assert.equal(lookup?.variables?.block, 100);
});

test('pruned history returns 503 with a named error instead of waiting for indexing', async t => {
  const calls = transport(t, snapshot(true), { historyPruned: true });
  const responses = [
    await GET(new Request(`http://localhost/api/agent/diagnose/${HASH}`), { params: Promise.resolve({ hash: HASH }) }),
    await POST(new Request('http://localhost/api/agent/ask', { method: 'POST', body: JSON.stringify({ intentHash: HASH, question: "Why can't this intent settle?" }) })),
  ];
  for (const response of responses) {
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.equal(result.code, 'SubgraphHistoryUnavailable');
    assert.equal(result.oldestAvailableBlock, '101');
    assert.equal(result.status, undefined); assert.equal(result.answer, undefined);
  }
  assert.equal(rpcCalls(calls).length, 0);
  assert.ok(calls.filter(c => c.query?.includes('IntentById')).every(c => c.variables?.block === 100));
});
