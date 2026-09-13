import 'server-only';
import { graphReadError } from './graph-read-error';
import { retryAfterSeconds } from '../shared/retry-after';

export function solveErrorResponse(error: unknown): Response {
  const graph = graphReadError(error);
  if (graph) return graph;
  const failure = error instanceof Error ? error : new Error();
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  let code = 'SolverUnavailable', message = 'The solver could not finish checking chain state. Retry shortly.', status = 503;
  if (failure.name === 'SubgraphLagError') {
    code = failure.name; status = 409; message = 'Your transaction is confirmed. Waiting for its block to be indexed before searching again.';
  } else if (failure.name === 'StorageUnavailable') {
    code = failure.name; message = 'The solver could not save its evidence. Retry after backend storage is available.';
  } else if (failure.name === 'GraphIntentUnavailable') {
    code = failure.name; status = 422; message = 'A selected request is unavailable in the indexed pool. Refresh the pool and select live requests.';
  } else if (failure.message.startsWith('Live pool exceeds')) {
    code = 'SolverPoolLimit'; status = 422; message = failure.message;
  } else {
    let cause: unknown = error;
    for (let depth = 0; cause && depth < 12; depth++) {
      const item = cause as { code?: number; status?: number; retryAfter?: string; cause?: unknown };
      if (item.code === -32005 || item.code === 429 || item.status === 429) {
        code = 'ArcRateLimited'; status = 429;
        headers['Retry-After'] = String(retryAfterSeconds(item.retryAfter ?? '5'));
        message = 'Arc RPC is temporarily rate-limited. Your committed intent remains on-chain. Retry the solver shortly.';
        break;
      }
      cause = item.cause;
    }
  }
  // Log a useful category without upstream URLs, credentials or request payloads.
  console.error('Solve failed', code);
  return Response.json({ code, error: message }, { status, headers });
}
