import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { keccak256, type Hex, type TransactionReceipt } from 'viem';
import { consumeQuota, FileStore, RedisRestStore, storageMode } from '../durable-store.js';
import { readJob, signingJob, SigningBusy } from '../signing-job.js';
import { saveChallenge, readChallenge, consumeChallenge } from '../claim-challenges.js';
import { readEvidence, saveEvidence } from '../evidence-store.js';

function env(t: TestContext, key: string, value: string) {
  const previous = process.env[key]; process.env[key] = value;
  t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
}
async function directory(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), 'reshuffle-state-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
test('independent storage instances allow exactly one CAS winner and enforce lease guards', async t => {
  const path = await directory(t), a = new FileStore(path), b = new FileStore(path);
  const outcomes = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).compareAndSet('one', null, String(i))));
  assert.equal(outcomes.filter(Boolean).length, 1);
  assert.ok(await b.get('one') !== null);
  assert.equal(await a.compareAndSet('lease', null, 'worker-1'), true);
  assert.equal(await b.compareAndSet('guarded', null, 'stale', { guard: { key: 'lease', value: 'worker-2' } }), false);
  assert.equal(await a.get('guarded'), null);
  assert.equal(await b.compareAndSet('guarded', null, 'fresh', { guard: { key: 'lease', value: 'worker-1' } }), true);
  assert.equal(await a.get('guarded'), 'fresh');
});
test('claim challenges survive a worker change and can only be consumed once', async t => {
  const path = await directory(t), a = new FileStore(path), b = new FileStore(path);
  await saveChallenge('signed message', { recipient: `0x${'a'.repeat(40)}`, expires: Date.now() + 60_000 }, a);
  const challenge = await readChallenge('signed message', b);
  assert.ok(challenge);
  const consumed = await Promise.all([consumeChallenge('signed message', challenge.raw, a), consumeChallenge('signed message', challenge.raw, b)]);
  assert.equal(consumed.filter(Boolean).length, 1);
  assert.equal(await readChallenge('signed message', a), null);
  await saveChallenge('expired message', { recipient: `0x${'a'.repeat(40)}`, expires: Date.now() - 1 }, a);
  assert.equal(await readChallenge('expired message', b), null);
});
test('shared claim allowance cannot be exceeded by concurrent workers', async t => {
  const path = await directory(t), a = new FileStore(path), b = new FileStore(path);
  const admitted = await Promise.all(Array.from({ length: 12 }, (_, i) => consumeQuota('claims', 3, 86_400_000, i % 2 ? a : b)));
  assert.equal(admitted.filter(Boolean).length, 3);
});
test('signed transaction retry after a lost broadcast response reuses bytes and resumes the second step', async t => {
  const path = await directory(t), a = new FileStore(path), b = new FileStore(path);
  let prepared = 0, firstWait = true;
  const sent: Hex[] = [], receipts = new Map<Hex, TransactionReceipt>();
  const io = (raw: Hex) => ({
    prepare: async () => { prepared++; return raw; },
    receipt: async (hash: Hex) => receipts.get(hash) ?? null,
    broadcast: async (raw: Hex) => { sent.push(raw); throw new Error('response lost'); },
    wait: async (hash: Hex) => {
      if (firstWait) { firstWait = false; throw new Error('worker timeout'); }
      const receipt = { status: 'success', transactionHash: hash, blockNumber: 123n } as TransactionReceipt;
      receipts.set(hash, receipt); return receipt;
    },
  });
  const execute = async (_plan: { signedBudget: string }, tx: Parameters<Parameters<typeof signingJob>[3]>[1]) => {
    await tx('revoke', io('0x0102')); await tx('commit', io('0x0304')); return { newHash: 'replacement' };
  };
  await assert.rejects(signingJob('issuer', 'budget-A', async () => ({ signedBudget: '-12000000' }), execute, a), /worker timeout/);
  const saved = await readJob<{ signedBudget: string }, unknown>('budget-A', b);
  assert.equal(saved?.plan.signedBudget, '-12000000');
  assert.deepEqual(saved?.steps.revoke, { raw: '0x0102', hash: keccak256('0x0102') });
  await assert.rejects(signingJob('issuer', 'different-claim', async () => ({}), async () => ({}), b), SigningBusy);
  const result = await signingJob('issuer', 'budget-A', async () => { throw new Error('must use saved plan'); }, execute, b);
  assert.deepEqual(result, { newHash: 'replacement' });
  assert.equal(prepared, 2);
  assert.deepEqual(sent, ['0x0102', '0x0102', '0x0304']);
  assert.equal(await a.get('signing:active:issuer'), null);
  assert.deepEqual(await signingJob('issuer', 'budget-A', async () => { throw new Error('no reinitialization'); }, async () => { throw new Error('no repeat mint/commit'); }, a), result);
});
test('a second worker cannot sign concurrently and a lost lease stops broadcast', async t => {
  const path = await directory(t), a = new FileStore(path), b = new FileStore(path);
  let resolveStarted!: () => void, release!: () => void;
  const started = new Promise<void>(r => { resolveStarted = r; }), pause = new Promise<void>(r => { release = r; });
  let broadcasts = 0;
  const first = signingJob('issuer', 'claim', async () => ({}), async (_, tx) => {
    return tx('mint', {
      prepare: async () => { resolveStarted(); await pause; return '0x0102'; },
      receipt: async () => null,
      broadcast: async () => { broadcasts++; },
      wait: async () => { throw new Error('must not wait'); },
    });
  }, a);
  await started;
  await assert.rejects(signingJob('issuer', 'claim', async () => ({}), async () => ({}), b), SigningBusy);
  const lease = await b.get('signing:lease:issuer'); assert.ok(lease);
  assert.equal(await b.compareAndSet('signing:lease:issuer', lease, 'new-worker'), true);
  release();
  await assert.rejects(first, SigningBusy);
  assert.equal(broadcasts, 0);
  assert.equal(await b.get('signing:lease:issuer'), 'new-worker');
  assert.equal(await b.get('signing:active:issuer'), 'claim');
});
test('evidence survives a new store instance and confirmed receipts cannot be overwritten', async t => {
  const path = await directory(t);
  env(t, 'STORAGE_BACKEND', 'file'); env(t, 'STORAGE_DIRECTORY', path); env(t, 'ALLOW_PERSISTENT_FILE_STORAGE', 'true');
  const evidence = await saveEvidence({ source: { kind: 'subgraph', snapshotBlock: 123n }, candidates: [] });
  assert.deepEqual(await readEvidence(evidence.id), evidence);
  const tx = `0x${'a'.repeat(64)}`;
  await saveEvidence({ ...evidence, transactionHash: tx, receipt: { confirmed: true } }, evidence.id);
  await assert.rejects(saveEvidence({ ...evidence, transactionHash: `0x${'b'.repeat(64)}`, receipt: { confirmed: true } }, evidence.id), /different confirmed receipt/);
  assert.equal((await readEvidence(evidence.id)).transactionHash, tx);
  assert.equal(await readEvidence('../.env'), null);
});
test('ephemeral production files fail closed; Redis commands are authenticated and provider errors are redacted', async t => {
  env(t, 'NODE_ENV', 'production'); env(t, 'STORAGE_BACKEND', 'file'); env(t, 'ALLOW_PERSISTENT_FILE_STORAGE', 'false');
  assert.throws(() => storageMode(), /Production requires/);
  env(t, 'ALLOW_PERSISTENT_FILE_STORAGE', 'true'); assert.equal(storageMode(), 'file');
  env(t, 'VERCEL', '1'); assert.throws(() => storageMode(), /Production requires/);
  const calls: { body: unknown[]; authorization: string }[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, init?: RequestInit) => { calls.push({ body: JSON.parse(init!.body as string), authorization: (init!.headers as Record<string, string>).authorization }); return Response.json({ result: 1 }); });
  const redis = new RedisRestStore('https://redis.example', 'secret-token', 'demo');
  assert.equal(await redis.compareAndSet('claim', null, 'saved', { ttlMs: 300, guard: { key: 'lease', value: 'worker' } }), true);
  assert.equal(calls[0].authorization, 'Bearer secret-token');
  assert.equal(calls[0].body[0], 'EVAL');
  assert.deepEqual(calls[0].body.slice(2), [2, 'demo:claim', 'demo:lease', 'absent', '', 'set', 'saved', 300, 'worker']);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'secret-token raw-signed-transaction' }, { status: 500 }));
  await assert.rejects(redis.get('claim'), e => e instanceof Error && !/secret-token|raw-signed/.test(e.message));
});
