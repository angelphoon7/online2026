import test from 'node:test';
import assert from 'node:assert/strict';
import { observeIndexedTransfer, verifyIndexedTicket, verifySolveEvidence } from './lib/graph-acceptance.mjs';

const expected = { block: 100n, owner: '0xabc', tokenId: 10n, deployment: 'fixture' };
const indexed = () => ({ _meta: { hasIndexingErrors: false, deployment: 'fixture', block: { number: 100 } }, ticket: { id: '10', owner: '0xABC', escrowed: false, updatedAtBlock: '100' } });

test('receipt observation includes receipt checks, polling and query time', async () => {
  let clock = 25, calls = 0;
  const result = await observeIndexedTransfer({ expected, startedAt: 0, now: () => clock,
    sleep: async ms => { clock += ms; },
    read: async () => { clock += 50; return ++calls === 1 ? { errors: [{ message: 'has only indexed up to block number 99' }] } : { data: indexed() }; },
  });
  assert.equal(result.receiptToIndexedObservedMs, 925);
  assert.deepEqual(result.polls.map(p => p.status), ['behind', 'indexed']);
});

test('timeout does not become a successful latency sample', async () => {
  let clock = 0;
  await assert.rejects(observeIndexedTransfer({ expected, timeoutMs: 100, now: () => clock,
    read: async () => { clock = 101; return { data: indexed() }; },
  }), { message: 'ReceiptToIndexTimeout' });
});

test('index height alone cannot prove the ticket event was indexed', () => {
  for (const mutate of [d => { d.ticket.updatedAtBlock = '99'; }, d => { d.ticket.owner = '0xdef'; }, d => { d._meta.hasIndexingErrors = true; }, d => { d._meta.deployment = 'other'; }, d => { d._meta.block.number = 99; }]) {
    const data = indexed(); mutate(data);
    assert.throws(() => verifyIndexedTicket(data, expected), { name: 'AssertionError' });
  }
});

test('unrelated Graph failures are not treated as index lag', async () => {
  await assert.rejects(observeIndexedTransfer({ expected, read: async () => ({ errors: [{ message: 'Invalid query' }] }) }), { message: 'Unexpected Graph error during transfer observation' });
});

test('solver evidence rejects false provenance, stale floors and failed simulation', () => {
  const valid = { source: { kind: 'subgraph', subgraphEndpoint: 'fixture', snapshotBlock: '100' }, snapshotBlock: '100', pool: { snapshotBlock: '100' }, intentsConsidered: 2, candidatesFound: 1, candidates: [{}], excluded: [], candidatesExcluded: [], simulationResult: { success: true }, proposal: { intents: [{}, {}] }, transaction: { data: '0x1234' }, bounds: { maxParticipants: 4, maxCandidates: 100, timeoutMs: 2000 } };
  verifySolveEvidence(valid, 100n);
  for (const mutate of [e => { e.source.kind = 'rpc'; }, e => { e.snapshotBlock = '99'; }, e => { e.simulationResult.success = false; }, e => { e.candidates = []; }]) {
    const e = structuredClone(valid); mutate(e);
    assert.throws(() => verifySolveEvidence(e, 100n), { name: 'AssertionError' });
  }
  assert.throws(() => verifySolveEvidence(valid, 101n), { name: 'AssertionError' });
});
