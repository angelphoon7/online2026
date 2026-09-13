import 'server-only';
import type { Address, Hex } from 'viem';
import { readGraphPages, type GraphPageMeta, type GraphPageOptions } from '@/shared/graph/pages';
import { hashIntent, fromGraph, type GraphIntent } from '@/shared/intent';
import type { MarketSnapshot, WireIntent, ChainTicket } from '@/lib/market-types';
import demo from '@/deployments/demo-ready.json';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// The subgraph-backed MarketSnapshot — step 6-A of docs/RESHUFFLE_GRAPH_PLAN.md.
//
// Produces exactly the same MarketSnapshot as server/market.ts, so every selector in
// lib/chain-reads.ts and every component stays untouched; only the source changes. The RPC
// implementation remains as the fallback for local Anvil, which Studio cannot index.
//
// Why this is the change that matters: the RPC path reads every ticket individually and scans
// log ranges in 10k-block windows, pacing itself with 750ms and 1100ms sleeps to stay under
// Arc's rate limits, and it refuses outright past 1000 tickets or 2M blocks ("Demo discovery
// bound exceeded; configure an indexer"). That bound is the thing an indexer removes.
//
// This is DISCOVERY. Nothing here is trusted on its own: every intent is re-hashed against the
// id it was published under (trust rule 1), and settlement still re-reads registry state,
// custody and payment capacity from the chain before proposing.

const ZERO = '0x0000000000000000000000000000000000000000' as Address;

const STATE_NUMBER = { LIVE: 1, REVOKED: 2, SETTLED: 3 } as const;

/**
 * The whole market, not just the live pool.
 *
 * Deliberately not getPoolSnapshot(): that returns only LIVE intents and escrowed, unredeemed
 * tickets because it feeds the solver. The UI shows revoked and settled intents, redeemed
 * tickets and settlement history too.
 */
export const MARKET = /* GraphQL */ `
  query Market($first: Int!, $at: Block_height!, $intentsAfter: Bytes!, $ticketsAfter: String!, $settlementsAfter: Bytes!, $with_intents: Boolean!, $with_tickets: Boolean!, $with_settlements: Boolean!) {
    _meta(block: $at) {
      block {
        number
        timestamp
        hash
      }
      hasIndexingErrors
      deployment
    }
    intents(first: $first, where: { id_gt: $intentsAfter }, orderBy: id, orderDirection: asc, block: $at) @include(if: $with_intents) {
      id
      owner
      eventId
      offered
      sessionMask
      sectionMask
      exactCount
      mustShareSession
      mustShareSection
      mustBeAdjacent
      maxNetPay
      deadline
      nonce
      state
      committedTx
      committedAtBlock
    }
    tickets(first: $first, where: { id_gt: $ticketsAfter }, orderBy: id, orderDirection: asc, block: $at) @include(if: $with_tickets) {
      id
      eventId
      sessionId
      sectionId
      row
      seat
      owner
      depositor
      redeemed
    }
    settlements(first: $first, where: { id_gt: $settlementsAfter }, orderBy: id, orderDirection: asc, block: $at) @include(if: $with_settlements) {
      id
      txHash
      blockNumber
      participantCount
    }
  }
`;

type MarketResponse = {
  _meta: GraphPageMeta;
  intents: (GraphIntent & { state: keyof typeof STATE_NUMBER; committedTx: string; committedAtBlock: string })[];
  tickets: {
    id: string;
    eventId: number;
    sessionId: number;
    sectionId: number;
    row: number;
    seat: number;
    owner: string;
    depositor: string | null;
    redeemed: boolean;
  }[];
  settlements: { id: string; txHash: string; blockNumber: string; participantCount: string }[];
};

export async function marketSnapshotFromGraph(minBlock = 0n, options: Omit<GraphPageOptions, 'minBlock'> = {}): Promise<MarketSnapshot> {
  const data = await readGraphPages<MarketResponse>(MARKET, { intents: '0x', tickets: '', settlements: '0x' }, { ...options, minBlock });

  const blockNumber = BigInt(data._meta.block.number);
  const timestamp = BigInt(data._meta.block.timestamp);

  // Cursor order is lexical id order. Restore presentation order after all pages finish.
  data.tickets.sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);
  data.intents.sort((a, b) => BigInt(a.committedAtBlock) < BigInt(b.committedAtBlock) ? -1
    : BigInt(a.committedAtBlock) > BigInt(b.committedAtBlock) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  data.settlements.sort((a, b) => BigInt(a.blockNumber) > BigInt(b.blockNumber) ? -1
    : BigInt(a.blockNumber) < BigInt(b.blockNumber) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const tickets: ChainTicket[] = data.tickets.map((t) => ({
    tokenId: t.id,
    eventId: Number(t.eventId),
    sessionId: Number(t.sessionId),
    sectionId: Number(t.sectionId),
    row: Number(t.row),
    seat: Number(t.seat),
    // ChainTicket.status follows TicketNFT: 0 active, 1 redeemed.
    status: t.redeemed ? 1 : 0,
    owner: t.owner as Address,
    // The RPC path reads Escrow.depositor, which is the zero address when not escrowed;
    // ticketHolder() in lib/chain-reads.ts depends on that, so keep it rather than null.
    depositor: (t.depositor ?? ZERO) as Address,
  }));

  const intents: WireIntent[] = [];
  const hashMismatched: Hex[] = [];
  for (const g of data.intents) {
    // Trust rule 1: an intent that does not re-hash to its published id is not shown at all.
    // Dropping it is right — it would be an intent nobody actually signed. It is named rather
    // than dropped in silence: an intent vanishing from the pool with no reason given is
    // indistinguishable from a missing one, and this is the check that makes the indexer
    // untrusted rather than trusted.
    const intent = fromGraph(g);
    if (hashIntent(intent) !== g.id) {
      hashMismatched.push(g.id as Hex);
      console.warn(`Subgraph intent ${g.id} does not re-hash to its committed id; excluded from the market.`);
      continue;
    }

    intents.push({
      owner: g.owner as Address,
      offered: g.offered,
      eventId: Number(g.eventId),
      sessionMask: g.sessionMask,
      sectionMask: g.sectionMask,
      exactCount: Number(g.exactCount),
      mustShareSession: g.mustShareSession,
      mustShareSection: g.mustShareSection,
      mustBeAdjacent: g.mustBeAdjacent,
      maxNetPay: g.maxNetPay,
      deadline: g.deadline,
      nonce: g.nonce,
      hash: g.id as Hex,
      commitTx: g.committedTx as Hex,
      state: STATE_NUMBER[g.state],
      // Expiry is evaluated at the indexed block, matching how the RPC path uses block.timestamp.
      expired: BigInt(g.deadline) < timestamp,
    });
  }

  // The JSON import widens hash to string; the manifest is a local file, not subgraph data.
  let currentDemo: { intents: { hash: string }[] } = demo;
  try {
    currentDemo = JSON.parse(await readFile(join(process.cwd(), 'deployments/demo-ready.json'), 'utf8'));
  } catch {
    /* Fall back to the bundled public manifest. */
  }

  return {
    blockNumber: blockNumber.toString(),
    timestamp: timestamp.toString(),
    tickets,
    intents,
    settlements: data.settlements.map((s) => ({
      hash: s.txHash as Hex,
      block: s.blockNumber,
      participants: s.participantCount,
    })),
    defaultHashes: currentDemo.intents.map((i) => i.hash as Hex),
    source: 'graph',
    hashMismatched,
  };
}
