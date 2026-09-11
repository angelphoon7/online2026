import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hashIntent } from '@/solver/dist/index.js';
import { abi, chainConfig } from '@/server/chain';
import bundledDemo from '@/deployments/demo-ready.json';
import type { Address, Hex } from 'viem';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Read operator reseeds during local operation; static import also includes the
    // public manifest in hosted builds. No keys or saved proposals are served.
    let demo = bundledDemo;
    try { demo = JSON.parse(await readFile(join(process.cwd(), 'deployments/demo-ready.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const { client, addresses } = chainConfig();
    if (demo.chainId !== 5042002 || demo.settlement.toLowerCase() !== addresses.Settlement.toLowerCase()
      || demo.intents.length !== 3 || new Set(demo.intents.map(i => i.hash)).size !== 3
      || await client.getChainId() !== 5042002) throw new Error('Demo configuration mismatch');
    const block = await client.getBlock();
    const intents = await Promise.all(demo.intents.map(async record => {
      const intent = { ...record, owner: record.owner as Address, offered: record.offered.map(BigInt),
        sessionMask: BigInt(record.sessionMask), sectionMask: BigInt(record.sectionMask),
        maxNetPay: BigInt(record.maxNetPay), deadline: BigInt(record.deadline), nonce: BigInt(record.nonce) };
      if (hashIntent(intent) !== record.hash) throw new Error('Demo hash mismatch');
      const state = await client.readContract({ address: addresses.IntentRegistry, abi: abi('IntentRegistry'),
        functionName: 'state', args: [record.hash as Hex], blockNumber: block.number }) as number;
      return { ...record, state, expired: intent.deadline < block.timestamp };
    }));
    return Response.json({ chainId: 5042002, blockNumber: block.number.toString(), intents }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Demo state is unavailable. Retry after the operator checks Arc configuration and runs demo:prepare.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
