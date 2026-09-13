import { applyBudget, judgeControlsEnabled, participantKeys, JudgeControlError } from '@/server/judge-budget';
import { graphPool } from '@/server/solve-graph';
import type { Hex } from 'viem';
import { parseMinBlock } from '@/server/solve';
import { SubgraphLagError } from '@/shared/graph';
import { allowedIntent, JudgeAccessError, requireJudge } from '@/server/judge-access';
import { SigningBusy, readJob } from '@/server/signing-job';
import { durableStore } from '@/server/durable-store';
import { DEPLOYMENT } from '@/lib/deployment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

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
    await requireJudge(request);
    const minBlock = parseMinBlock({ minBlock: new URL(request.url).searchParams.get('minBlock') });
    const { committed, snapshot } = await graphPool(minBlock);
    // Only list what this server can actually change — an intent whose key we do not hold
    // would fail at POST, and offering it would be a control that does not work.
    const holders = participantKeys();
    const permitted = await Promise.all([...committed.entries()].filter(([, i]) => holders.has(i.owner.toLowerCase() as `0x${string}`)).map(async entry => await allowedIntent(entry[0]) ? entry : null));
    const intents = permitted.filter(entry => entry !== null)
      .map(([hash, i]) => ({
      hash,
      owner: i.owner,
      maxNetPay: i.maxNetPay.toString(),
      maxNetPayUsdc: Number(i.maxNetPay) / 1e6,
      exactCount: i.exactCount,
      mustBeAdjacent: i.mustBeAdjacent,
    }));
    const pending = [];
    const store = durableStore();
    for (const owner of holders.keys()) {
      const id = await store.get(`signing:active:${DEPLOYMENT.chainId}:${owner}`);
      if (!id?.startsWith(`judge:${DEPLOYMENT.chainId}:${DEPLOYMENT.intentRegistry}:`)) continue;
      const hash = id.split(':')[3], job = await readJob<{ next?: string }, unknown>(id, store);
      if (!job || job.result !== undefined || !await allowedIntent(hash, store)) continue;
      pending.push({ intentHash: hash, maxNetPay: job.plan.next ? JSON.parse(job.plan.next).maxNetPay : null });
    }
    return Response.json(
      { enabled: true, snapshotBlock: snapshot.block.toString(), intents, pending },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof JudgeAccessError) return Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
    if (error instanceof SubgraphLagError) return Response.json({ error: 'SubgraphLagError: waiting for the updated judge pool.' }, { status: 409 });
    return Response.json({ error: 'Judge pool is temporarily unavailable.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    await requireJudge(request, true);
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
    const known = error instanceof JudgeControlError || error instanceof JudgeAccessError || error instanceof SigningBusy;
    const status = known ? error.status : 503;
    const message =
      known
        ? error.message
        : 'The budget change could not finish. Retry the same action to resume its saved transaction.';
    return Response.json({ error: message, ...(error instanceof JudgeControlError && error.confirmed ? { confirmed: error.confirmed } : {}) }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
