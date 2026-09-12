// Captured-snapshot tests - step 9 of docs/RESHUFFLE_GRAPH_PLAN.md.
//
// Run with:  npx --yes tsx --conditions=react-server --test server/__tests__/snapshot-fixture.mts
//
// The other suites build snapshots by hand, which proves the diagnosis logic but skips the
// part most likely to break in practice: parsing what graph-node actually returns. These
// tests run fixtures/snapshot-<block>.json - the untouched response body captured by
// scripts/capture-snapshot.mjs - through the REAL getPoolSnapshot, so a mapping or decoding
// change fails a test here instead of surfacing at a demo.
//
// The fixture is real indexed data from Arc Testnet. Re-capture it after re-seeding; never
// hand-edit it, because an edited fixture stops being evidence that the parse path works.
//
// Payment capacity is injected (the subgraph does not index the token), so these tests touch
// no RPC and are deterministic.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getPoolSnapshot } from '../../shared/graph/snapshot';
import { hashIntent, fromGraph } from '../../shared/intent';
import type { Address, Hex } from '../../shared/intent';
import { diagnose } from '../agent/diagnose';
import { renderEvidence } from '../agent/template';
import { checkAnswer } from '../agent/guard';

const FIXTURES = 'fixtures';

/** Newest capture in fixtures/. Tests follow whatever was captured last, by design. */
function loadFixture() {
  const files = fs.existsSync(FIXTURES)
    ? fs.readdirSync(FIXTURES).filter((f) => f.startsWith('snapshot-') && f.endsWith('.json')).sort()
    : [];
  if (!files.length) return null;
  const file = path.join(FIXTURES, files[files.length - 1]);
  return { file, body: JSON.parse(fs.readFileSync(file, 'utf8')) as { block: number; data: unknown } };
}

const fixture = loadFixture();

/** Parse a response body through the real getPoolSnapshot, with fetch stubbed. */
async function parse(data: unknown) {
  // Historical captures predate id-based pagination. Adapt only the response order to the
  // current query, retaining every captured entity and its original metadata unchanged.
  const captured = data as { intents: { id: string }[]; tickets: { id: string }[] };
  const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const ordered = { ...captured, intents: [...captured.intents].sort(byId), tickets: [...captured.tickets].sort(byId) };
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: ordered }), { headers: { 'content-type': 'application/json' } })) as typeof fetch;
  try {
    return await getPoolSnapshot({ url: 'http://fixture.invalid/graphql' });
  } finally {
    globalThis.fetch = original;
  }
}

const USDC = 1_000_000n;
const generousCapacity = (owners: Address[], block: bigint) => ({
  block,
  usdcBalance: new Map(owners.map((o) => [o.toLowerCase() as Address, 10_000n * USDC])),
  usdcAllowance: new Map(owners.map((o) => [o.toLowerCase() as Address, 10_000n * USDC])),
});

// A missing fixture must not silently pass as a green suite - it means the evidence these
// tests exist to provide is absent.
test('a captured fixture is present', () => {
  assert.ok(fixture, 'no fixtures/snapshot-*.json — run: node scripts/capture-snapshot.mjs');
});

test('every intent in real indexed data re-hashes to its committed id', { skip: !fixture }, async () => {
  const snapshot = await parse(fixture!.body.data);
  const raw = (fixture!.body.data as { intents: unknown[] }).intents;

  // Trust rule 1, on real indexer output rather than a constructed example. If the mapping
  // ever decoded a field differently - an int256 read unsigned, a uint32 truncated, an array
  // reordered - these hashes would stop matching, and the pool would be quietly wrong.
  const mismatched = snapshot.excluded.filter((e) => e.reason === 'HASH_MISMATCH');
  assert.deepEqual(mismatched, [], 'no live intent may fail hash binding');

  // Nothing is lost between the response and the parse: every intent is either kept or
  // excluded with a named reason.
  assert.equal(snapshot.intents.length + snapshot.excluded.length, raw.length);
  assert.equal(snapshot.block.toString(), String(fixture!.body.block));
  assert.ok(snapshot.intents.length > 0, 'the captured pool must not be empty');
});

test('ticket metadata survives the parse for every escrowed ticket', { skip: !fixture }, async () => {
  const snapshot = await parse(fixture!.body.data);
  const raw = (fixture!.body.data as {
    tickets: { id: string; sessionId: number; sectionId: number; row: number; seat: number; depositor: string }[];
  }).tickets;

  assert.equal(snapshot.ticketMeta.size, raw.length);
  for (const ticket of raw) {
    const meta = snapshot.ticketMeta.get(BigInt(ticket.id));
    assert.ok(meta, `ticket #${ticket.id} lost in the parse`);
    // sessionId and sectionId index bit positions in a uint256 mask, so a value at or above
    // 256 would produce a ticket no predicate could ever accept. TicketNFT enforces this at
    // mint; the check here is that the parse does not corrupt it.
    assert.ok(meta.sessionId < 256 && meta.sectionId < 256, `class ids must stay below the mask width`);
    assert.equal(meta.sessionId, Number(ticket.sessionId));
    assert.equal(meta.sectionId, Number(ticket.sectionId));
    // row and seat keep the full uint16 range and are compared numerically.
    assert.equal(meta.row, Number(ticket.row));
    assert.equal(meta.seat, Number(ticket.seat));
    assert.equal(snapshot.depositor.get(BigInt(ticket.id)), ticket.depositor.toLowerCase());
  }
});

test('one altered field in real data is caught as a hash mismatch, and only that intent', { skip: !fixture }, async () => {
  const data = JSON.parse(JSON.stringify(fixture!.body.data)) as {
    intents: { id: string; maxNetPay: string }[];
  };
  const victim = data.intents[0];
  const original = victim.maxNetPay;
  // The smallest lie an indexer could tell about a signed field: one unit of USDC.
  victim.maxNetPay = (BigInt(original) + 1n).toString();

  const snapshot = await parse(data);
  const mismatched = snapshot.excluded.filter((e) => e.reason === 'HASH_MISMATCH');

  assert.equal(mismatched.length, 1, 'exactly the tampered intent must be rejected');
  assert.equal(mismatched[0].id.toLowerCase(), victim.id.toLowerCase());
  assert.ok(
    !snapshot.intents.some((i) => i.hash.toLowerCase() === victim.id.toLowerCase()),
    'a tampered intent must never reach the solver'
  );
});

test('maxNetPay parses as signed, and a negative limit still binds to its hash', () => {
  // No intent in the captured pool carries a negative limit, so the signed path is exercised
  // here directly. It is the field most likely to be decoded wrongly - read unsigned, an
  // int256 of -12.5 USDC becomes an astronomically large positive ceiling, which would turn a
  // seller with a price floor into a buyer who will pay anything.
  const graph = {
    id: '0x' as Hex,
    // Lowercase, as graph-node returns addresses. viem rejects a mixed-case address that
    // fails its EIP-55 checksum, so a normalising step anywhere in the read path would be
    // load-bearing; the subgraph emits lowercase and fromGraph passes it straight through.
    owner: '0xaaaa000000000000000000000000000000000001',
    eventId: 1,
    offered: ['7', '8'],
    sessionMask: '2',
    sectionMask: '1',
    exactCount: 2,
    mustShareSession: true,
    mustShareSection: true,
    mustBeAdjacent: true,
    maxNetPay: '-12500000',
    deadline: '1789790400',
    nonce: '3',
  };

  const intent = fromGraph(graph);
  assert.equal(intent.maxNetPay, -12_500_000n, 'a negative signed limit must stay negative');
  assert.ok(intent.maxNetPay < 0n);
  // Order matters to the hash: `offered` is hashed positionally.
  assert.deepEqual(intent.offered, [7n, 8n]);

  const hash = hashIntent(intent);
  assert.match(hash, /^0x[0-9a-f]{64}$/);
  // Same struct, opposite sign: the commitment must differ, or the sign is not actually bound.
  assert.notEqual(hash, hashIntent({ ...intent, maxNetPay: 12_500_000n }));
});

test('a real intent diagnoses to a named status whose sentence passes the guard', { skip: !fixture }, async () => {
  const snapshot = await parse(fixture!.body.data);
  const subject = snapshot.intents[0];
  const capacity = generousCapacity(snapshot.intents.map((i) => i.owner as Address), snapshot.block);

  const evidence = await diagnose(snapshot, subject.hash, capacity);

  assert.ok(
    ['SETTLEABLE', 'NOT_FOUND_WITHIN_BOUND', 'EXCLUDED', 'CLOSED', 'UNKNOWN'].includes(evidence.status),
    `unexpected status ${evidence.status}`
  );
  // Every claim in the evidence belongs to the block the fixture was captured at.
  assert.equal(evidence.block, String(fixture!.body.block));
  assert.equal(evidence.intent, subject.hash);

  if (evidence.status === 'NOT_FOUND_WITHIN_BOUND') {
    // The funnel must be internally consistent: counts never increase down the stages.
    const counts = evidence.supply!.stages.map((s) => s.remaining);
    for (let i = 1; i < counts.length; i++) {
      assert.ok(counts[i] <= counts[i - 1], `stage ${evidence.supply!.stages[i].stage} cannot exceed the one before it`);
    }
    assert.equal(evidence.supply!.need, subject.exactCount);
    // Every relaxation is a single change, re-run through the solver.
    for (const relaxation of evidence.relaxations) {
      assert.ok(relaxation.change.length > 0);
      if (!relaxation.found) assert.equal(relaxation.targetNetPay, null);
      if (relaxation.found) assert.ok(relaxation.participantCount! >= 2);
    }
  }

  // The deterministic sentence is what a judge sees without an Anthropic key, and it is the
  // guard's fallback - so it has to satisfy the same rules the model is held to.
  const sentence = renderEvidence(evidence);
  assert.match(sentence, new RegExp(`^At Arc Testnet block #${fixture!.body.block},`));
  assert.equal(
    checkAnswer(sentence, [{ tool: 'diagnose_intent', input: { intentHash: subject.hash }, output: evidence }], evidence.block),
    null,
    'the deterministic sentence must pass the guard it backstops'
  );
});

test('diagnosing the same real intent twice gives the same answer', { skip: !fixture }, async () => {
  // The solver is required to be deterministic given the same inputs. If it is not, an
  // evidence chain proves nothing: a judge re-running a diagnosis would see it change.
  const snapshot = await parse(fixture!.body.data);
  const subject = snapshot.intents[0];
  const capacity = generousCapacity(snapshot.intents.map((i) => i.owner as Address), snapshot.block);

  const first = await diagnose(snapshot, subject.hash, capacity);
  const second = await diagnose(snapshot, subject.hash, capacity);

  // runtimeMs is a measurement, not a finding, so it is expected to differ.
  const { runtimeMs: _a, ...a } = first;
  const { runtimeMs: _b, ...b } = second;
  assert.deepEqual(a, b);
});
