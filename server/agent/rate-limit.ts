import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { redisStore, StorageUnavailable, type RedisRestStore } from '../durable-store';

export type AgentRoute = 'ask' | 'diagnose';
export const AGENT_POLICY = { ask: { requests: 12, timeoutMs: 60_000 }, diagnose: { requests: 30, timeoutMs: 30_000 } } as const;
export const WINDOW_MS = 60_000;
export type Admission = { allowed: boolean; retryAfter: number };
export class AgentRateLimitUnavailable extends Error {
  constructor(message = 'Agent rate limiting is unavailable. Retry after the operator checks Redis and trusted ingress configuration.') { super(message); this.name = 'AgentRateLimitUnavailable'; }
}
const production = () => process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
export type IpSource = 'vercel' | 'trusted-proxy' | 'unidentified';
export function agentIpSource(): IpSource {
  let mode = process.env.AGENT_IP_SOURCE ?? 'auto';
  if (mode === 'auto') mode = process.env.VERCEL === '1' ? 'vercel' : process.env.AGENT_TRUST_PROXY === 'true' ? 'trusted-proxy' : 'unidentified';
  if (!['vercel', 'trusted-proxy', 'unidentified'].includes(mode) || (mode === 'vercel' && process.env.VERCEL !== '1') || (production() && mode === 'unidentified')) throw new AgentRateLimitUnavailable();
  return mode as IpSource;
}
export function agentRateLimitStore(): 'redis' | 'memory' {
  const mode = process.env.AGENT_RATE_LIMIT_STORE ?? 'auto';
  const selected = mode === 'auto' ? (production() || process.env.REDIS_REST_URL ? 'redis' : 'memory') : mode;
  if (!['redis', 'memory'].includes(selected) || (production() && selected !== 'redis')) throw new AgentRateLimitUnavailable();
  if (selected === 'redis') redisStore(); // Validate configuration before admitting requests.
  return selected as 'redis' | 'memory';
}
export function agentClient(request: Request): string {
  const source = agentIpSource();
  // Only the operator-controlled runtime selects a trusted header, never request metadata.
  const raw = source === 'vercel' ? request.headers.get('x-vercel-forwarded-for') : source === 'trusted-proxy' ? request.headers.get('x-forwarded-for') : null;
  const ip = raw?.trim() ?? '';
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) === 6 && !ip.includes('%')) {
    const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    const mapped = canonical.match(/^::ffff:([\da-f]+):([\da-f]+)$/);
    if (!mapped) return canonical;
    const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  // Lists, missing headers and malformed addresses must not become attacker-chosen buckets.
  if (production()) throw new AgentRateLimitUnavailable('The trusted ingress did not supply one valid client IP.');
  return 'unidentified';
}

/** Development-only bounded windows. Production never falls back to this instance-local map. */
export class AgentRateLimiter {
  private buckets = new Map<string, number[]>();
  constructor(private maxBuckets = 2048) {}
  consume(route: AgentRoute, client: string, now = Date.now()): Admission {
    for (const [key, times] of this.buckets) {
      const active = times.filter(time => time > now - WINDOW_MS);
      if (active.length) this.buckets.set(key, active); else this.buckets.delete(key);
    }
    const key = `${route}:${client}`, times = this.buckets.get(key) ?? [];
    if (times.length >= AGENT_POLICY[route].requests) return { allowed: false, retryAfter: Math.max(1, Math.ceil((times[0] + WINDOW_MS - now) / 1000)) };
    if (!this.buckets.has(key) && this.buckets.size >= this.maxBuckets) {
      const expires = Math.min(...[...this.buckets.values()].map(values => values.at(-1)! + WINDOW_MS));
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((expires - now) / 1000)) };
    }
    times.push(now); this.buckets.set(key, times);
    return { allowed: true, retryAfter: 0 };
  }
}

// Redis owns both the clock and admission decision. No GET/SET race or per-worker cache.
// Rejected requests never add an entry or extend the expiry. Each entry is one admission.
const SLIDING_WINDOW = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[1])
if count >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, math.max(1, math.ceil((tonumber(oldest[2]) + window - now) / 1000))}
end
redis.call('ZADD', KEYS[1], now, ARGV[3])
redis.call('PEXPIRE', KEYS[1], window)
return {1, 0}`;
export class SharedAgentRateLimiter {
  constructor(private store: Pick<RedisRestStore, 'evaluate'> = redisStore()) {}
  async consume(route: AgentRoute, client: string, signal?: AbortSignal): Promise<Admission> {
    const key = `agent-rate:v1:${route}:${createHash('sha256').update(client).digest('hex')}`;
    const result = await this.store.evaluate<unknown>(SLIDING_WINDOW, [key], [WINDOW_MS, AGENT_POLICY[route].requests, randomUUID()], signal);
    if (!Array.isArray(result) || result.length !== 2 || ![0, 1].includes(result[0]) || !Number.isInteger(result[1]) || result[1] < 0 || result[1] > 60 || (result[0] === 1 ? result[1] !== 0 : result[1] === 0)) throw new StorageUnavailable();
    return { allowed: result[0] === 1, retryAfter: result[1] };
  }
}
const local = new AgentRateLimiter();
export async function admitAgent(request: Request, route: AgentRoute, signal: AbortSignal) {
  signal.throwIfAborted();
  const client = agentClient(request), store = agentRateLimitStore();
  const admission = store === 'redis' ? await new SharedAgentRateLimiter().consume(route, client, signal) : local.consume(route, client);
  signal.throwIfAborted();
  return { ...admission, store, source: agentIpSource() };
}

/** Check identity configuration and the real Lua path without consuming a visitor's quota. */
export async function checkAgentRateLimit(request: Request): Promise<void> {
  agentClient(request);
  if (agentRateLimitStore() === 'redis') {
    // A stable, non-IP identity bounds the probe to one expiring key. Either admission
    // result proves the limiter ran; a full probe bucket is not a storage failure.
    await new SharedAgentRateLimiter().consume('diagnose', 'health-probe');
  }
}
