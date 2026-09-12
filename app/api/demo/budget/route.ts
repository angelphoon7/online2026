import { applyBudget, judgeControlsEnabled, participantKeys, JudgeControlError } from '@/server/judge-budget';
import { graphPool } from '@/server/solve-graph';
import type { Hex } from 'viem';
import { parseMinBlock } from '@/server/solve';
import { SubgraphLagError } from '@/shared/graph';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Judge control endpoint — plan 6-D.
//
// GET  lists the live intents whose budget this server can change (it holds their key).
// POST revokes one and commits the same conditions with a different maxNetPay, on-chain, and
//      returns commitBlock so the caller can waitForIndexed before re-reading the pool.

export async function GET(request: Request) {
  if (!judgeControlsEnabled()) {
    return Response.json({ enabled: false, intents: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const minBlock = parseMinBlock({ minBlock: new URL(request.url).searchParams.get('minBlock') });
    const { committed, snapshot } = await graphPool(minBlock);
    // Only list what this server can actually change — an intent whose key we do not hold
    // would fail at POST, and offering it would be a control that does not work.
    const holders = participantKeys();
    const intents = [...committed.entries()]
      .filter(([, i]) => holders.has(i.owner.toLowerCase() as `0x${string}`))
      .map(([hash, i]) => ({
      hash,
      owner: i.owner,
      maxNetPay: i.maxNetPay.toString(),
      maxNetPayUsdc: Number(i.maxNetPay) / 1e6,
      exactCount: i.exactCount,
      mustBeAdjacent: i.mustBeAdjacent,
    }));
    return Response.json(
      { enabled: true, snapshotBlock: snapshot.block.toString(), intents },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof SubgraphLagError) return Response.json({ error: 'SubgraphLagError: waiting for the updated judge pool.' }, { status: 409 });
    return Response.json({ error: (error as Error).message }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) {
    return Response.json({ error: 'Cross-origin requests are not accepted.' }, { status: 403 });
  }
  try {
    const text = await request.text();
    if (text.length > 2048) throw new JudgeControlError('Request too large');
    const body = JSON.parse(text) as { intentHash?: string; maxNetPayUsdc?: number; maxNetPay?: string };

    const intentHash = body.intentHash;
    if (typeof intentHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(intentHash)) {
      throw new JudgeControlError('Provide a committed intent hash.');
    }

    // Accept either contract units or a signed USDC amount; the signed sense is the whole
    // point of maxNetPay, so a negative value must survive the conversion.
    let maxNetPay: bigint;
    if (typeof body.maxNetPay === 'string') {
      maxNetPay = BigInt(body.maxNetPay);
    } else if (typeof body.maxNetPayUsdc === 'number' && Number.isFinite(body.maxNetPayUsdc)) {
      maxNetPay = BigInt(Math.round(body.maxNetPayUsdc * 1e6));
    } else {
      throw new JudgeControlError('Provide maxNetPayUsdc (signed) or maxNetPay in contract units.');
    }
    if (maxNetPay > 10n ** 12n || maxNetPay < -(10n ** 12n)) {
      throw new JudgeControlError('Budget is outside the demo range.');
    }

    const result = await applyBudget(intentHash as Hex, maxNetPay);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof JudgeControlError ? error.status : 500;
    // Keep diagnostics useful without logging signing accounts, calldata or credentials.
    const cause = error as { name?: string; shortMessage?: string; cause?: { name?: string; shortMessage?: string } };
    console.error('Apply budget failed:', { name: cause?.name, shortMessage: cause?.shortMessage, cause: cause?.cause?.name, causeMessage: cause?.cause?.shortMessage });
    const message =
      error instanceof JudgeControlError
        ? error.message
        : 'The budget change failed. Check the server log and transaction status before retrying.';
    return Response.json({ error: message, ...(error instanceof JudgeControlError && error.confirmed ? { confirmed: error.confirmed } : {}) }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
