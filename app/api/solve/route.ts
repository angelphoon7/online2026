import { parseSolveRequest, solveOnChain } from '@/server/solve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > 2048) return Response.json({ error: 'Request too large' }, { status: 413 });
  let hashes;
  try { hashes = parseSolveRequest(JSON.parse(text)); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
  try {
    return Response.json(await solveOnChain(hashes), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const failure = error as { name?: string; shortMessage?: string; message?: string };
    console.error('Solve failed', failure.name, failure.shortMessage ?? failure.message);
    return Response.json({ error: 'Unable to solve from chain state. Check committed hashes and backend configuration.' }, { status: 502 });
  }
}
