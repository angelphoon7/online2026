import { getPoolSnapshot } from '@/shared/graph';
import { SubgraphLagError, SubgraphHistoryUnavailable } from '@/shared/graph/client';
import { SnapshotCapacityReadError } from '@/server/solve-hypothetical';
import { ask, agentConfigured, AgentNotConfigured } from '@/server/agent/narrate';
import { diagnose } from '@/server/agent/diagnose';
import { renderEvidence } from '@/server/agent/template';
import type { Hex } from 'viem';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/agent/ask  -  plan 7-I.
//
// { intentHash, question, minBlock? } -> { answer, guardFallback, evidence, block, model }
//
// One snapshot is taken here and every tool in the request reads that same one, so the block
// number the answer opens with and the evidence beneath it describe the same moment.
//
// Without an Anthropic key this still answers, using the deterministic sentence - the endpoint
// degrades to the same thing GET /api/agent/diagnose returns rather than failing. The agent is
// read-only either way: it holds no key that can sign or submit anything.

const MAX_QUESTION = 500;
/** Coarse per-IP limit. The LLM call costs money; a page bug should not spend it in a loop. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;
const seen = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const hits = (seen.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  hits.push(now);
  seen.set(key, hits);
  if (seen.size > 500) for (const [k, v] of seen) if (!v.some((at) => now - at < WINDOW_MS)) seen.delete(k);
  return hits.length > MAX_PER_WINDOW;
}

export async function POST(request: Request) {
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) {
    return Response.json({ error: 'Cross-origin requests are not accepted.' }, { status: 403 });
  }

  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (rateLimited(client)) {
    return Response.json({ error: 'Too many questions in a short window. Wait a moment.' }, { status: 429 });
  }

  const text = await request.text();
  if (text.length > 4096) return Response.json({ error: 'Request too large' }, { status: 413 });

  let intentHash: Hex;
  let question: string;
  let minBlock = 0n;
  try {
    const body = JSON.parse(text) as { intentHash?: string; question?: string; minBlock?: string };
    if (typeof body.intentHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(body.intentHash)) {
      throw new Error('Provide a committed intent hash: 0x and 64 hex characters.');
    }
    if (typeof body.question !== 'string' || !body.question.trim()) throw new Error('Ask a question.');
    if (body.question.length > MAX_QUESTION) throw new Error(`Keep the question under ${MAX_QUESTION} characters.`);
    intentHash = body.intentHash.toLowerCase() as Hex;
    question = body.question.trim();
    if (body.minBlock) minBlock = BigInt(body.minBlock);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }

  try {
    const snapshot = await getPoolSnapshot({ minBlock });

    if (!agentConfigured()) {
      // No key: answer deterministically and say so, rather than returning an error page for
      // a question the evidence can already answer.
      const evidence = await diagnose(snapshot, intentHash);
      return Response.json(
        {
          answer: renderEvidence(evidence),
          guardFallback: true,
          guardReason: 'NO_MODEL_CONFIGURED',
          evidence: [{ tool: 'diagnose_intent', input: { intentHash }, output: evidence }],
          block: evidence.block,
          model: null,
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    return Response.json(await ask(snapshot, intentHash, question), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof SubgraphLagError) {
      return Response.json(
        { error: 'The indexer has not reached the block of your last transaction yet.', indexedBlock: error.indexedBlock?.toString() ?? null },
        { status: 409, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    if (error instanceof SnapshotCapacityReadError) {
      return Response.json({ error: error.message, code: error.name, snapshotBlock: String(error.block) }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    if (error instanceof SubgraphHistoryUnavailable) {
      return Response.json({ error: 'The subgraph no longer retains this snapshot. Retry the question to select a new snapshot.', code: error.name, oldestAvailableBlock: String(error.oldestAvailableBlock) }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    if (error instanceof AgentNotConfigured) {
      return Response.json({ error: error.message }, { status: 501 });
    }
    console.error('Agent ask failed:', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown');
    return Response.json({ error: 'The agent could not answer from current pool state. Retry shortly.' }, { status: 503 });
  }
}
