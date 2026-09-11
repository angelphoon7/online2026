import { solveLivePool } from '@/server/solve-pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST() {
  try {
    return Response.json(await solveLivePool(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return Response.json({ error: message.startsWith('Live pool exceeds') ? message : 'Unable to search the live pool. Retry when public chain reads are available.' }, { status: 503 });
  }
}
