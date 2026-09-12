import { solveLivePool } from '@/server/solve-pool';
import { graphReadError } from '@/server/graph-read-error';
import { parseMinBlock } from '@/server/solve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Search the whole live pool — plan 6-C. The pool is reconstructed from The Graph, because
// IntentRegistry stores only hash -> state and Solidity mappings cannot be enumerated.
export async function POST(request: Request) {
  let minBlock = 0n;
  const text = await request.text();
  if (text) {
    if (text.length > 2048) return Response.json({ error: 'Request too large' }, { status: 413 });
    try { minBlock = parseMinBlock(JSON.parse(text)); }
    catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
  }
  try {
    return Response.json(await solveLivePool(minBlock), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const pageError = graphReadError(error); if (pageError) return pageError;
    const message = error instanceof Error ? error.message : '';
    if (error instanceof Error && error.name === 'SubgraphLagError') {
      return Response.json({ error: 'The indexer has not reached the block of your last transaction. Retry shortly.' }, { status: 409 });
    }
    return Response.json({ error: message.startsWith('Live pool exceeds') ? message : 'Unable to search the live pool. Retry when public chain reads are available.' }, { status: 503 });
  }
}
