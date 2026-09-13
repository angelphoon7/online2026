// Shared by server storage, Agent admission and hosting checks. No browser imports.
export const REDIS_ENV_PAIRS = [
  ['REDIS_REST_URL', 'REDIS_REST_TOKEN'],
  ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
];

export class RedisConfigurationError extends Error {
  constructor(message) { super(message); this.name = 'RedisConfigurationError'; }
}

/** @param {Record<string, string | undefined>} env */
export function hasRedisConfiguration(env = process.env) {
  return REDIS_ENV_PAIRS.some(pair => pair.some(key => env[key]?.trim()));
}

/**
 * Prefer explicit settings, then provider defaults. Never join credentials from
 * different pairs or silently ignore a partially configured higher-priority pair.
 * @param {Record<string, string | undefined>} env
 */
export function resolveRedisConfiguration(env = process.env) {
  for (const [urlKey, tokenKey] of REDIS_ENV_PAIRS) {
    const url = env[urlKey]?.trim() ?? '', token = env[tokenKey]?.trim() ?? '';
    if (!url && !token) continue;
    if (!url || !token) throw new RedisConfigurationError(`Configure both ${urlKey} and ${tokenKey}.`);
    let parsed;
    try { parsed = new URL(url); } catch { /* Report setting names, never secret values. */ }
    if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || /[\r\n]/.test(token)) {
      throw new RedisConfigurationError(`Check ${urlKey} (HTTPS REST endpoint) and ${tokenKey} (REST write token).`);
    }
    return { url, token, urlKey, tokenKey };
  }
  throw new RedisConfigurationError('Configure a Redis REST URL/token pair: REDIS_REST_*, UPSTASH_REDIS_REST_* or KV_REST_API_*.');
}
