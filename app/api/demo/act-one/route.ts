import { chainConfig } from '@/server/chain';
import { auditActOne } from '@/scripts/lib/act-one-proof.mjs';
import record from '@/deployments/act-one.json';
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
    const proof = await auditActOne(client, deployment, record.evidence, record.proof.transactionHash);
    return Response.json({ proof, evidence: record.evidence, setupTransactions: record.setupTransactions }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Unable to verify the recorded settlement against Arc. Retry when the RPC is available.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
