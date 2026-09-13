import { parseSolveRequest, parseMinBlock, parseRequiredIntent, solveOnChain } from '@/server/solve';
import { graphIntents } from '@/server/solve-graph';
import { readSource } from '@/server/market';
import { solveErrorResponse } from '@/server/solve-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Bounded search over 2-4 named intents — plan 6-C.
//
// Discovery comes from the subgraph when one is configured, so the evidence carries the
// snapshot block the pool was read at and the named reason for anything excluded. A commit
// absent from that snapshot is not silently discovered from newer RPC logs.
//
// Discovery only: registry state, custody, ticket metadata and USDC capacity are re-read from
// the chain before the search, and the proposal is simulated before anyone submits it.
export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > 2048) return Response.json({ error: 'Request too large' }, { status: 413 });
  let hashes, minBlock, mustInclude;
  try {
    const body = JSON.parse(text);
    hashes = parseSolveRequest(body);
    minBlock = parseMinBlock(body);
    mustInclude = parseRequiredIntent(body);
    if (mustInclude && !hashes.includes(mustInclude)) throw new Error('Include your own request in the selected intents');
  }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
  try {
    if (readSource() !== 'graph') {
      return Response.json(await solveOnChain(hashes, undefined, undefined, mustInclude), { headers: { 'Cache-Control': 'no-store' } });
    }
    const { committed, source } = await graphIntents(hashes, minBlock);
    return Response.json(await solveOnChain(hashes, committed, source, mustInclude), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return solveErrorResponse(error);
  }
}
