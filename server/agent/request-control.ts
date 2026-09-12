import 'server-only';
import { isIP } from 'node:net';
import { AgentRequestCancelled, AgentRequestTimeout, RequestBudget } from './request-budget';

export type AgentRoute = 'ask' | 'diagnose';
export const AGENT_POLICY = {
  ask: { requests: 12, timeoutMs: 60_000 },
  diagnose: { requests: 30, timeoutMs: 30_000 },
} as const;
const WINDOW_MS = 60_000;

/** Bounded sliding windows. Rejections do not add timestamps or extend a client's window. */
export class AgentRateLimiter {
  private buckets = new Map<string, number[]>();
  constructor(private maxBuckets = 2048) {}

  consume(route: AgentRoute, client: string, now = Date.now()): { allowed: boolean; retryAfter: number } {
    for (const [key, times] of this.buckets) {
      const active = times.filter(time => time > now - WINDOW_MS);
      if (active.length) this.buckets.set(key, active);
      else this.buckets.delete(key);
    }
    const key = `${route}:${client}`;
    const times = this.buckets.get(key) ?? [];
    if (times.length >= AGENT_POLICY[route].requests) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((times[0] + WINDOW_MS - now) / 1000)) };
    }
    if (!this.buckets.has(key) && this.buckets.size >= this.maxBuckets) {
      // Do not evict an active client: rotating identities must not reset an existing quota.
      const expires = Math.min(...[...this.buckets.values()].map(values => values.at(-1)! + WINDOW_MS));
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((expires - now) / 1000)) };
    }
    times.push(now);
    this.buckets.set(key, times);
    return { allowed: true, retryAfter: 0 };
  }
}

const limiter = new AgentRateLimiter();

export function agentClient(request: Request): string {
  // Enable only behind an ingress that overwrites this header. Native Request has no peer IP.
  if (process.env.AGENT_TRUST_PROXY !== 'true') return 'unidentified';
  const raw = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  if (isIP(raw) === 4) return raw;
  if (isIP(raw) === 6 && !raw.includes('%')) {
    const canonical = new URL(`http://[${raw}]/`).hostname.slice(1, -1);
    const mapped = canonical.match(/^::ffff:([\da-f]+):([\da-f]+)$/);
    if (mapped) {
      const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
      return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    }
    return canonical;
  }
  return 'unidentified';
}

function timeoutFor(route: AgentRoute): number {
  const value = Number(process.env[`AGENT_${route.toUpperCase()}_TIMEOUT_MS`]);
  const maximum = AGENT_POLICY[route].timeoutMs;
  // Hosting may need a shorter deadline, never a larger or unbounded one.
  return Number.isInteger(value) && value > 0 && value <= maximum ? value : maximum;
}

export class AgentInputError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = 'AgentInputError'; }
}

export async function readAgentBody(request: Request, budget: RequestBudget): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const cancel = () => { void reader.cancel().catch(() => {}); };
  budget.signal.addEventListener('abort', cancel, { once: true });
  try {
    const decoder = new TextDecoder();
    let bytes = 0, text = '';
    while (true) {
      budget.checkpoint();
      const { value, done } = await reader.read();
      budget.checkpoint();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > 4096) { cancel(); throw new AgentInputError('Request too large', 413); }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    budget.signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

/** Admission precedes body/params/Graph reads; timeout covers validation through final response. */
export async function withAgentRequest(request: Request, route: AgentRoute, work: (budget: RequestBudget) => Promise<Response>): Promise<Response> {
  const admission = limiter.consume(route, agentClient(request));
  if (!admission.allowed) return Response.json({
    code: 'AgentRateLimited', error: `Too many agent requests. Retry in ${admission.retryAfter} seconds.`, retryAfterSeconds: admission.retryAfter,
  }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(admission.retryAfter) } });

  const budget = new RequestBudget(timeoutFor(route), request.signal);
  try {
    return await budget.run(() => work(budget));
  } catch (error) {
    if (error instanceof AgentRequestTimeout) return Response.json({ code: error.name, error: error.message, timeoutMs: error.timeoutMs }, { status: 504, headers: { 'Cache-Control': 'no-store' } });
    if (error instanceof AgentRequestCancelled) return Response.json({ code: error.name, error: error.message }, { status: 499, headers: { 'Cache-Control': 'no-store' } });
    if (error instanceof AgentInputError) return Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
    throw error;
  } finally {
    budget.dispose();
  }
}
