import 'server-only';
import { createPublicClient, custom } from 'viem';
import { readArcRpc } from './arc-read-rpc';

// Only solver reads use this transport. Signing and broadcasts retain their wallet path.
export function solverReadClient(rpc: string, chainId: number) {
  return createPublicClient({ transport: custom({
    async request({ method, params }) {
      const response = await readArcRpc({ jsonrpc: '2.0', id: 1, method, params: (params ?? []) as unknown[] }, rpc, chainId);
      const body = await response.json();
      if (body.error || !response.ok) throw Object.assign(new Error(body.error?.message ?? 'Arc read unavailable'), {
        code: body.error?.code ?? -32603, data: body.error?.data,
        status: response.status, retryAfter: response.headers.get('Retry-After'),
      });
      return body.result;
    },
  }, { retryCount: 0 }) });
}

// Bound concurrency without dropping any read. Wait for workers to finish before returning
// an error, so retrying cannot leave an old search issuing RPC calls in the background.
export async function readSolverState(jobs: (() => Promise<void>)[], concurrency = 4) {
  let next = 0, failure: unknown;
  let failed = false;
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (!failed && next < jobs.length) {
      const job = jobs[next++];
      try { await job(); } catch (error) { failed = true; failure = error; }
    }
  }));
  if (failed) throw failure;
}
