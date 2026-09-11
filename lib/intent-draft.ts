import type { Address } from 'viem';
import type { IntentParams } from './contracts';
import type { MarketSnapshot } from './market-types';

export function initialIntent(snapshot: MarketSnapshot, account: Address | null): IntentParams {
  const tickets = snapshot.tickets.filter(t => t.eventId === 1);
  return {
    owner: account ?? '0x0000000000000000000000000000000000000000', offered: [], eventId: 1,
    sessionMask: tickets.reduce((mask, t) => mask | (1n << BigInt(t.sessionId)), 0n),
    sectionMask: tickets.reduce((mask, t) => mask | (1n << BigInt(t.sectionId)), 0n),
    exactCount: 2, mustShareSession: true, mustShareSection: true, mustBeAdjacent: true,
    maxNetPay: 0n, deadline: BigInt(snapshot.timestamp) + 86400n, nonce: nextRecordedNonce(snapshot, account),
  };
}
export function nextRecordedNonce(snapshot: MarketSnapshot, account: Address | null) {
  return snapshot.intents.filter(i => i.owner.toLowerCase() === account?.toLowerCase())
    .reduce((n, i) => BigInt(i.nonce) >= n ? BigInt(i.nonce) + 1n : n, 0n);
}
