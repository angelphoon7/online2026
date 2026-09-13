import { randomUUID } from 'node:crypto';
import { parseEther } from 'viem';
import { durableStore, storageMode } from '@/server/durable-store';
import { judgingStatus } from '@/server/judging-demo';
import { judgeAccessConfigured, judgeControlsEnabled, allowedIntent } from '@/server/judge-access';
import { participantKeys } from '@/server/judge-budget';
import { checkDemoIssuer } from '@/server/demo-tickets';
import { chainConfig } from '@/server/chain';
import { graphIntents } from '@/server/solve-graph';
import { checkAgentRateLimit } from '@/server/agent/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export async function GET(request: Request) {
  const checks: Record<string, boolean> = { agentRateLimit: false, storage: false, graph: false, demoGroups: false, judgeAccess: false, judgeSigners: false, ticketIssuer: false, signingIdle: false };
  let mode: string | null = null, snapshotBlock: string | null = null;
  try { await checkAgentRateLimit(request); checks.agentRateLimit = true; }
  catch { /* Keep readiness false if trusted identity or shared admission is unavailable. */ }
  try {
    mode = storageMode();
    const store = durableStore(), key = `health:${randomUUID()}`;
    checks.storage = await store.compareAndSet(key, null, 'ok', { ttlMs: 60_000 }) && await store.get(key) === 'ok';
    await store.compareAndSet(key, 'ok', null);
    checks.signingIdle = (await Promise.all([...participantKeys().keys()].map(owner => store.get(`signing:active:5042002:${owner}`)))).every(active => active === null);
    const status = await judgingStatus();
    snapshotBlock = status.snapshotBlock;
    checks.graph = status.lagSeconds <= 120;
    checks.demoGroups = status.groups.every(g => g.available);
    checks.judgeAccess = judgeControlsEnabled() && judgeAccessConfigured();
    if (checks.judgeAccess) {
      const hashes = status.groups.flatMap(g => g.hashes), { committed } = await graphIntents(hashes, BigInt(status.snapshotBlock));
      const holders = participantKeys(), { client } = chainConfig();
      const editable = [];
      for (const [hash, intent] of committed) if (await allowedIntent(hash) && holders.has(intent.owner.toLowerCase() as `0x${string}`)) editable.push(intent);
      const owners = [...new Set(editable.map(i => i.owner))];
      checks.judgeSigners = owners.length > 0 && (await Promise.all(owners.map(address => client.getBalance({ address })))).every(balance => balance >= parseEther('0.2'));
    }
    try {
      const { client, account } = await checkDemoIssuer();
      checks.signingIdle = checks.signingIdle && await store.get(`signing:active:5042002:${account.address.toLowerCase()}`) === null;
      checks.ticketIssuer = await client.getBalance({ address: account.address }) >= parseEther('0.2');
    } catch { /* Report a failed capability without exposing credentials or provider errors. */ }
  } catch { /* Failed checks stay false; this endpoint never returns secrets or provider diagnostics. */ }
  const ready = Object.values(checks).every(Boolean);
  return Response.json({ ready, checks, storage: mode, snapshotBlock }, { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
