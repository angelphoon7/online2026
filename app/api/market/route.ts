import { marketSnapshot } from '@/server/market';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { return Response.json(await marketSnapshot(new URL(request.url).searchParams.get('fresh') === '1'), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) {
    console.error('Market read failed:', error instanceof Error ? error.name : 'Unknown', error instanceof Error && error.name === 'Error' ? error.message : 'Upstream read failed');
    return Response.json({ error: 'Public chain reads are unavailable. Retry shortly; wallet connection is not required.' }, { status: 503 });
  }
}
