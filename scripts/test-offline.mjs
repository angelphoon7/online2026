import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLifecycle, checkNonceUnchanged } from './lib/offline-proof.mjs';
import { solverEnvironment } from './offline-demo.mjs';

const lifecycle = () => ({
  closure: { exitCode: 0, requestedAt: '2026-09-10T01:00:00Z', exitedAt: '2026-09-10T01:00:01Z', signingServerClosedAt: '2026-09-10T01:00:02Z', authorizations: ['0xa', '0xb', '0xc'].map(owner => ({ owner })) },
  participantProcess: { pid: 101, exitCode: 0, exitedAt: '2026-09-10T01:00:03Z' },
  solverProcess: { pid: 202, startedAt: '2026-09-10T01:00:04Z' },
});

test('solver cannot begin before browser, local signer server and participant process exit', () => {
  assert(checkLifecycle(lifecycle()));
  for (const date of ['2026-09-10T00:59:59Z', '2026-09-10T01:00:01Z', '2026-09-10T01:00:02Z']) {
    const record = lifecycle(); record.solverProcess.startedAt = date;
    assert.throws(() => checkLifecycle(record), /after browser and participant/);
  }
});

test('missing exit confirmation, timestamps or distinct process rejects the proof', () => {
  for (const mutate of [r => { r.closure.exitCode = null; }, r => { r.participantProcess.exitCode = 1; }, r => { r.solverProcess.startedAt = ''; }, r => { r.solverProcess.pid = 101; }]) {
    const record = lifecycle(); mutate(record); assert.throws(() => checkLifecycle(record));
  }
});

test('any new participant transaction or altered starting nonce invalidates inactivity evidence', () => {
  checkNonceUnchanged(12, 12, 12);
  assert.throws(() => checkNonceUnchanged(12, 12, 13), /another transaction/);
  assert.throws(() => checkNonceUnchanged(11, 12, 12), /differs from chain/);
});

test('solver receives only its key, RPC and explicit OS configuration', () => {
  const env = solverEnvironment({ PATH: 'bin', ARC_RPC: 'http://rpc', PRIVATE_KEY: 'alice', SEED_B_PRIVATE_KEY: 'bob', SEED_C_PRIVATE_KEY: 'carol', SEED_D_PRIVATE_KEY: 'solver', NEXT_PUBLIC_PRIVATE_KEY: 'do-not-copy', UNRELATED_SECRET: 'secret', NODE_OPTIONS: '--import=participant-signer' });
  assert.deepEqual(env, { PATH: 'bin', ARC_RPC: 'http://rpc', SOLVER_PRIVATE_KEY: 'solver' });
});
