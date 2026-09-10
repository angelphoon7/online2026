import { chainConfig } from '@/server/chain';
import { serialize } from '@/server/evidence-store';
import { auditActThree, simulateProposal } from '@/scripts/lib/act-three-proof.mjs';
import record from '@/deployments/act-three.json';
import deployment from '@/deployments/arc-testnet.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
function config() {
  const configured = chainConfig();
  for (const name of Object.keys(configured.addresses) as (keyof typeof configured.addresses)[]) {
    if (configured.addresses[name].toLowerCase() !== deployment.contracts[name].toLowerCase()) throw new Error('Deployment mismatch');
  }
  if (configured.usdc.toLowerCase() !== deployment.usdc.toLowerCase()) throw new Error('USDC mismatch');
  return configured;
}
export async function GET() {
  try {
    const { client } = config();
    const proof = await auditActThree(client, deployment, record);
    return Response.json(JSON.parse(serialize({ ...record, proof })), { headers });
  } catch {
    return Response.json({ error: 'Unable to verify the recorded rejection against Arc. Retry when the RPC is available.' }, { status: 503, headers });
  }
}
export async function POST(request: Request) {
  let mode: 'valid' | 'malicious';
  try {
    const text = await request.text();
    if (text.length > 128) throw new Error();
    mode = JSON.parse(text).mode;
    if (mode !== 'valid' && mode !== 'malicious') throw new Error();
  } catch {
    return Response.json({ error: 'Choose valid or malicious allocation.' }, { status: 400, headers });
  }
  try {
    const { client } = config();
    if (await client.getChainId() !== 5042002) throw new Error('Wrong RPC chain');
    const block = await client.getBlockNumber();
    const result = await simulateProposal(client, deployment, mode === 'valid' ? record.control.proposal : record.malicious, record.proposer, block);
    return Response.json(JSON.parse(serialize(result)), { headers });
  } catch {
    return Response.json({ error: 'Contract simulation unavailable; no named rejection could be verified. Retry after checking the RPC.' }, { status: 503, headers });
  }
}
