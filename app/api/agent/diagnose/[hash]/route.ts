import { getPoolSnapshot } from '@/shared/graph';
import { graphReadError } from '@/server/graph-read-error';
import { SubgraphLagError, SubgraphHistoryUnavailable } from '@/shared/graph/client';
import { SnapshotCapacityReadError } from '@/server/solve-hypothetical';
import { diagnose } from '@/server/agent/diagnose';
import { renderEvidence } from '@/server/agent/template';
import type { Hex } from 'viem';
import { withAgentRequest } from '@/server/agent/request-control';
import type { RequestBudget } from '@/server/agent/request-budget';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 35;

// GET /api/agent/diagnose/<intentHash>?minBlock=N  -  plan 7-I.
//
// The evidence, with no language model anywhere in the path. This is the endpoint a judge can
// run against this deployment holding nothing but the URL: no Anthropic key, no wallet. It
// returns exactly what the narration is allowed to say, plus the deterministic sentence the
// guard falls back to, so the two can be compared.
//
// Everything in the response holds at one block, named in `block`.

export async function GET(request: Request, context: { params: Promise<{ hash: string }> }) {
  return withAgentRequest(request, 'diagnose', budget => handleDiagnosis(request, context, budget));
}

async function handleDiagnosis(request: Request, context: { params: Promise<{ hash: string }> }, budget: RequestBudget) {
  const { hash } = await context.params;
  budget.checkpoint();
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    return Response.json({ error: 'Provide a committed intent hash: 0x and 64 hex characters.' }, { status: 400 });
  }

  const minBlockParam = new URL(request.url).searchParams.get('minBlock');
  let minBlock = 0n;
  if (minBlockParam) {
    try { minBlock = BigInt(minBlockParam); }
    catch { return Response.json({ error: 'minBlock must be a block number.' }, { status: 400 }); }
  }

  try {
    // One snapshot for the whole request: every claim in the evidence refers to this block.
    const snapshot = await getPoolSnapshot({ minBlock, signal: budget.signal });
    budget.checkpoint();
    const evidence = await diagnose(snapshot, hash.toLowerCase() as Hex, undefined, budget);
    return Response.json(
      { ...evidence, sentence: renderEvidence(evidence) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    budget.checkpoint();
    const pageError = graphReadError(error); if (pageError) return pageError;
    if (error instanceof SnapshotCapacityReadError) {
      return Response.json({ error: error.message, code: error.name, snapshotBlock: String(error.block) }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    if (error instanceof SubgraphHistoryUnavailable) {
      return Response.json({ error: 'The subgraph no longer retains this snapshot. Retry the diagnosis to select a new snapshot.', code: error.name, oldestAvailableBlock: String(error.oldestAvailableBlock) }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    // An unmet freshness floor is a wait, not a failure: the caller asked about a block the
    // indexer has not reached, and the honest response says how far behind it is.
    if (error instanceof SubgraphLagError) {
      return Response.json(
        { error: 'The indexer has not reached that block yet.', indexedBlock: error.indexedBlock?.toString() ?? null },
        { status: 409, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    console.error('Diagnose failed:', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown');
    return Response.json({ error: 'Unable to diagnose from current pool state. Retry shortly.' }, { status: 503 });
  }
}
