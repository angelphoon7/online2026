import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { REDIS_ENV_PAIRS } from '../../shared/redis-config.mjs';
import { durableStore, redisStore, storageMode, StorageUnavailable } from '../durable-store';
import { agentRateLimitStore } from '../agent/rate-limit';

function env(t: TestContext, overrides: Record<string, string> = {}) {
  const settings = { ...Object.fromEntries(REDIS_ENV_PAIRS.flat().map(k => [k, undefined])), STORAGE_BACKEND: undefined,
    NODE_ENV: 'development', VERCEL: undefined, AGENT_RATE_LIMIT_STORE: 'auto', STORAGE_NAMESPACE: 'config-fixture', ...overrides };
  for (const [key, value] of Object.entries(settings)) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}
for (const [urlKey, tokenKey] of REDIS_ENV_PAIRS) test(`storage and Agent auto detection use the same ${urlKey} pair`, async t => {
  env(t, { [urlKey]: 'https://redis.invalid', [tokenKey]: 'fixture-token' });
  assert.equal(storageMode(), 'redis'); assert.equal(agentRateLimitStore(), 'redis');
  t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(url), 'https://redis.invalid');
    assert.equal((init!.headers as Record<string, string>).authorization, 'Bearer fixture-token');
    return Response.json({ result: 'persisted' });
  });
  assert.equal(await durableStore().get('record'), 'persisted');
  assert.equal(await redisStore().get('record'), 'persisted');
});
test('incomplete provider credentials never silently select local files or memory', t => {
  env(t, { KV_REST_API_TOKEN: 'orphan-token' });
  assert.equal(storageMode(), 'redis');
  assert.throws(() => durableStore(), StorageUnavailable);
  assert.throws(() => agentRateLimitStore(), StorageUnavailable);
});
test('empty local template settings leave provider defaults usable in production', t => {
  env(t, { NODE_ENV: 'production', VERCEL: '1', REDIS_REST_URL: '', REDIS_REST_TOKEN: '',
    UPSTASH_REDIS_REST_URL: 'https://redis.invalid', UPSTASH_REDIS_REST_TOKEN: 'fixture-token' });
  assert.equal(storageMode(), 'redis'); assert.equal(agentRateLimitStore(), 'redis');
});
