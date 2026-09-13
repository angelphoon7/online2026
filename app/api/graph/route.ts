import 'server-only';
import { fetchGraph, subgraphEndpoint, SubgraphRateLimited } from '@/shared/graph/client';

// Same-origin proxy to Subgraph Studio.
//
// Browser Graph calls use this proxy. The selected deployment provides a public default
// endpoint; server-side overrides and private API keys are resolved at request time.
//
// This forwards read queries only — a GraphQL endpoint for a subgraph has no mutations — and
// it does not interpret the body beyond a size guard.

const MAX_BODY_BYTES = 32 * 1024;

export async function POST(request: Request) {
  let endpoint: string;
  try {
    endpoint = subgraphEndpoint();
  } catch (error) {
    return Response.json(
      { errors: [{ message: (error as Error).message }] },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return Response.json(
      { errors: [{ message: 'Query too large' }] },
      { status: 413, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const upstream = await fetchGraph(body, { url: endpoint, signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]) });

    // Pass the payload through untouched: graph-node's own errors carry the indexed block
    // number that the client turns into a SubgraphLagError, and rewriting them would lose it.
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { 'content-type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof SubgraphRateLimited) return Response.json({ errors: [{ message: error.message, extensions: { code: error.name } }] },
      { status: 429, headers: { 'content-type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': String(error.retryAfterSeconds) } });
    return Response.json(
      { errors: [{ message: 'Subgraph unreachable. Retry shortly.' }] },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
