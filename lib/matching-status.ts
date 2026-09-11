import type { Address, Hex } from 'viem';
import type { MarketSnapshot, WireIntent } from './market-types';
import type { SettlementProposal, SolveEvidence } from './solve-api';

export function latestRequest(market: MarketSnapshot, account: Address | null) {
  return market.intents.filter(i => i.eventId === 1 && i.owner.toLowerCase() === account?.toLowerCase())
    .sort((a, b) => BigInt(a.nonce) > BigInt(b.nonce) ? -1 : BigInt(a.nonce) < BigInt(b.nonce) ? 1 : a.hash.localeCompare(b.hash))[0];
}

export function automaticSelection(market: MarketSnapshot): Hex[] {
  const live = market.intents.filter(i => i.eventId === 1 && i.state === 1 && !i.expired);
  return live.map(i => i.hash).sort();
}

export function matchingStatus(request: WireIntent, selected: Hex[], solving: boolean, error: string, proposal: SettlementProposal | null, evidence: SolveEvidence | null) {
  if (request.state === 3) return { title: 'Swap confirmed', detail: 'The registry marks this intent as settled on-chain. Open Past settlements to inspect the transaction and received tickets.' };
  if (request.state === 2) return { title: 'Request revoked', detail: 'This request has been cancelled on-chain. Create a new intent to look for another swap.' };
  if (request.expired) return { title: 'Request expired', detail: 'The signed deadline has passed. This request can no longer settle.' };
  if (request.state !== 1) return { title: 'Request unavailable', detail: 'Refresh public state to check this request.' };
  if (!selected.includes(request.hash)) return { title: 'Your request is outside this search', detail: 'Resume automatic matching or include your request in the manual selection.' };
  if (error) return { title: 'Matching temporarily unavailable', detail: 'The solver could not complete this search. Your request remains committed; retry when the service is available.' };
  if (solving) return { title: 'Looking for a match', detail: 'Checking combinations against signed conditions and current chain state.' };
  if (proposal?.legs.some(leg => leg.intentHash === request.hash) && evidence?.simulationResult?.success) {
    return { title: 'Match found - awaiting settlement', detail: 'Your request is included in a candidate that passed simulation. A proposer still needs to submit it with Propose and settle. Your tickets have not swapped yet.' };
  }
  return { title: 'Waiting for a match', detail: selected.length < 2
    ? 'There are not enough selected live requests yet. You may need to wait for another participant.'
    : 'No executable match for your request was found in the current search. You may need to wait for new requests or try another combination. This does not mean no match exists.' };
}
