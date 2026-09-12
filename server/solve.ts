import 'server-only';
import { encodeFunctionData, erc20Abi, parseAbiItem, type Address, type Hex } from 'viem';
import { solve, hashIntent } from '../solver/dist/index.js';
import type { Intent, ChainState } from '../solver/src/types';
import { chainConfig, abi } from './chain';
import { saveEvidence } from './evidence-store';

export const SEARCH_CONFIG = { maxParticipants: 4, maxCandidates: 100, timeoutMs: 2000 };
export function parseSolveRequest(body: unknown): Hex[] {
  const hashes = (body as { intentHashes?: unknown })?.intentHashes;
  if (!Array.isArray(hashes) || hashes.length < 2 || hashes.length > 4 || hashes.some(h => typeof h !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(h))) {
    throw new Error('Provide 2–4 committed intent hashes');
  }
  const normalized = hashes.map(h => h.toLowerCase() as Hex);
  if (new Set(normalized).size !== normalized.length) throw new Error('Duplicate intent hashes');
  return normalized.sort();
}

/**
 * The freshness floor for discovery (trust rule 2): the block of a transaction the caller just
 * sent, so the pool it searches cannot predate the caller's own action. Optional — a plain
 * search carries no floor, and 0 means "whatever the indexer has".
 */
export function parseMinBlock(body: unknown): bigint {
  const value = (body as { minBlock?: unknown })?.minBlock;
  if (value === undefined || value === null || value === '') return 0n;
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('minBlock must be a block number');
  let block: bigint;
  try { block = BigInt(value); } catch { throw new Error('minBlock must be a block number'); }
  if (block < 0n || block > 10n ** 12n) throw new Error('minBlock is outside the plausible block range');
  return block;
}

export type PoolSource = {
  liveIntents: number;
  excluded: { intentHashes: Hex[]; reason: string }[];
  /** 'subgraph' when discovery came from The Graph; 'rpc' for the local Anvil fallback. */
  kind?: 'subgraph' | 'rpc';
  /** The block the pool snapshot describes — reported so a proposal is traceable to it. */
  snapshotBlock?: string;
  endpoint?: string | null;
};

export async function solveOnChain(hashes: Hex[], committed?: ReadonlyMap<Hex, Intent>, pool?: PoolSource) {
  const discovered = new Map<Hex, Intent>();
  // Graph discovery stays inside its named snapshot. Missing/excluded hashes must never be
  // reconstructed from newer RPC logs while the response still claims Graph provenance.
  if (committed) for (const hash of hashes) {
    const intent = committed.get(hash);
    if (!intent) continue;
    if (hashIntent(intent) !== hash) throw new Error('Committed intent hash mismatch');
    discovered.set(hash, intent);
  }
  if (pool?.kind === 'subgraph' && hashes.some(hash => !discovered.has(hash))) {
    const error = new Error('Requested intents are unavailable in the searchable Graph snapshot. Refresh the pool or supply the commit receipt as minBlock.');
    error.name = 'GraphIntentUnavailable';
    throw error;
  }
  const { client, addresses, usdc, startBlock, chainId } = chainConfig();
  if (await client.getChainId() !== chainId) throw new Error('RPC returned the wrong chain');
  const block = await client.getBlock();
  const event = parseAbiItem('event IntentCommitted(bytes32 indexed intentHash,address indexed owner,uint32 indexed eventId,uint256[] offered,uint256 sessionMask,uint256 sectionMask,uint8 exactCount,bool mustShareSession,bool mustShareSection,bool mustBeAdjacent,int256 maxNetPay,uint64 deadline,uint256 nonce)');
  // Fixed deployment scope, selected hashes, and bounded log range per call. Reached only for
  // hashes discovery did not supply, so a complete subgraph pool scans no logs at all.
  let pages = 0;
  for (let from = startBlock; pool?.kind !== 'subgraph' && discovered.size < hashes.length && from <= block.number; from += 10000n) {
    if (++pages > 100) throw new Error('Discovery range exceeds demo cap; configure an indexed discovery adapter');
    const toBlock = from + 9999n < block.number ? from + 9999n : block.number;
    const logs = await client.getLogs({ address: addresses.IntentRegistry, event, args: { intentHash: hashes }, fromBlock: from, toBlock, strict: true });
    for (const log of logs) {
      const { intentHash: hash, ...fields } = log.args;
      const intent = { ...fields, offered: [...fields.offered] };
      if (hashIntent(intent) !== hash) throw new Error('Committed intent hash mismatch');
      discovered.set(hash, intent);
    }
    if (discovered.size === hashes.length) break;
  }
  if (hashes.some(h => !discovered.has(h))) throw new Error('One or more hashes were not committed on this registry');
  const intents = hashes.map(h => discovered.get(h)!);
  if (intents.some(i => i.offered.length > 4 || i.exactCount > 4)) throw new Error('Demo search supports at most four offered/received tickets per intent');
  const state: ChainState = { ticketMeta: new Map(), depositor: new Map(), intentState: new Map(), usdcBalance: new Map(), usdcAllowance: new Map(), blockTimestamp: block.timestamp };
  const read = <T>(name: keyof typeof addresses, functionName: string, args: unknown[]) => client.readContract({ address: addresses[name], abi: abi(name), functionName, args, blockNumber: block.number }) as Promise<T>;
  for (const intent of intents) {
    const hash = hashIntent(intent);
    state.intentState.set(hash, await read<number>('IntentRegistry', 'state', [hash]));
    const owner = intent.owner.toLowerCase() as Address;
    if (!state.usdcBalance.has(owner)) {
      const [balance, allowance] = await Promise.all([
        client.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [owner], blockNumber: block.number }),
        client.readContract({ address: usdc, abi: erc20Abi, functionName: 'allowance', args: [owner, addresses.Settlement], blockNumber: block.number }),
      ]);
      state.usdcBalance.set(owner, balance);
      state.usdcAllowance.set(owner, allowance);
    }
    for (const tokenId of intent.offered) {
      if (state.ticketMeta.has(tokenId)) continue;
      const [meta, depositor] = await Promise.all([
        read<[number, number, number, number, number, number]>('TicketNFT', 'meta', [tokenId]),
        read<Address>('Escrow', 'depositor', [tokenId]),
      ]);
      const [eventId, sessionId, sectionId, row, seat, status] = meta;
      state.ticketMeta.set(tokenId, { eventId, sessionId, sectionId, row, seat, status });
      state.depositor.set(tokenId, depositor);
    }
  }
  const started = performance.now();
  const result = solve(intents, state, SEARCH_CONFIG);
  const runtimeMs = performance.now() - started;
  const inputExclusions = hashes.flatMap(hash => {
    const intent = discovered.get(hash)!;
    const status = state.intentState.get(hash);
    if (status !== 1) return [{ intentHashes: [hash], reason: `V1: IntentNotLive (state ${status})` }];
    if (intent.deadline < block.timestamp) return [{ intentHashes: [hash], reason: 'V1: IntentExpired' }];
    return [];
  });
  let simulationResult: { success: boolean; error?: string } | undefined;
  let transaction: { to: Address; data: Hex; gas: string; chainId: number } | undefined;
  const simulationBlock = await client.getBlockNumber();
  if (result.chosen) {
    const args = [result.chosen.intents, result.chosen.legs];
    try {
      await client.simulateContract({ address: addresses.Settlement, abi: abi('Settlement'), functionName: 'settle', args, account: addresses.Settlement, gas: 8000000n, blockNumber: simulationBlock });
      simulationResult = { success: true };
      transaction = { to: addresses.Settlement, data: encodeFunctionData({ abi: abi('Settlement'), functionName: 'settle', args }), gas: '8000000', chainId };
    } catch (error) {
      // Decode named rejections without exposing an RPC URL or provider credentials.
      const detail = error as { walk?: (predicate: (e: { name?: string }) => boolean) => { data?: { errorName?: string } } };
      const revert = detail.walk?.(e => e.name === 'ContractFunctionRevertedError');
      simulationResult = { success: false, error: revert?.data?.errorName ?? 'Settlement simulation failed' };
    }
  }
  const excluded = [...(pool?.excluded ?? []), ...inputExclusions, ...result.evidence.candidatesExcluded];
  return saveEvidence({
    ...result.evidence,
    chainId, registry: addresses.IntentRegistry, settlement: addresses.Settlement,
    // Discovery provenance. The subgraph supplies the pool; every value below it was
    // re-read from the chain at blockNumber, which is why index lag can cause a failed
    // simulation but never an invalid settlement.
    source: {
      kind: pool?.kind ?? 'rpc',
      subgraphEndpoint: pool?.endpoint ?? null,
      snapshotBlock: pool?.snapshotBlock ?? null,
      blockNumber: block.number.toString(),
      blockHash: block.hash,
    },
    requestedIntentHashes: hashes, intentsConsidered: intents.length,
    candidatesExcluded: excluded,
    snapshotBlock: pool?.snapshotBlock ?? null,
    candidates: result.candidates,
    excluded,
    ...(pool ? { pool: { liveIntents: pool.liveIntents, searchableIntents: intents.length, excludedIntents: pool.excluded.length, source: pool.kind ?? 'rpc', snapshotBlock: pool.snapshotBlock ?? null } } : {}),
    bounds: SEARCH_CONFIG,
    searchConfig: SEARCH_CONFIG, runtimeMs, simulationBlock: simulationBlock.toString(), simulationResult,
    proposal: result.chosen, transaction,
    message: result.chosen ? 'Candidate found within the search budget' : 'No solution found within the search bound',
  });
}
