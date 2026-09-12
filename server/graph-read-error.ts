import 'server-only';
import { SubgraphPaginationError } from '@/shared/graph/pages';

/** A partial snapshot is a read failure, never an empty pool or a negative search result. */
export function graphReadError(error: unknown): Response | null {
  return error instanceof SubgraphPaginationError
    ? Response.json({ code: error.name, error: error.message }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    : null;
}
