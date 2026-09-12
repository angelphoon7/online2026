import { parseSolveRequest, parseMinBlock, solveOnChain } from '@/server/solve';
import { graphIntents } from '@/server/solve-graph';
import { readSource } from '@/server/market';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Bounded search over 2-4 named intents — plan 6-C.
//
// Discovery comes from the subgraph when one is configured, so the evidence carries the
// snapshot block the pool was read at and the named reason for anything excluded. Whatever the
// subgraph has not indexed yet is discovered from logs instead (server/solve.ts), so a commit
// from seconds ago is still searchable.
//
// Discovery only: registry state, custody, ticket metadata and USDC capacity are re-read from
// the chain before the search, and the proposal is simulated before anyone submits it.
export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > 2048) return Response.json({ error: 'Request too large' }, { status: 413 });
  let hashes, minBlock;
  try {
    const body = JSON.parse(text);
    hashes = parseSolveRequest(body);
    minBlock = parseMinBlock(body);
  }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
  try {
    if (readSource() !== 'graph') {
      return Response.json(await solveOnChain(hashes), { headers: { 'Cache-Control': 'no-store' } });
    }
    const { committed, source } = await graphIntents(hashes, minBlock);
    return Response.json(await solveOnChain(hashes, committed, source), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const failure = error as { name?: string; shortMessage?: string; message?: string };
    console.error('Solve failed', failure.name, failure.shortMessage ?? failure.message);
    // An unmet freshness floor is a wait, not a failure: the caller asked for a block the
    // indexer has not reached, and retrying is the correct response.
    if (failure.name === 'SubgraphLagError') {
      return Response.json({ error: 'The indexer has not reached the block of your last transaction. Retry shortly.' }, { status: 409 });
    }
    return Response.json({ error: 'Unable to solve from chain state. Check committed hashes and backend configuration.' }, { status: 502 });
  }
}
