import type { Address } from 'viem';
import type { IntentParams } from './contracts';
import type { MarketSnapshot } from './market-types';
import { sessionDeadline } from './event-schedule';

export function initialIntent(snapshot: MarketSnapshot, account: Address | null): IntentParams {
  const tickets = snapshot.tickets.filter(t => t.eventId === 1);
  const firstSession = [...new Set(tickets.map(t => t.sessionId))].sort((a, b) => a - b)[0] ?? 0;
  const firstSection = [...new Set(tickets.map(t => t.sectionId))].sort((a, b) => a - b)[0] ?? 0;
  const sessionMask = 1n << BigInt(firstSession);
  return {
    owner: account ?? '0x0000000000000000000000000000000000000000', offered: [], eventId: 1,
    sessionMask,
    sectionMask: 1n << BigInt(firstSection),
    exactCount: 2, mustShareSession: true, mustShareSection: true, mustBeAdjacent: true,
    maxNetPay: 1000000n, deadline: sessionDeadline(sessionMask) ?? 0n, nonce: nextRecordedNonce(snapshot, account),
  };
}
export function nextRecordedNonce(snapshot: MarketSnapshot, account: Address | null) {
  return snapshot.intents.filter(i => i.owner.toLowerCase() === account?.toLowerCase())
    .reduce((n, i) => BigInt(i.nonce) >= n ? BigInt(i.nonce) + 1n : n, 0n);
}
