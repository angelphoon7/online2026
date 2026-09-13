import 'server-only';
import { SubgraphPaginationError } from '@/shared/graph/pages';
import { GraphError, SubgraphRateLimited } from '@/shared/graph/client';

/** A partial snapshot is a read failure, never an empty pool or a negative search result. */
export function graphReadError(error: unknown): Response | null {
  if (error instanceof SubgraphRateLimited) return Response.json({ code: error.name, error: error.message, retryAfterSeconds: error.retryAfterSeconds },
    { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(error.retryAfterSeconds) } });
  if (error instanceof GraphError) return Response.json({ code: 'GraphProviderUnavailable', error: 'Live market data could not be loaded from The Graph. Please retry shortly.' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } });
  return error instanceof SubgraphPaginationError
    ? Response.json({ code: error.name, error: error.message }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    : null;
}
