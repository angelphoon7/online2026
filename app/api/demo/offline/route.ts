import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chainConfig } from '@/server/chain';
import { auditOffline } from '@/scripts/lib/offline-proof.mjs';
import deployment from '@/deployments/arc-testnet.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { client, addresses, usdc } = chainConfig();
    for (const name of Object.keys(addresses) as (keyof typeof addresses)[]) {
      if (addresses[name].toLowerCase() !== deployment.contracts[name].toLowerCase()) throw new Error('Deployment mismatch');
    }
    if (usdc.toLowerCase() !== deployment.usdc.toLowerCase()) throw new Error('USDC mismatch');
    const record = JSON.parse(await readFile(path.join(process.cwd(), 'deployments/offline-demo.json'), 'utf8'));
    const proof = await auditOffline(client, deployment, record);
    return Response.json({ proof, closure: record.closure, participantProcess: record.participantProcess, solverProcess: record.solverProcess, evidence: record.evidence }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Unable to verify the recorded offline settlement against Arc. Retry when the RPC and proof file are available.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
