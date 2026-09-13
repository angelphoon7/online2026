import 'server-only';
import { parseAbiItem, type Abi, type Address, type Hex } from 'viem';
import { abi } from './chain';
import { serialize } from './evidence-store';
import { readSolverState, type solverReadClient } from './solve-rpc';
import { restoreIntent, type MarketSnapshot } from '@/lib/market-types';
import type { IntentParams } from '@/lib/contracts';

// Arc's deployed read aggregator: https://docs.arc.io/arc/references/contract-addresses
const MULTICALL = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;
const committedEvent = parseAbiItem('event IntentCommitted(bytes32 indexed intentHash,address indexed owner,uint32 indexed eventId,uint256[] offered,uint256 sessionMask,uint256 sectionMask,uint8 exactCount,bool mustShareSession,bool mustShareSection,bool mustBeAdjacent,int256 maxNetPay,uint64 deadline,uint256 nonce)');
const settledEvent = parseAbiItem('event Settled(address indexed proposer,bytes32[] intentHashes,uint256 participantCount)');
type Client = Pick<ReturnType<typeof solverReadClient>, 'getChainId' | 'getBlock' | 'getBytecode' | 'getLogs' | 'readContract' | 'multicall'>;
type Contracts = Record<'TicketNFT' | 'Escrow' | 'IntentRegistry' | 'Settlement', Address>;
type Call = { address: Address; abi: Abi; functionName: string; args: readonly unknown[] };
type Commitment = { args: IntentParams & { intentHash: Hex }; transactionHash: Hex };
type Execution = { hash: Hex; block: bigint; participants: bigint };
export type RpcCheckpoint = { blockHash: Hex; value: MarketSnapshot };
type HistoryStore = { load: () => Promise<RpcCheckpoint | null>; save: (checkpoint: RpcCheckpoint) => Promise<void> };

// One instance per RPC/chain/deployment. Share completed snapshots only briefly and
// only above the caller's receipt floor; a forced refresh always reads live state.
export function createRpcMarketReader(client: Client, addresses: Contracts, chainId: number, startBlock: bigint, history?: HistoryStore) {
  let cached: { until: number; blockHash: Hex; value: MarketSnapshot } | undefined;
  let pending: Promise<MarketSnapshot> | undefined;
  let multicallAvailable: boolean | undefined;
  let restored: Promise<void> | undefined;
  let progress: { block: bigint; blockHash: Hex; nextBlock: bigint; records: Commitment[]; settlements: Execution[] } | undefined;

  async function load(minBlock: bigint): Promise<MarketSnapshot> {
    if (await client.getChainId() !== chainId) throw new Error('Wrong RPC chain');
    const block = await client.getBlock();
    if (block.number < minBlock) throw new Error(`ChainLag: read block ${block.number}, needed ${minBlock}`);
    if (block.number - startBlock > 2000000n) throw new Error('Demo discovery bound exceeded; configure an indexer');
    const call = (name: keyof Contracts, functionName: string, args: readonly unknown[] = []): Call => ({ address: addresses[name], abi: abi(name), functionName, args });
    const count = await client.readContract({ ...call('TicketNFT', 'nextTokenId'), blockNumber: block.number }) as bigint;
    if (count > 1000n) throw new Error('Demo discovery bound exceeded; configure an indexer');
    if (multicallAvailable === undefined) {
      const code = chainId === 5042002 ? await client.getBytecode({ address: MULTICALL, blockNumber: block.number }) : undefined;
      multicallAvailable = !!code && code !== '0x';
    }
    const readMany = async (calls: Call[]) => {
      const values: unknown[] = new Array(calls.length);
      if (multicallAvailable) {
        const jobs: (() => Promise<void>)[] = [];
        // Aggregate up to 96 read-only calls per request; never silently omit a failure.
        for (let offset = 0; offset < calls.length; offset += 96) {
          jobs.push(async () => {
            const result = await client.multicall({ contracts: calls.slice(offset, offset + 96), multicallAddress: MULTICALL,
              allowFailure: false, batchSize: 0, blockNumber: block.number });
            result.forEach((value, index) => { values[offset + index] = value; });
          });
        }
        await readSolverState(jobs, 4);
      } else {
        // Local Anvil deployments need no Multicall contract.
        await readSolverState(calls.map((item, index) => async () => {
          values[index] = await client.readContract({ ...item, blockNumber: block.number });
        }), 4);
      }
      return values;
    };

    const calls = Array.from({ length: Number(count) }, (_, index) => BigInt(index)).flatMap(id => [
      call('TicketNFT', 'meta', [id]), call('TicketNFT', 'ownerOf', [id]), call('Escrow', 'depositor', [id]),
    ]);
    const values = await readMany(calls);
    const tickets = Array.from({ length: Number(count) }, (_, index) => {
      const [eventId, sessionId, sectionId, row, seat, status] = values[index * 3] as [number, number, number, number, number, number];
      return { tokenId: BigInt(index), eventId, sessionId, sectionId, row, seat, status,
        owner: values[index * 3 + 1] as Address, depositor: values[index * 3 + 2] as Address };
    });

    // Reuse immutable event history only after verifying its chain boundary. Mutable
    // ticket custody, redemption and every intent state are re-read at the new block.
    const previous = cached && BigInt(cached.value.blockNumber) <= block.number
      && (await client.getBlock({ blockNumber: BigInt(cached.value.blockNumber) })).hash === cached.blockHash ? cached.value : null;
    const resumed = progress && progress.block <= block.number
      && (await client.getBlock({ blockNumber: progress.block })).hash === progress.blockHash ? progress : null;
    const records: Commitment[] = resumed?.records ?? previous?.intents.map(item => ({ args: { ...restoreIntent(item), intentHash: item.hash }, transactionHash: item.commitTx })) ?? [];
    const settlements: Execution[] = resumed?.settlements ?? previous?.settlements.map(item => ({ hash: item.hash, block: BigInt(item.block), participants: BigInt(item.participants) })).reverse() ?? [];
    const nextBlock = resumed?.nextBlock ?? (previous ? BigInt(previous.blockNumber) + 1n : startBlock);
    progress = { block: block.number, blockHash: block.hash, nextBlock, records, settlements };
    const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
    for (let fromBlock = nextBlock; fromBlock <= block.number; fromBlock += 10000n) {
      ranges.push({ fromBlock, toBlock: fromBlock + 9999n < block.number ? fromBlock + 9999n : block.number });
    }
    for (const [index, range] of ranges.entries()) {
      // One filter covers both event types and contracts. History reads have a much
      // tighter upstream quota than eth_call, so issue one page at a time.
      const page = await client.getLogs({ address: [addresses.IntentRegistry, addresses.Settlement],
        events: [committedEvent, settledEvent], ...range, strict: true });
      for (const log of page) {
        const event = log as unknown as { eventName: string; args: Commitment['args'] & { participantCount: bigint }; address: Address; transactionHash: Hex; blockNumber: bigint };
        if (event.eventName === 'IntentCommitted' && event.address.toLowerCase() === addresses.IntentRegistry.toLowerCase()) {
          records.push({ args: { ...event.args, offered: [...event.args.offered] }, transactionHash: event.transactionHash });
        } else if (event.eventName === 'Settled' && event.address.toLowerCase() === addresses.Settlement.toLowerCase()) {
          settlements.push({ hash: event.transactionHash, block: event.blockNumber, participants: event.args.participantCount });
        }
      }
      // A provider cooldown must not throw away already verified discovery work.
      // Partial history stays internal; it is never exposed as a complete market.
      progress.nextBlock = range.toBlock + 1n;
      if (index + 1 < ranges.length) await new Promise(resolve => setTimeout(resolve, 550));
    }
    const states = await readMany(records.map(item => call('IntentRegistry', 'state', [item.args.intentHash])));
    const intents = records.map((item, index) => ({ ...item.args, hash: item.args.intentHash, commitTx: item.transactionHash,
      state: states[index], expired: item.args.deadline < block.timestamp }));
    // Block-number reads must still describe one fork if the head changed mid-load.
    if ((await client.getBlock({ blockNumber: block.number })).hash !== block.hash) throw new Error('RPC snapshot changed during loading; retry');
    const value = JSON.parse(serialize({ blockNumber: block.number, timestamp: block.timestamp, tickets, intents,
      settlements: [...settlements].reverse(), defaultHashes: [], source: 'rpc', hashMismatched: [] })) as MarketSnapshot;
    cached = { value, blockHash: block.hash, until: Date.now() + 10000 };
    await history?.save({ value, blockHash: block.hash }).catch(() => {});
    progress = undefined;
    return value;
  }

  return async function read(fresh = false, minBlock = 0n): Promise<MarketSnapshot> {
    if (!restored) restored = (async () => {
      const checkpoint = await history?.load().catch(() => null);
      if (checkpoint) cached = { ...checkpoint, until: 0 };
    })();
    await restored;
    if (!fresh && cached && cached.until > Date.now() && BigInt(cached.value.blockNumber) >= minBlock) return cached.value;
    if (pending) {
      const value = await pending;
      if (BigInt(value.blockNumber) >= minBlock) return value;
      // A write may have landed while an older request was in flight. Its caller gets
      // a new read; sharing work never lowers the receipt floor.
    }
    if (!pending) {
      const request = load(minBlock).finally(() => { if (pending === request) pending = undefined; });
      pending = request;
    }
    const value = await pending;
    if (BigInt(value.blockNumber) < minBlock) throw new Error(`ChainLag: read block ${value.blockNumber}, needed ${minBlock}`);
    return value;
  };
}
