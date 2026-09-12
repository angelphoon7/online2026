import 'server-only';
import { subgraphEndpoint } from '@/shared/graph/client';

// Same-origin proxy to Subgraph Studio.
//
// The browser never talks to Studio directly: the query URL is version-pinned, so baking it
// into the client bundle would freeze a subgraph version into a build, and any API key would
// ship with it. shared/graph/client.ts posts here when it runs in a browser.
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
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.SUBGRAPH_API_KEY
          ? { authorization: `Bearer ${process.env.SUBGRAPH_API_KEY}` }
          : {}),
      },
      body,
      cache: 'no-store',
    });

    // Pass the payload through untouched: graph-node's own errors carry the indexed block
    // number that the client turns into a SubgraphLagError, and rewriting them would lose it.
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { 'content-type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return Response.json(
      { errors: [{ message: `Subgraph unreachable: ${(error as Error).message}` }] },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
