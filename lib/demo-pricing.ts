import type { IntentParams } from './contracts';
import type { ChainTicket } from './market-types';

// User-requested demo reference prices, not on-chain valuations or a clearing rule.
// Use sections, which the signed mask enforces, never an unenforceable row target.
export const DEMO_SECTION_PRICES: Readonly<Record<number, bigint>> = { 0: 1000000n, 1: 1500000n };
export function demoPriceQuote(intent: Pick<IntentParams, 'offered' | 'eventId' | 'sectionMask' | 'exactCount'>, tickets: ChainTicket[]) {
  if (!intent.offered.length || !intent.sectionMask) return null;
  const offered = intent.offered.map(id => tickets.find(t => t.tokenId === String(id) && t.eventId === intent.eventId));
  if (offered.some(t => !t || DEMO_SECTION_PRICES[t.sectionId] === undefined)) return null;
  const accepted = Array.from({ length: 256 }, (_, id) => id).filter(id => !!(intent.sectionMask & (1n << BigInt(id))));
  if (accepted.some(id => DEMO_SECTION_PRICES[id] === undefined)) return null;
  const prices = accepted.map(id => DEMO_SECTION_PRICES[id]);
  const offeredTotal = offered.reduce((sum, t) => sum + DEMO_SECTION_PRICES[t!.sectionId], 0n);
  const min = prices.reduce((a, b) => a < b ? a : b) * BigInt(intent.exactCount);
  const max = prices.reduce((a, b) => a > b ? a : b) * BigInt(intent.exactCount);
  return { offeredTotal, wantedMin: min, wantedMax: max, suggestedLimit: max - offeredTotal };
}
