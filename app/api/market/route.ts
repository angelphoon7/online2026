import { marketSnapshot } from '@/server/market';
import { SubgraphLagError, SubgraphIndexingError } from '@/shared/graph/client';
import { parseMinBlock } from '@/server/solve';
import { graphReadError } from '@/server/graph-read-error';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let minBlock: bigint;
  try { minBlock = parseMinBlock({ minBlock: params.get('minBlock') }); }
  catch { return Response.json({ error: 'minBlock must be a non-negative block number.' }, { status: 400 }); }
  try { return Response.json(await marketSnapshot(params.get('fresh') === '1', minBlock, request.signal), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) {
    const pageError = graphReadError(error); if (pageError) return pageError;
    if (error instanceof SubgraphLagError) return Response.json({ error: 'SubgraphLagError: waiting for the block of your last transaction.', indexedBlock: error.indexedBlock?.toString() ?? null }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    if (error instanceof SubgraphIndexingError) return Response.json({ error: error.message }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    console.error('Market read failed:', error instanceof Error ? error.name : 'Unknown', error instanceof Error && error.name === 'Error' ? error.message : 'Upstream read failed');
    return Response.json({ error: 'Public chain reads are unavailable. Retry shortly; wallet connection is not required.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
