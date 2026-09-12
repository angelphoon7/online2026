import type { Address } from 'viem';
import type { MarketSnapshot } from './market-types';

export interface SectionSupply {
  issued: number;
  deposited: number;
  offered: number;
}

// Public inventory at the snapshot block, not a promise of a matching outcome.
export function sectionSupply(snapshot: MarketSnapshot, eventId: number, sessionId: number | null, escrow: Address) {
  const tickets = new Map(snapshot.tickets.map(ticket => [ticket.tokenId, ticket]));
  const inEscrow = (ticket: MarketSnapshot['tickets'][number]) => ticket.status === 0
    && ticket.owner.toLowerCase() === escrow.toLowerCase()
    && ticket.depositor !== '0x0000000000000000000000000000000000000000';
  const offered = new Set<string>();
  for (const intent of snapshot.intents) {
    if (intent.eventId !== eventId || intent.state !== 1 || intent.expired || BigInt(intent.deadline) < BigInt(snapshot.timestamp)) continue;
    // A request with any missing, withdrawn or redeemed offering cannot execute.
    if (!intent.offered.every(id => {
      const ticket = tickets.get(id);
      return ticket && ticket.eventId === eventId && inEscrow(ticket)
        && ticket.depositor.toLowerCase() === intent.owner.toLowerCase();
    })) continue;
    for (const id of intent.offered) offered.add(id);
  }
  const sections = new Map<number, SectionSupply>();
  for (const ticket of tickets.values()) {
    if (ticket.eventId !== eventId || ticket.sessionId !== sessionId) continue;
    const counts = sections.get(ticket.sectionId) ?? { issued: 0, deposited: 0, offered: 0 };
    counts.issued++;
    if (inEscrow(ticket)) counts.deposited++;
    if (offered.has(ticket.tokenId)) counts.offered++;
    sections.set(ticket.sectionId, counts);
  }
  return sections;
}
