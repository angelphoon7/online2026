import 'server-only';
import { AgentRequestCancelled, AgentRequestTimeout, RequestBudget } from './request-budget';
import { admitAgent, AgentRateLimitUnavailable, AGENT_POLICY, type AgentRoute } from './rate-limit';
import { StorageUnavailable } from '../durable-store';
export { AgentRateLimiter, agentClient, AGENT_POLICY } from './rate-limit';
export type { AgentRoute } from './rate-limit';

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
  const budget = new RequestBudget(timeoutFor(route), request.signal);
  try {
    return await budget.run(async () => {
      const admission = await admitAgent(request, route, budget.signal);
      budget.checkpoint();
      const headers = {
        'Cache-Control': 'no-store',
        'X-Agent-RateLimit-Store': admission.store,
        'X-Agent-IP-Source': admission.source,
      };
      if (!admission.allowed) return Response.json({
        code: 'AgentRateLimited', error: `Too many agent requests. Retry in ${admission.retryAfter} seconds.`, retryAfterSeconds: admission.retryAfter,
      }, { status: 429, headers: { ...headers, 'Retry-After': String(admission.retryAfter) } });
      const response = await work(budget);
      budget.checkpoint();
      for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
      return response;
    });
  } catch (error) {
    if (error instanceof AgentRequestTimeout) return Response.json({ code: error.name, error: error.message, timeoutMs: error.timeoutMs }, { status: 504, headers: { 'Cache-Control': 'no-store' } });
    if (error instanceof AgentRequestCancelled) return Response.json({ code: error.name, error: error.message }, { status: 499, headers: { 'Cache-Control': 'no-store' } });
    if (error instanceof AgentRateLimitUnavailable || error instanceof StorageUnavailable) return Response.json({
      code: 'AgentRateLimitUnavailable', error: 'Agent rate limiting is unavailable. The operator must check Redis and trusted ingress configuration.',
    }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' } });
    if (error instanceof AgentInputError) return Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
    throw error;
  } finally {
    budget.dispose();
  }
}
