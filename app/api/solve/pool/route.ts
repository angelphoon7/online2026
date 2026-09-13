import { solveLivePool } from '@/server/solve-pool';
import { solveErrorResponse } from '@/server/solve-error';
import { parseMinBlock, parseRequiredIntent } from '@/server/solve';
import type { Hex } from 'viem';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Search the whole live pool — plan 6-C. The pool is reconstructed from The Graph, because
// IntentRegistry stores only hash -> state and Solidity mappings cannot be enumerated.
export async function POST(request: Request) {
  let minBlock = 0n;
  let mustInclude: Hex | undefined;
  const text = await request.text();
  if (text) {
    if (text.length > 2048) return Response.json({ error: 'Request too large' }, { status: 413 });
    try { const body = JSON.parse(text); minBlock = parseMinBlock(body); mustInclude = parseRequiredIntent(body); }
    catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
  }
  try {
    return Response.json(await solveLivePool(minBlock, mustInclude), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return solveErrorResponse(error);
  }
}
