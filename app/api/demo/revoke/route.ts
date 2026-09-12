import { revokeAsJudge, JudgeControlError } from '@/server/judge-budget';
import type { Hex } from 'viem';
import { JudgeAccessError, requireJudge } from '@/server/judge-access';
import { SigningBusy } from '@/server/signing-job';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Judge control endpoint — plan 6-D, the Revoke participant half.
//
// A real owner-signed revoke() on Arc, so the subgraph observes IntentRevoked and the pool a
// judge sees afterwards is genuinely one intent smaller. Returns revokeBlock so the caller can
// waitForIndexed before re-reading.
//
// GET lives in ../budget: it lists the live intents this server holds a key for, which is the
// same set either control can act on.

export async function POST(request: Request) {
  try {
    await requireJudge(request, true);
    const text = await request.text();
    if (text.length > 2048) throw new JudgeControlError('Request too large');
    const { intentHash } = JSON.parse(text) as { intentHash?: string };
    if (typeof intentHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(intentHash)) {
      throw new JudgeControlError('Provide a committed intent hash.');
    }
    return Response.json(await revokeAsJudge(intentHash as Hex), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const known = error instanceof JudgeControlError || error instanceof JudgeAccessError || error instanceof SigningBusy;
    const status = known ? error.status : 503;
    const message =
      known
        ? error.message
        : 'The revocation could not finish. Retry the same action to resume its saved transaction.';
    return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
