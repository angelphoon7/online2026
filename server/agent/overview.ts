import 'server-only';
import type { Snapshot } from '@/shared/graph';

// pool_overview - step 7 of docs/RESHUFFLE_GRAPH_PLAN.md.
//
// "What is in the pool right now?" answered from the pinned snapshot. Counts only: this is the
// tool the model reaches for when a question is about the market rather than one intent, and
// every number here is a count of entities the subgraph returned at snapshot.block.

export type PoolOverview = {
  block: string;
  liveIntents: number;
  escrowedTickets: number;
  /** Intents the snapshot kept out of the pool, grouped by the check that removed them. */
  excludedByReason: Record<string, number>;
  bySession: { sessionId: number; tickets: number }[];
  bySection: { sectionId: number; tickets: number }[];
  /** Live intents wanting nothing - pure sellers. exactCount 0 is valid. */
  pureSellers: number;
  /** Live intents offering nothing - pure buyers. */
  pureBuyers: number;
};

export function poolOverview(snapshot: Snapshot): PoolOverview {
  const bySession = new Map<number, number>();
  const bySection = new Map<number, number>();
  for (const meta of snapshot.ticketMeta.values()) {
    bySession.set(meta.sessionId, (bySession.get(meta.sessionId) ?? 0) + 1);
    bySection.set(meta.sectionId, (bySection.get(meta.sectionId) ?? 0) + 1);
  }

  const excludedByReason: Record<string, number> = {};
  for (const excluded of snapshot.excluded) {
    excludedByReason[excluded.reason] = (excludedByReason[excluded.reason] ?? 0) + 1;
  }

  return {
    block: snapshot.block.toString(),
    liveIntents: snapshot.intents.length,
    // The snapshot's ticket universe is already escrowed and unredeemed - that is what
    // getPoolSnapshot selects, because it is what can actually be reshuffled.
    escrowedTickets: snapshot.ticketMeta.size,
    excludedByReason,
    bySession: [...bySession.entries()].sort((a, b) => a[0] - b[0]).map(([sessionId, tickets]) => ({ sessionId, tickets })),
    bySection: [...bySection.entries()].sort((a, b) => a[0] - b[0]).map(([sectionId, tickets]) => ({ sectionId, tickets })),
    pureSellers: snapshot.intents.filter((i) => i.exactCount === 0).length,
    pureBuyers: snapshot.intents.filter((i) => i.offered.length === 0).length,
  };
}
