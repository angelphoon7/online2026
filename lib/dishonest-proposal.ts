import type { SettlementProposal } from './solve-api';
import type { ChainTicket } from './market-types';
export type Attack = 'siphon' | 'adjacency' | 'count';
export function dishonestProposal(proposal: SettlementProposal, attack: Attack, tickets: ChainTicket[]): SettlementProposal {
  const bad = { ...proposal, legs: proposal.legs.map(l => ({ ...l, receives: [...l.receives] })) };
  if (attack === 'siphon') {
    // An extra credit still passes the participant's upper payment bound, then fails V7.
    bad.legs[0].netPayment -= 20000000n;
  } else if (attack === 'count') {
    const from = bad.legs.findIndex(l => l.receives.length > 0);
    if (from < 0 || bad.legs.length < 2) throw new Error('This proposal has no ticket allocation to mutate.');
    bad.legs[(from + 1) % bad.legs.length].receives.push(bad.legs[from].receives.pop()!);
  } else {
    const meta = (id: bigint) => tickets.find(t => t.tokenId === String(id));
    const buyers = proposal.intents.flatMap((i, index) => i.mustBeAdjacent && i.exactCount >= 2 ? [index] : []);
    for (const a of buyers) for (const b of buyers) if (a < b) {
      const left = meta(bad.legs[a].receives[0]);
      const right = meta(bad.legs[b].receives[0]);
      if (left && right && left.eventId === right.eventId && left.sessionId === right.sessionId && left.sectionId === right.sectionId && left.row === right.row) {
        const last = bad.legs[a].receives.length - 1;
        [bad.legs[a].receives[last], bad.legs[b].receives[0]] = [bad.legs[b].receives[0], bad.legs[a].receives[last]];
        return bad;
      }
    }
    throw new Error('Include two adjacency intents receiving seats in the same session, section and row to isolate SeatsNotAdjacent.');
  }
  return bad;
}
