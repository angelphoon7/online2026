import 'server-only';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Hex } from 'viem';
import { chainConfig } from './chain';
import type { MarketSnapshot } from '@/lib/market-types';
import demo from '@/deployments/demo-ready.json';
import { marketSnapshotFromGraph } from './market-graph';
import { createRpcMarketReader, type RpcCheckpoint } from './market-rpc';
import { solverReadClient } from './solve-rpc';
import { DEPLOYMENT } from '@/lib/deployment';

// Discovery is explicitly configured; Graph failures never silently change provenance.
export const readSource = () => process.env.READ_SOURCE?.trim() || (process.env.SUBGRAPH_URL?.trim() || DEPLOYMENT.subgraphUrl ? 'graph' : 'rpc');
let rpcReader: { key: string; read: ReturnType<typeof createRpcMarketReader> } | undefined;

export async function marketSnapshot(fresh = false, minBlock = 0n, signal?: AbortSignal): Promise<MarketSnapshot> {
  if (readSource() === 'graph') return marketSnapshotFromGraph(minBlock, { signal });
  const { addresses, startBlock, chainId, rpcUrl } = chainConfig();
  const key = JSON.stringify([chainId, rpcUrl, addresses, startBlock.toString()]);
  if (rpcReader?.key !== key) {
    const directory = join(process.cwd(), '.data', 'rpc-market');
    const file = join(directory, `${createHash('sha256').update(key).digest('hex')}.json`);
    // A local restart reuses verified event history. It never displays a persisted
    // snapshot directly: all mutable state is read again and the boundary is checked.
    const history = process.env.NODE_ENV === 'development' ? {
      async load(): Promise<RpcCheckpoint | null> {
        const checkpoint = JSON.parse(await readFile(file, 'utf8')) as RpcCheckpoint;
        if (!/^0x[0-9a-f]{64}$/i.test(checkpoint.blockHash) || checkpoint.value?.source !== 'rpc'
          || !/^\d+$/.test(checkpoint.value.blockNumber) || !Array.isArray(checkpoint.value.intents)
          || !Array.isArray(checkpoint.value.settlements)) return null;
        return checkpoint;
      },
      async save(checkpoint: RpcCheckpoint) {
        await mkdir(directory, { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify(checkpoint));
        await rename(`${file}.tmp`, file);
      },
    } : undefined;
    rpcReader = { key, read: createRpcMarketReader(solverReadClient(rpcUrl, chainId, 2), addresses, chainId, startBlock, history) };
  }
  const snapshot = await rpcReader.read(fresh, minBlock);
  let currentDemo = demo;
  try { currentDemo = JSON.parse(await readFile(join(process.cwd(), 'deployments/demo-ready.json'), 'utf8')); } catch { /* Bundled public manifest. */ }
  return { ...snapshot, defaultHashes: currentDemo.intents.map(item => item.hash as Hex) };
}
