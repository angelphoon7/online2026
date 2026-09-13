import type { MarketSnapshot } from './market-types';
import type { SettlementProposal, SolveEvidence } from './solve-api';

// A lagging indexer cannot invalidate a newer solver result. This only detects
// known changes; the exact proposal still needs live simulation before submission.
export function matchUnavailable(proposal: SettlementProposal | null, evidence: SolveEvidence | null, market: MarketSnapshot | null): boolean {
  if (!proposal || !evidence || !market || BigInt(market.blockNumber) < BigInt(evidence.source.blockNumber)) return false;
  return proposal.legs.some((leg, index) => {
    const intent = proposal.intents[index];
    const current = market.intents.find(item => item.hash.toLowerCase() === leg.intentHash.toLowerCase());
    if (!current || current.state !== 1 || current.expired || intent.deadline < BigInt(market.timestamp)) return true;
    return intent.offered.some(id => {
      const ticket = market.tickets.find(item => item.tokenId === id.toString());
      return !ticket || ticket.status !== 0 || ticket.depositor.toLowerCase() !== intent.owner.toLowerCase();
    });
  });
}
