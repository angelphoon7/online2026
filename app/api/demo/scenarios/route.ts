import { judgingStatus } from '@/server/judging-demo';
import { parseMinBlock } from '@/server/solve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { return Response.json(await judgingStatus(parseMinBlock({ minBlock: new URL(request.url).searchParams.get('minBlock') })), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'Live demo status is unavailable. Retry after the indexer and backend are ready.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
