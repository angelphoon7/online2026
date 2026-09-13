import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { getPoolSnapshot } from '../../shared/graph/snapshot';
import { readGraphPages } from '../../shared/graph/pages';
import { POOL_SNAPSHOT } from '../../shared/graph/queries';
import { hashIntent, type Intent, type Hex } from '../../shared/intent';
import { marketSnapshotFromGraph } from '../market-graph';
import { graphIntents, graphPool } from '../solve-graph';
import { poolOverview } from '../agent/overview';
import { GET as marketGet } from '../../app/api/market/route';
import { POST as solvePost } from '../../app/api/solve/route';
import { POST as solvePoolPost } from '../../app/api/solve/pool/route';
import { GET as diagnoseGet } from '../../app/api/agent/diagnose/[hash]/route';
import { POST as askPost } from '../../app/api/agent/ask/route';
import { MarketFreshness } from '../../lib/market-freshness';

const A = `0x${'a'.repeat(40)}` as const;
const blockHash = `0x${'ab'.repeat(32)}`;
const tx = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const meta = () => ({ block: { number: 100, timestamp: '100', hash: blockHash }, deployment: 'QmFixture', hasIndexingErrors: false });
type Row = Record<string, unknown> & { id: string };
type Data = { _meta: ReturnType<typeof meta>; intents: Row[]; tickets: Row[]; settlements: Row[] };
type Call = { query: string; variables: Record<string, unknown>; signal?: AbortSignal };
const ids = (rows: Row[]) => [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function makeIntent(n: number, extra: Partial<Intent> = {}): Row {
  const value: Intent = { owner: A, offered: [BigInt(n)], eventId: 1, sessionMask: 1n, sectionMask: 1n,
    exactCount: 1, mustBeAdjacent: false, mustShareSection: false, mustShareSession: false,
    maxNetPay: 0n, deadline: 200n, nonce: BigInt(n), ...extra };
  return JSON.parse(JSON.stringify({ ...value, id: hashIntent(value), state: 'LIVE', committedTx: tx(n),
    committedAtBlock: '90', offeredTickets: value.offered.map(id => ({ id: String(id), escrowed: true, depositor: A, redeemed: false })) },
  (_, v) => typeof v === 'bigint' ? String(v) : v));
}
const ticket = (n: number): Row => ({ id: String(n), eventId: 1, sessionId: 0, sectionId: n % 4, row: 1, seat: n,
  owner: A, depositor: A, escrowed: true, redeemed: false });
function fixture(count: number): Data {
  return { _meta: meta(), intents: Array.from({ length: count }, (_, n) => makeIntent(n + 1)),
    tickets: Array.from({ length: count }, (_, n) => ticket(n + 1)),
    // Distinct event IDs, including two settlements in the same transaction/block.
    settlements: Array.from({ length: count }, (_, n) => ({ id: `${tx(Math.floor(n / 2) + 1)}${(n % 2).toString(16).padStart(8, '0')}`, txHash: tx(Math.floor(n / 2) + 1), blockNumber: String(80 + n % 2), participantCount: '2' })) };
}

function transport(t: TestContext, data: Data, modify?: (page: Data, call: Call, n: number) => void) {
  const calls: Call[] = [];
  for (const [key, value] of Object.entries({ SUBGRAPH_URL: 'https://pagination.invalid', READ_SOURCE: 'graph', ANTHROPIC_API_KEY: '',
    AGENT_TRUST_PROXY: 'true', AGENT_ASK_TIMEOUT_MS: '10000', AGENT_DIAGNOSE_TIMEOUT_MS: '10000' })) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(url), 'https://pagination.invalid', 'discovery must not fall back to RPC or call a model');
    const call: Call = { ...JSON.parse(init!.body as string), signal: init?.signal ?? undefined }; calls.push(call);
    const page = { _meta: structuredClone(data._meta) } as Data;
    for (const name of ['intents', 'tickets', 'settlements'] as const) {
      if (call.variables[`with_${name}`]) page[name] = ids(data[name]).filter(row => row.id > (call.variables[`${name}After`] as string)).slice(0, call.variables.first as number);
    }
    modify?.(page, call, calls.length);
    return Response.json({ data: page });
  });
  return calls;
}

for (const count of [0, 999, 1000, 1001, 2000, 2001]) test(`market reads all ${count} rows in every root without losing same-block commitments`, async t => {
  const data = fixture(count), calls = transport(t, data);
  const market = await marketSnapshotFromGraph(100n);
  assert.equal(market.blockNumber, '100'); assert.equal(market.tickets.length, count);
  assert.equal(market.intents.length, count); assert.equal(market.settlements.length, count);
  assert.deepEqual(market.tickets.map(row => row.tokenId), data.tickets.map(row => row.id), 'numeric ticket presentation order survives lexical pagination');
  assert.deepEqual(new Set(market.intents.map(i => i.hash)), new Set(data.intents.map(i => i.id)));
  assert.deepEqual(market.hashMismatched, []);
  assert.equal(calls.length, Math.floor(count / 1000) + 1);
  assert.deepEqual(calls[0].variables.at, { number_gte: 100 });
  for (const call of calls.slice(1)) assert.deepEqual(call.variables.at, { hash: blockHash });
  for (const call of calls) assert.equal((call.query.match(/block: \$at/g) ?? []).length, 4);
  assert.ok(market.settlements.every((s, index) => index === 0 || BigInt(market.settlements[index - 1].block) >= BigInt(s.block)));
});

test('roots finish independently and a full root still probes the next page', async t => {
  const data = fixture(5); data.intents = data.intents.slice(0, 1); data.tickets = data.tickets.slice(0, 2);
  const calls = transport(t, data);
  const market = await marketSnapshotFromGraph(100n, { pageSize: 2 });
  assert.equal(market.intents.length, 1); assert.equal(market.tickets.length, 2); assert.equal(market.settlements.length, 5);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].variables.with_intents, false); assert.equal(calls[1].variables.with_tickets, true);
  assert.equal(calls[2].variables.with_tickets, false); assert.equal(calls[2].variables.with_settlements, true);
  assert.equal(calls[1].variables.ticketsAfter, '2');
});

test('solver and Agent snapshots include later tickets and every commitment beyond 1000', async t => {
  const data = fixture(1001); data.tickets.push(...Array.from({ length: 1000 }, (_, n) => ticket(n + 1002)));
  const target = makeIntent(5000, { offered: [999n], deadline: 99n });
  data.intents.push(target);
  const calls = transport(t, data);
  const snapshot = await getPoolSnapshot({ minBlock: 100n });
  assert.equal(snapshot.intents.length, 1001); assert.equal(snapshot.ticketMeta.size, 2001);
  assert.equal(snapshot.ticketMeta.get(999n)?.sectionId, 3);
  assert.deepEqual(snapshot.excluded.map(e => ({ id: e.id, reason: e.reason })), [{ id: target.id, reason: 'EXPIRED' }]);
  const pool = poolOverview(snapshot);
  assert.equal(pool.liveIntents, 1001); assert.equal(pool.escrowedTickets, 2001);
  assert.deepEqual(pool.excludedByReason, { EXPIRED: 1 });
  const requested = ids(data.intents).at(-1)!.id as Hex;
  const discovery = await graphIntents([requested], 100n);
  if (requested === target.id) assert.equal(discovery.committed.size, 0);
  else assert.equal(discovery.committed.get(requested)?.nonce.toString(), data.intents.find(i => i.id === requested)!.nonce);
  assert.equal(discovery.source.liveIntents, 1001);
  // Full discovery does not silently raise the separately published execution search bound.
  await assert.rejects(graphPool(100n), { message: 'Live pool exceeds the 256-intent service limit. No partial pool was searched.' });
  assert.ok(calls.length >= 6);
  const response = await diagnoseGet(new Request(`http://localhost/api/agent/diagnose/${target.id}?minBlock=100`, { headers: { 'x-forwarded-for': '192.0.2.150' } }), { params: Promise.resolve({ hash: target.id }) });
  assert.equal(response.status, 200);
  const evidence = await response.json();
  assert.equal(evidence.intent, target.id); assert.equal(evidence.block, '100'); assert.equal(evidence.exclusion.reason, 'EXPIRED');
});

test('an offered ticket on a later page still enforces event binding', async t => {
  const data = fixture(1001); data.intents = [makeIntent(1, { offered: [999n] })];
  data.tickets.find(row => row.id === '999')!.eventId = 2;
  transport(t, data);
  const result = await getPoolSnapshot();
  assert.equal(result.intents.length, 0);
  assert.equal(result.excluded[0].reason, 'WRONG_EVENT'); assert.equal(result.ticketMeta.size, 1001);
});

test('Agent diagnoses the final intent after page 1000 without treating it as unknown', async t => {
  const data = fixture(0);
  data.intents = Array.from({ length: 1001 }, (_, n) => makeIntent(n + 1, { deadline: 99n }));
  data.tickets = Array.from({ length: 1001 }, (_, n) => ticket(n + 1));
  const last = ids(data.intents).at(-1)!.id, calls = transport(t, data);
  const response = await diagnoseGet(new Request('http://localhost?minBlock=100', { headers: { 'x-forwarded-for': '192.0.2.153' } }), { params: Promise.resolve({ hash: last }) });
  assert.equal(response.status, 200);
  const evidence = await response.json();
  assert.equal(evidence.intent, last); assert.equal(evidence.block, '100');
  assert.equal(evidence.status, 'EXCLUDED'); assert.equal(evidence.exclusion.reason, 'EXPIRED');
  assert.equal(calls.length, 2); assert.ok(calls.every(call => call.query.includes('PoolSnapshot')));
});

for (const changed of ['block', 'hash', 'timestamp', 'deployment', 'indexing'] as const) test(`pagination refuses ${changed} changes on a later page`, async t => {
  transport(t, fixture(3), (page, _, n) => {
    if (n !== 2) return;
    if (changed === 'block') page._meta.block.number++;
    if (changed === 'hash') page._meta.block.hash = tx(999);
    if (changed === 'timestamp') page._meta.block.timestamp = '101';
    if (changed === 'deployment') page._meta.deployment = 'QmOther';
    if (changed === 'indexing') page._meta.hasIndexingErrors = true;
  });
  await assert.rejects(getPoolSnapshot({ pageSize: 2, minBlock: 100n }), { name: changed === 'indexing' ? 'SubgraphIndexingError' : 'SubgraphSnapshotChanged' });
});

for (const fault of ['repeat', 'reverse', 'missing-list', 'oversized', 'missing-hash'] as const) test(`pagination refuses ${fault} pages without a partial result`, async t => {
  transport(t, fixture(3), (page, call, n) => {
    if (fault === 'missing-hash') { delete (page._meta.block as { hash?: string }).hash; return; }
    if (fault === 'reverse' && n === 1) page.tickets.reverse();
    if (n !== 2) return;
    if (fault === 'repeat') page.tickets = [{ ...ticket(2), id: call.variables.ticketsAfter as string }];
    if (fault === 'missing-list') delete (page as Partial<Data>).tickets;
    if (fault === 'oversized') page.tickets = [ticket(3), ticket(4), ticket(5)];
  });
  await assert.rejects(getPoolSnapshot({ pageSize: 2 }), { name: 'SubgraphPaginationError' });
});

test('page budget exhaustion is named and never returned as a successful prefix', async t => {
  const calls = transport(t, fixture(3));
  await assert.rejects(getPoolSnapshot({ first: 2, maxPages: 1 }), { name: 'SubgraphPageLimit' });
  assert.equal(calls.length, 1);
});

test('nested offered-ticket cap cannot become a false missing-ticket diagnosis', async t => {
  const data = fixture(0), offered = Array.from({ length: 1001 }, (_, n) => BigInt(n + 1));
  data.intents = [makeIntent(1, { offered })];
  data.intents[0].offeredTickets = (data.intents[0].offeredTickets as Row[]).slice(0, 1000);
  transport(t, data);
  await assert.rejects(getPoolSnapshot(), { name: 'SubgraphPaginationError' });
});

test('page fetch errors propagate instead of making the last page look empty', async t => {
  const calls = transport(t, fixture(3), (_, __, n) => { if (n === 2) throw new Error('fixture page unavailable'); });
  await assert.rejects(getPoolSnapshot({ pageSize: 2 }), { message: 'fixture page unavailable' });
  assert.equal(calls.length, 2);
});

test('overall pagination timeout aborts a hung page and caller cancellation keeps its reason', async t => {
  let aborted = false, reads = 0;
  t.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    reads++;
    return new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => { aborted = true; reject(init!.signal!.reason); }, { once: true }));
  });
  // The keepalive only keeps node:test alive while AbortSignal's unref'ed timer runs.
  const keepalive = setInterval(() => {}, 1000); t.after(() => clearInterval(keepalive));
  await assert.rejects(readGraphPages(POOL_SNAPSHOT, { intents: '0x', tickets: '' }, { url: 'https://pagination.invalid', timeoutMs: 20 }), { name: 'SubgraphReadTimeout' });
  assert.equal(aborted, true);
  const reason = new Error('caller left'), controller = new AbortController(); controller.abort(reason);
  await assert.rejects(getPoolSnapshot({ url: 'https://pagination.invalid', signal: controller.signal }), error => error === reason);
  assert.equal(reads, 1);
});

test('pagination failure leaves the receipt floor pending and refuses agent answers', async t => {
  const data = fixture(1000);
  transport(t, data, (page, call, n) => { if (n === 2) page.tickets = [{ ...ticket(1), id: call.variables.ticketsAfter as string }]; });
  const state = new MarketFreshness(async (_, floor) => marketSnapshotFromGraph(floor), async () => {});
  state.requireBlock(100n);
  assert.equal(await state.refresh(), false);
  assert.equal(state.getSnapshot().market, null); assert.equal(state.getSnapshot().indexingBlock, 100n);
  assert.match(state.getSnapshot().error, /^SubgraphPaginationError:/);
  assert.equal(state.canAnswer(state.getSnapshot().revision, '100'), false);
});

for (const route of ['market', 'solve', 'pool', 'diagnose', 'ask'] as const) test(`${route} route returns a named read error instead of partial pool evidence`, async t => {
  const data = fixture(1000);
  transport(t, data, (page, call, n) => { if (n === 2) page.tickets = [{ ...ticket(1), id: call.variables.ticketsAfter as string }]; });
  const target = data.intents[0].id;
  const post = (body: unknown) => new Request('http://localhost', { method: 'POST', headers: { 'x-forwarded-for': '192.0.2.151' }, body: JSON.stringify(body) });
  const response = route === 'market' ? await marketGet(new Request('http://localhost/api/market?minBlock=100'))
    : route === 'solve' ? await solvePost(post({ intentHashes: [target, data.intents[1].id], minBlock: '100' }))
    : route === 'pool' ? await solvePoolPost(post({ minBlock: '100' }))
    : route === 'diagnose' ? await diagnoseGet(new Request('http://localhost?minBlock=100', { headers: { 'x-forwarded-for': '192.0.2.152' } }), { params: Promise.resolve({ hash: target }) })
    : await askPost(post({ intentHash: target, question: 'What is in the pool?', minBlock: '100' }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.code, 'SubgraphPaginationError');
  for (const field of ['answer', 'evidence', 'proposal', 'intents', 'tickets']) assert.equal(body[field], undefined);
});
