import { parseEventLogs, type Hex } from 'viem';
import { abi, chainConfig } from '@/server/chain';
import { readEvidence, saveEvidence } from '@/server/evidence-store';

export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const record = await readEvidence(id);
  if (!record?.transaction) return Response.json({ error: 'No simulated transaction for this evidence' }, { status: 404 });
  let hash: Hex;
  try {
    const text = await request.text();
    if (text.length > 256) throw new Error();
    hash = JSON.parse(text).transactionHash;
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error();
  } catch { return Response.json({ error: 'Invalid transaction hash' }, { status: 400 }); }
  try {
    const { client, addresses } = chainConfig();
    if (await client.getChainId() !== record.chainId) throw new Error('Wrong chain');
    const [receipt, tx] = await Promise.all([client.getTransactionReceipt({ hash }), client.getTransaction({ hash })]);
    if (receipt.status !== 'success' || tx.to?.toLowerCase() !== addresses.Settlement.toLowerCase() || tx.input.toLowerCase() !== record.transaction.data.toLowerCase()) throw new Error('Transaction mismatch');
    const logs = parseEventLogs({ abi: abi('Settlement'), eventName: 'Settled', logs: receipt.logs.filter(l => l.address.toLowerCase() === addresses.Settlement.toLowerCase()) });
    if (logs.length !== 1) throw new Error('Missing settlement event');
    const event = logs[0].args as { intentHashes: Hex[]; participantCount: bigint };
    const expected = record.proposal.legs.map((l: { intentHash: Hex }) => l.intentHash);
    if (JSON.stringify(event.intentHashes) !== JSON.stringify(expected)) throw new Error('Intent mismatch');
    for (const intentHash of expected) {
      const state = await client.readContract({ address: addresses.IntentRegistry, abi: abi('IntentRegistry'), functionName: 'state', args: [intentHash], blockNumber: receipt.blockNumber });
      if (state !== 3) throw new Error('Intent did not settle');
    }
    return Response.json(await saveEvidence({ ...record, transactionHash: hash, receipt: { status: receipt.status, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash, participantCount: event.participantCount.toString(), confirmed: true } }, id));
  } catch {
    return Response.json({ error: 'Receipt is unavailable or does not match this settlement evidence' }, { status: 409 });
  }
}
