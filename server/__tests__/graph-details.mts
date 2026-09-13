import test from 'node:test';
import assert from 'node:assert/strict';
import { readGraphDetails, graphManifestLink, subgraphStudioLink } from '../../lib/graph-details';
import { hashIntent, type Intent } from '../../shared/intent';

const intent: Intent = { owner: `0x${'1'.repeat(40)}`, offered: [1n, 2n], eventId: 1, sessionMask: 1n, sectionMask: 1n, exactCount: 2,
  mustShareSection: true, mustShareSession: true, mustBeAdjacent: true, maxNetPay: 0n, deadline: 200n, nonce: 1n };
const hash = hashIntent(intent), other = `0x${'2'.repeat(64)}`;
const record = () => JSON.parse(JSON.stringify({ ...intent, id: hash, state: 'LIVE', committedTx: other }, (_, value) => typeof value === 'bigint' ? String(value) : value));
const meta = () => ({ deployment: 'QmFixture', hasIndexingErrors: false, block: { number: 100, hash: other, timestamp: 100 } });
const selection = { kind: 'intent' as const, hash, minBlock: '100' };

test('Graph intent details use the proxy, preserve the minimum block, and verify the full signed hash', async t => {
  t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(url, '/api/graph'); assert.deepEqual(JSON.parse(init!.body as string).variables, { id: hash, at: { number_gte: 100 } });
    return Response.json({ data: { _meta: meta(), intent: record() } });
  });
  assert.equal((await readGraphDetails(selection)).intent?.id, hash);
});
test('an altered indexed intent is rejected instead of displaying it under another hash', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: { _meta: meta(), intent: { ...record(), maxNetPay: '1' } } }));
  await assert.rejects(readGraphDetails(selection), /do not match the selected hash/);
});
test('Graph details refuse indexing errors, stale blocks, and missing records', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ data: { _meta: { ...meta(), hasIndexingErrors: true }, intent: record() } }));
  await assert.rejects(readGraphDetails(selection), { name: 'SubgraphIndexingError' });
  fetch.mock.mockImplementation(async () => Response.json({ data: { _meta: { ...meta(), block: { ...meta().block, number: 99 } }, intent: record() } }));
  await assert.rejects(readGraphDetails(selection), { name: 'SubgraphLagError' });
  fetch.mock.mockImplementation(async () => Response.json({ data: { _meta: meta(), intent: null } }));
  await assert.rejects(readGraphDetails(selection), /not found/);
});
test('settlements are queried by transaction hash and refuse incomplete participants', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async (_: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(JSON.parse(init!.body as string).variables.hash, other);
    return Response.json({ data: { _meta: meta(), settlements: [{ id: `${other}00000000`, txHash: other, participantCount: '1', intents: [{ id: hash }] }] } });
  });
  assert.equal((await readGraphDetails({ kind: 'settlement', hash: other, minBlock: '100' })).settlements?.length, 1);
  fetch.mock.mockImplementation(async () => Response.json({ data: { _meta: meta(), settlements: [{ id: other, txHash: other, participantCount: '2', intents: [{ id: hash }] }] } }));
  await assert.rejects(readGraphDetails({ kind: 'settlement', hash: other, minBlock: '100' }), /incomplete/);
});
test('invalid hash input cannot issue a Graph query', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected query'); });
  await assert.rejects(readGraphDetails({ ...selection, hash: 'not-a-hash' }), /Invalid Graph record/);
  assert.equal(fetch.mock.callCount(), 0);
});
test('project links derive the Studio project and keep invalid manifest values out of URLs', () => {
  assert.equal(subgraphStudioLink('https://api.studio.thegraph.com/query/123/example/v1.0.0'), 'https://thegraph.com/studio/subgraph/example/');
  assert.equal(subgraphStudioLink('https://api.studio.thegraph.com.attacker.invalid/query/123/example/v1.0.0'), null);
  assert.equal(graphManifestLink('../example'), null);
});
