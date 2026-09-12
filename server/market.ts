import 'server-only';
import { createPublicClient, http, parseAbiItem, type Address, type Hex } from 'viem';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { abi, chainConfig } from './chain';
import { serialize } from './evidence-store';
import { restoreIntent, type MarketSnapshot } from '@/lib/market-types';
import type { IntentParams } from '@/lib/contracts';
import demo from '@/deployments/demo-ready.json';
import { marketSnapshotFromGraph } from './market-graph';

// Which source assembles the market: the subgraph (default on Arc) or direct RPC reads.
// Studio cannot index a local Anvil chain, so local development must use 'rpc'.
// The two produce an identical MarketSnapshot; only the discovery mechanism differs.
export const readSource = () => process.env.READ_SOURCE ?? (process.env.SUBGRAPH_URL ? 'graph' : 'rpc');

const committedEvent = parseAbiItem('event IntentCommitted(bytes32 indexed intentHash,address indexed owner,uint32 indexed eventId,uint256[] offered,uint256 sessionMask,uint256 sectionMask,uint8 exactCount,bool mustShareSession,bool mustShareSection,bool mustBeAdjacent,int256 maxNetPay,uint64 deadline,uint256 nonce)');
const settledEvent = parseAbiItem('event Settled(address indexed proposer,bytes32[] intentHashes,uint256 participantCount)');
let cached: { key: string; until: number; blockHash: Hex; value: MarketSnapshot } | undefined;
let pending: Promise<MarketSnapshot> | undefined;

export async function marketSnapshot(fresh = false, minBlock = 0n): Promise<MarketSnapshot> {
  if (readSource() === 'graph') return marketSnapshotFromGraph(minBlock);
  return marketSnapshotFromRpc(fresh);
}

async function marketSnapshotFromRpc(fresh = false): Promise<MarketSnapshot> {
  const { addresses, startBlock, chainId } = chainConfig();
  const client = createPublicClient({ transport: http(process.env.ARC_RPC!, { batch: { batchSize: 8, wait: 25 }, retryCount: 4, retryDelay: 1500 }) });
  const pause = () => new Promise(resolve => setTimeout(resolve, 750));
  const key = `${addresses.IntentRegistry}:${startBlock}`;
  if (!fresh && cached?.key === key && cached.until > Date.now()) return cached.value;
  if (pending) return pending;
  pending = (async () => {
    if (await client.getChainId() !== chainId) throw new Error('Wrong RPC chain');
    const block = await client.getBlock();
    const read = (name: keyof typeof addresses, functionName: string, args: unknown[] = []) => client.readContract({ address: addresses[name], abi: abi(name), functionName, args, blockNumber: block.number }).catch(error => { throw new Error(`${name}.${functionName}: ${error.shortMessage ?? error.name}`); });
    const count = await read('TicketNFT', 'nextTokenId') as bigint;
    if (count > 1000n || block.number - startBlock > 2000000n) throw new Error('Demo discovery bound exceeded; configure an indexer');
    const tickets = [];
    for (let first = 0; first < Number(count); first += 2) {
      tickets.push(...await Promise.all(Array.from({ length: Math.min(2, Number(count) - first) }, async (_, offset) => {
        const tokenId = BigInt(first + offset);
        const [meta, owner, depositor] = await Promise.all([read('TicketNFT', 'meta', [tokenId]), read('TicketNFT', 'ownerOf', [tokenId]), read('Escrow', 'depositor', [tokenId])]);
        const [eventId, sessionId, sectionId, row, seat, status] = meta as [number, number, number, number, number, number];
        return { tokenId, eventId, sessionId, sectionId, row, seat, status, owner: owner as Address, depositor: depositor as Address };
      })));
      await pause();
    }
    // Reuse discovered event data, never mutable custody or intent state. Verify the
    // previous boundary hash so a reorg causes a full scan instead of stale history.
    const previous = cached?.key === key && cached.blockHash === (await client.getBlock({ blockNumber: BigInt(cached.value.blockNumber) })).hash ? cached.value : null;
    const records: { args: IntentParams & { intentHash: Hex }; transactionHash: Hex }[] = previous?.intents.map(i => ({ args: { ...restoreIntent(i), intentHash: i.hash }, transactionHash: i.commitTx })) ?? [];
    const settlements = previous?.settlements.map(r => ({ hash: r.hash, block: BigInt(r.block), participants: BigInt(r.participants) })).reverse() ?? [];
    for (let from = previous ? BigInt(previous.blockNumber) + 1n : startBlock; from <= block.number; from += 10000n) {
      const to = from + 9999n < block.number ? from + 9999n : block.number;
      // Pace historical log queries to avoid Arc RPC rate limits on cold scans,
      // even when ranges are empty; a cold scan must not burst through history.
      const commits = await client.getLogs({ address: addresses.IntentRegistry, event: committedEvent, fromBlock: from, toBlock: to, strict: true });
      await new Promise(resolve => setTimeout(resolve, 1100));
      const executions = await client.getLogs({ address: addresses.Settlement, event: settledEvent, fromBlock: from, toBlock: to, strict: true });
      await new Promise(resolve => setTimeout(resolve, 1100));
      records.push(...commits.map(l => ({ args: { ...l.args, offered: [...l.args.offered] }, transactionHash: l.transactionHash! })));
      settlements.push(...executions.map(l => ({ hash: l.transactionHash!, block: l.blockNumber!, participants: l.args.participantCount })));
    }
    const intents = [];
    for (let first = 0; first < records.length; first += 4) {
      intents.push(...await Promise.all(records.slice(first, first + 4).map(async l => ({ ...l.args,
        hash: l.args.intentHash, commitTx: l.transactionHash,
        state: await read('IntentRegistry', 'state', [l.args.intentHash]), expired: l.args.deadline < block.timestamp,
      }))));
      await pause();
    }
    let currentDemo = demo;
    try { currentDemo = JSON.parse(await readFile(join(process.cwd(), 'deployments/demo-ready.json'), 'utf8')); } catch { /* Bundled public manifest. */ }
    const value = JSON.parse(serialize({ blockNumber: block.number, timestamp: block.timestamp, tickets, intents,
      settlements: settlements.reverse(), defaultHashes: currentDemo.intents.map(i => i.hash) })) as MarketSnapshot;
    cached = { key, blockHash: block.hash, until: Date.now() + 30000, value };
    return value;
  })().finally(() => { pending = undefined; });
  return pending;
}
