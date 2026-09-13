import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REDIS_ENV_PAIRS, RedisConfigurationError, hasRedisConfiguration, resolveRedisConfiguration } from '../shared/redis-config.mjs';
import { checkHosting, hostingConfiguration, HostingCheckError } from './lib/hosting-check.mjs';

const settings = { VERCEL: '1', VERCEL_ENV: 'production', REDIS_REST_URL: 'https://redis.invalid', REDIS_REST_TOKEN: 'private-fixture-token' };
for (const [urlKey, tokenKey] of REDIS_ENV_PAIRS) test(`hosting accepts the complete ${urlKey} provider pair`, () => {
  const env = { [urlKey]: 'https://redis.invalid', [tokenKey]: 'fixture-token' };
  assert.equal(hasRedisConfiguration(env), true);
  assert.deepEqual(hostingConfiguration(env).redis, { ...resolveRedisConfiguration(env), urlKey, tokenKey });
});
test('provider defaults work alongside empty copied template settings', () => {
  const env = { REDIS_REST_URL: '', REDIS_REST_TOKEN: ' ', KV_REST_API_URL: 'https://kv.invalid', KV_REST_API_TOKEN: 'kv-token' };
  assert.equal(resolveRedisConfiguration(env).urlKey, 'KV_REST_API_URL');
});
test('explicit complete credentials take precedence without combining providers', () => {
  assert.equal(resolveRedisConfiguration({ ...settings, KV_REST_API_URL: 'https://kv.invalid', KV_REST_API_TOKEN: 'other-token' }).token, 'private-fixture-token');
});
test('partial, mixed and absent credentials fail before network work', async () => {
  const cases = [{}, { REDIS_REST_URL: 'https://redis.invalid', KV_REST_API_TOKEN: 'other-token' },
    { REDIS_REST_TOKEN: 'orphan-token', KV_REST_API_URL: 'https://kv.invalid', KV_REST_API_TOKEN: 'other-token' }];
  for (const env of cases) {
    assert.throws(() => resolveRedisConfiguration(env), RedisConfigurationError);
    await assert.rejects(checkHosting({ env, fetchImpl: () => { assert.fail('No request with incomplete settings'); } }), HostingCheckError);
  }
});
test('invalid or credential-bearing endpoints are rejected without echoing credentials', () => {
  for (const url of ['http://redis.invalid', 'https://user:private-fixture-token@redis.invalid', 'https://redis.invalid?token=private-fixture-token', 'https://redis.invalid#private-fixture-token', 'private-fixture-token']) {
    assert.throws(() => resolveRedisConfiguration({ ...settings, REDIS_REST_URL: url }), error => error instanceof RedisConfigurationError && !error.message.includes('private-fixture-token'));
  }
});
test('hosted files, memory admission, untrusted IP settings and conflicting networks fail closed', () => {
  for (const overrides of [{ STORAGE_BACKEND: 'file' }, { AGENT_RATE_LIMIT_STORE: 'memory' }, { AGENT_IP_SOURCE: 'unidentified' },
    { AGENT_IP_SOURCE: 'trusted-proxy' }, { STORAGE_NAMESPACE: '../wrong' }, { NEXT_PUBLIC_DEPLOYMENT: 'local' },
    { DEPLOYMENT: 'local' }, { ARC_CHAIN_ID: '1' }, { READ_SOURCE: 'rpc' }]) {
    assert.throws(() => hostingConfiguration({ ...settings, ...overrides }), HostingCheckError);
  }
});
test('enabled signing features require scoped private configuration and cannot run in previews', () => {
  for (const overrides of [{ JUDGE_CONTROLS_ENABLED: 'true' }, { DEMO_TICKETS_ENABLED: 'true' },
    { VERCEL_ENV: 'preview', DEMO_TICKETS_ENABLED: 'true', PRIVATE_KEY: '0x' + '1'.repeat(64) },
    { NEXT_PUBLIC_ANTHROPIC_API_KEY: 'private-fixture-token' }]) {
    assert.throws(() => hostingConfiguration({ ...settings, ...overrides }), error => error instanceof HostingCheckError && !error.message.includes('private-fixture-token'));
  }
  hostingConfiguration({ ...settings, JUDGE_CONTROLS_ENABLED: 'true', DEMO_TICKETS_ENABLED: 'true', PRIVATE_KEY: '0x' + '1'.repeat(64),
    JUDGE_ACCESS_CODE: 'a'.repeat(24), JUDGE_ALLOWED_INTENT_HASHES: '0x' + 'a'.repeat(64) });
});
test('read and deterministic diagnosis configuration does not require a model or signer', () => {
  assert.ok(hostingConfiguration(settings));
});
test('preflight authenticates a bounded Lua write/read/delete probe in an isolated expiring key', async () => {
  let key;
  const result = await checkHosting({ env: settings, fetchImpl: async (url, init) => {
    assert.equal(url, settings.REDIS_REST_URL);
    assert.equal(init.headers.authorization, 'Bearer private-fixture-token');
    assert.ok(init.signal instanceof AbortSignal);
    const command = JSON.parse(init.body);
    assert.equal(command[0], 'EVAL'); assert.equal(command[2], 1);
    assert.match(command[1], /redis.call\('TIME'\)/);
    assert.match(command[1], /'PX', 30000/);
    assert.match(command[1], /redis.call\('DEL'/);
    key = command[3]; assert.match(key, /^reshuffle-arc-testnet:hosting-preflight:/);
    return Response.json({ result: [1, '1789250000', '100'] });
  } });
  assert.equal(result.redisWriteAndLua, 'PASS');
  assert.equal(result.hostedAcceptance, 'NOT_RUN', 'A build probe must never claim public app acceptance');
  assert.ok(!JSON.stringify(result).includes('private-fixture-token'));
});
for (const failure of ['transport', 'provider', 'read-only', 'malformed']) test(`Redis ${failure} failure blocks the build without leaking provider content`, async () => {
  await assert.rejects(checkHosting({ env: settings, fetchImpl: async () => {
    if (failure === 'transport') throw new Error('private-fixture-token');
    if (failure === 'provider') return Response.json({ error: 'private-fixture-token' }, { status: 503 });
    if (failure === 'read-only') return Response.json({ error: 'NOPERM private-fixture-token' });
    return Response.json({ result: [0] });
  } }), error => error instanceof HostingCheckError && !error.message.includes('private-fixture-token'));
});
test('preflight aborts a stalled provider before a deployment can proceed', async () => {
  // Keep the event loop alive while the native AbortSignal timeout is pending.
  const timer = setInterval(() => {}, 100);
  try {
    await assert.rejects(checkHosting({ env: settings, timeoutMs: 20, fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }) }), HostingCheckError);
  } finally { clearInterval(timer); }
});
test('the actual Vercel build cannot bypass the hosting dependency check', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.buildCommand, 'npm run hosting:check && npm run build');
});
