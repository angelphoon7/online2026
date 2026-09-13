import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowedIntent, allowReplacement, authenticated, createJudgeSession, judgeControlsEnabled, requireSameOrigin, SESSION_COOKIE } from '../judge-access.js';
import { FileStore } from '../durable-store.js';
import { GET as budgetGET, POST as budgetPOST } from '../../app/api/demo/budget/route.js';
import { POST as revokePOST } from '../../app/api/demo/revoke/route.js';
import { POST as login, DELETE as logout } from '../../app/api/demo/session/route.js';
import { describeGroups, validateCatalog } from '../judging-demo.js';
import { DEPLOYMENT } from '../../lib/deployment.js';
import type { Snapshot } from '../../shared/graph/index.js';
import type { Hex } from 'viem';

const hash = (digit: string) => `0x${digit.repeat(64)}` as Hex;
const code = 'fixture-access-code-with-enough-characters';
function env(t: TestContext, key: string, value: string) {
  const old = process.env[key]; process.env[key] = value;
  t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
}
async function setup(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), 'reshuffle-auth-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  env(t, 'STORAGE_BACKEND', 'file'); env(t, 'STORAGE_DIRECTORY', path); env(t, 'NODE_ENV', 'development');
  env(t, 'JUDGE_ACCESS_CODE', code); env(t, 'JUDGE_CONTROLS_ENABLED', 'true'); env(t, 'JUDGE_ALLOWED_INTENT_HASHES', hash('a'));
  return path;
}
const request = (method: string, body?: unknown, cookie?: string, origin = 'http://judge.example') => new Request('http://judge.example/api/demo/budget', { method, headers: { origin, ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
test('unauthenticated budget listing, budget edits and revocation fail before any network access', async t => {
  await setup(t); let network = 0;
  t.mock.method(globalThis, 'fetch', async () => { network++; throw new Error('must not read RPC or Graph'); });
  assert.equal((await budgetGET(request('GET'))).status, 401);
  assert.equal((await budgetPOST(request('POST', { intentHash: hash('a'), maxNetPay: '1' }))).status, 401);
  assert.equal((await revokePOST(request('POST', { intentHash: hash('a') }))).status, 401);
  assert.equal(network, 0);
});
test('login issues an HttpOnly session, enforces origin, supports another worker and revokes on logout', async t => {
  const path = await setup(t);
  const response = await login(request('POST', { code }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.doesNotMatch(cookie, new RegExp(code));
  const tokenCookie = cookie.split(';')[0], authenticatedRequest = request('GET', undefined, tokenCookie);
  assert.equal(await authenticated(authenticatedRequest, new FileStore(join(path, 'reshuffle-arc-testnet'))), true);
  assert.equal(await authenticated(request('GET', undefined, `${SESSION_COOKIE}=${'f'.repeat(64)}`)), false);
  assert.equal((await budgetPOST(request('POST', {}, tokenCookie, 'http://attacker.example'))).status, 403);
  assert.throws(() => requireSameOrigin(new Request('http://judge.example/api/demo/budget')), /from this app/);
  assert.equal((await logout(request('DELETE', undefined, tokenCookie))).status, 200);
  assert.equal(await authenticated(authenticatedRequest), false);
});
test('access-code rotation and expiry invalidate previously authenticated sessions', async t => {
  await setup(t);
  const token = await createJudgeSession(code), req = request('GET', undefined, `${SESSION_COOKIE}=${token}`);
  assert.equal(await authenticated(req), true);
  process.env.JUDGE_ACCESS_CODE = 'different-access-code-with-enough-characters';
  assert.equal(await authenticated(req), false);
  process.env.JUDGE_ACCESS_CODE = code;
  const now = Date.now(); t.mock.method(Date, 'now', () => now + 3_600_001);
  assert.equal(await authenticated(req), false);
});
test('only exact allowed hashes and their recorded replacements are editable; removing the root removes descendants', async t => {
  await setup(t);
  assert.equal(await allowedIntent(hash('a')), hash('a'));
  assert.equal(await allowedIntent(hash('b')), null);
  await allowReplacement(hash('b'), hash('a'));
  assert.equal(await allowedIntent(hash('b')), hash('a'));
  process.env.JUDGE_ALLOWED_INTENT_HASHES = hash('c');
  assert.equal(await allowedIntent(hash('a')), null);
  assert.equal(await allowedIntent(hash('b')), null);
  env(t, 'JUDGE_CONTROLS_ENABLED', 'false'); assert.equal(judgeControlsEnabled(), false);
});
test('login allowance is shared and fails closed before more access guesses', async t => {
  await setup(t);
  for (let i = 0; i < 20; i++) await assert.rejects(createJudgeSession('wrong'), { status: 401 });
  await assert.rejects(createJudgeSession(code), { status: 429 });
});
test('demo status reports live availability, changed ownership, expiry and withdrawal instead of preloaded success', () => {
  const catalog = validateCatalog({ batch: 'test', chainId: DEPLOYMENT.chainId, registry: DEPLOYMENT.intentRegistry, groups: [{ name: 'single-date', hashes: [hash('a'), hash('b'), hash('c')] }] });
  const snapshot = { block: 10n, timestamp: 100n, intents: ['a', 'b', 'c'].map((d, i) => ({ hash: hash(d), owner: `0x${String(i + 1).repeat(40)}`, deadline: 200n, exactCount: 1 })), excluded: [] } as unknown as Snapshot;
  assert.equal(describeGroups(catalog, snapshot, 200n)[0].available, true);
  assert.equal(describeGroups(catalog, snapshot, 201n)[0].issues[0].reason, 'EXPIRED');
  snapshot.intents[2].owner = snapshot.intents[0].owner;
  assert.equal(describeGroups(catalog, snapshot, 150n)[0].issues[0].reason, 'REQUIRES_THREE_DISTINCT_USERS');
  snapshot.intents.pop(); snapshot.excluded.push({ id: hash('c'), reason: 'TICKET_NOT_IN_ESCROW' });
  assert.equal(describeGroups(catalog, snapshot, 150n)[0].issues[0].reason, 'TICKET_NOT_IN_ESCROW');
  assert.throws(() => validateCatalog({ ...catalog, chainId: 1 }), /does not match/);
});
