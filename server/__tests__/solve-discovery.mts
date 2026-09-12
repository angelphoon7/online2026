import test from 'node:test';
import assert from 'node:assert/strict';
import { solveOnChain } from '../solve';
import { hashIntent } from '../../shared/intent';
import type { Intent, Hex } from '../../shared/intent';

const intent: Intent = { owner: '0xaaaa000000000000000000000000000000000001', offered: [1n], eventId: 1, sessionMask: 1n, sectionMask: 1n, exactCount: 1, mustShareSession: false, mustShareSection: false, mustBeAdjacent: false, maxNetPay: 0n, deadline: 1900000000n, nonce: 0n };
const hash = hashIntent(intent);
const missing = `0x${'12'.repeat(32)}` as Hex;
const pool = { kind: 'subgraph' as const, snapshotBlock: '100', liveIntents: 1, excluded: [] };

test('missing Graph intents fail before RPC access instead of falling back to logs', async () => {
  await assert.rejects(solveOnChain([hash, missing], new Map([[hash, intent]]), pool), { name: 'GraphIntentUnavailable' });
  await assert.rejects(solveOnChain([hash], undefined, pool), { name: 'GraphIntentUnavailable' });
});

test('Graph input cannot relabel a different signed intent with a requested hash', async () => {
  await assert.rejects(solveOnChain([hash], new Map([[hash, { ...intent, maxNetPay: 1n }]]), pool), { message: 'Committed intent hash mismatch' });
});
