import { randomUUID } from 'node:crypto';
import { resolveRedisConfiguration } from '../../shared/redis-config.mjs';

export class HostingCheckError extends Error {
  constructor(message) { super(message); this.name = 'HostingCheckError'; }
}

// Run before a Vercel build, against that deployment's injected environment.
// Never load the developer's env files: they can hide missing hosted settings.
export function hostingConfiguration(env = process.env) {
  const issues = [];
  let redis;
  try { redis = resolveRedisConfiguration(env); } catch (error) { issues.push(error.message); }
  if (env.STORAGE_BACKEND && env.STORAGE_BACKEND !== 'redis') issues.push('Vercel requires STORAGE_BACKEND=redis; omit it to detect Redis automatically.');
  if (env.AGENT_RATE_LIMIT_STORE && !['auto', 'redis'].includes(env.AGENT_RATE_LIMIT_STORE)) issues.push('Hosted Agent admission requires AGENT_RATE_LIMIT_STORE=redis or auto.');
  if (env.AGENT_IP_SOURCE && !['auto', 'vercel'].includes(env.AGENT_IP_SOURCE)) issues.push('Vercel requires AGENT_IP_SOURCE=vercel or auto.');
  const namespace = env.STORAGE_NAMESPACE ?? 'reshuffle-arc-testnet';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(namespace)) issues.push('Invalid STORAGE_NAMESPACE.');
  if ((env.NEXT_PUBLIC_DEPLOYMENT ?? 'arc-testnet') !== 'arc-testnet' || (env.DEPLOYMENT ?? 'arc-testnet') !== 'arc-testnet') issues.push('This hosted demo requires the Arc Testnet deployment on both server and browser.');
  if (env.ARC_CHAIN_ID && env.ARC_CHAIN_ID !== '5042002') issues.push('ARC_CHAIN_ID must agree with the Arc Testnet manifest.');
  if (env.READ_SOURCE && env.READ_SOURCE !== 'graph') issues.push('Set READ_SOURCE=graph for the hosted Graph submission.');
  const signing = env.JUDGE_CONTROLS_ENABLED === 'true' || env.DEMO_TICKETS_ENABLED === 'true';
  if (signing && env.VERCEL_ENV && env.VERCEL_ENV !== 'production') issues.push('Disable judge and issuer signing in Vercel previews; production owns the demo wallets.');
  if (env.JUDGE_CONTROLS_ENABLED === 'true') {
    if ((env.JUDGE_ACCESS_CODE?.length ?? 0) < 24) issues.push('JUDGE_ACCESS_CODE must contain at least 24 characters.');
    const hashes = (env.JUDGE_ALLOWED_INTENT_HASHES ?? '').split(',').map(h => h.trim());
    if (!hashes.length || hashes.some(h => !/^0x[0-9a-f]{64}$/i.test(h))) issues.push('Configure exact JUDGE_ALLOWED_INTENT_HASHES; wildcards and empty entries are rejected.');
    if (!['PRIVATE_KEY', 'SEED_B_PRIVATE_KEY', 'SEED_C_PRIVATE_KEY', 'SEED_D_PRIVATE_KEY'].some(key => /^0x[0-9a-f]{64}$/i.test(env[key] ?? ''))) issues.push('Configure the funded testnet participant signing keys for judge controls.');
  }
  if (env.DEMO_TICKETS_ENABLED === 'true' && !/^0x[0-9a-f]{64}$/i.test(env.DEMO_ISSUER_PRIVATE_KEY || env.PRIVATE_KEY || '')) issues.push('Configure DEMO_ISSUER_PRIVATE_KEY or PRIVATE_KEY for the enabled ticket issuer.');
  for (const key of Object.keys(env)) if (/^NEXT_PUBLIC_.*(?:PRIVATE_KEY|SECRET|TOKEN|API_KEY|ACCESS_CODE)/.test(key) && env[key]) issues.push(`Remove the secret from browser-visible setting ${key}.`);
  if (issues.length) throw new HostingCheckError(issues.join('\n'));
  return { redis, namespace };
}

const PROBE = `
local t = redis.call('TIME')
if redis.call('EXISTS', KEYS[1]) ~= 0 then return {0} end
redis.call('SET', KEYS[1], ARGV[1], 'PX', 30000)
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return {0} end
redis.call('DEL', KEYS[1])
return {1, t[1], t[2]}`;

export async function checkHosting({ env = process.env, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const { redis, namespace } = hostingConfiguration(env);
  const signal = AbortSignal.timeout(timeoutMs);
  const id = randomUUID();
  try {
    const response = await fetchImpl(redis.url, {
      method: 'POST', headers: { authorization: `Bearer ${redis.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(['EVAL', PROBE, 1, `${namespace}:hosting-preflight:${id}`, id]), signal, cache: 'no-store',
    });
    const body = await response.json();
    signal.throwIfAborted();
    if (!response.ok || body.error || !Array.isArray(body.result) || body.result.length !== 3 || body.result[0] !== 1
      || !/^\d+$/.test(String(body.result[1])) || !/^\d+$/.test(String(body.result[2]))) throw new Error('invalid Redis probe');
  } catch {
    throw new HostingCheckError('Redis REST preflight failed. Check the endpoint, REST write token, network access and EVAL/TIME support. No deployment was accepted.');
  }
  return { configuration: 'PASS', redisWriteAndLua: 'PASS', redisSettings: [redis.urlKey, redis.tokenKey], hostedAcceptance: 'NOT_RUN' };
}
