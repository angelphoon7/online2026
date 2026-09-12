import type { IntentParams } from './contracts';
import { formatUSDC } from './format';

export const HERO_TITLE_LINES = ['Swap tickets', 'without selling first.'] as const;
export const HERO_SUBTITLE = 'Every condition you sign is checked on-chain.';
export const EMPTY_RESULT = 'No solution found within the search bound';
export const RANKING_RULE = 'Least gross USDC moved among candidates found within the search budget';
export const POOL_LABEL = 'live intents';
export const ESCROW_NOTE = 'Withdrawal is unconditional until settlement.';
export const POOL_NOTE = 'These are signed swap requests: what each participant offers and what they will accept. You do not need to select other people to submit yours. Checkboxes let you test a manual group of 2–4 requests with Run solver; they do not accept a trade.';
export const ENFORCEABLE = 'These are the only conditions the contract can enforce. A specific row or ticket cannot be required.';
export const ALLOWANCE_NOTE = 'A USDC spending allowance may be requested in this flow. An allowance does not reserve funds.';
export const WITHDRAWAL_DETAIL = 'Withdrawals do not revoke intents; the contract checks custody again at execution.';
export const EXACT_COUNT_NOTE = 'exactly — not a minimum';
export const CONNECT_POSITIONS_NOTE = 'Connect your wallet to see tickets you own or have deposited for this event. Connecting does not create or deposit tickets.';
export const OWN_POSITIONS_NOTE = 'Tickets held by your wallet or deposited by you.';
export const EMPTY_POSITIONS_NOTE = 'This wallet currently holds no tickets for this event. Click Get free tickets, or switch to a wallet that already holds tickets. Approval does not create tickets.';
export const FREE_TICKETS_LABEL = 'Get free tickets';
export const DEMO_PRICE_NOTE = 'Demo reference prices by section, not on-chain ticket valuations. The comparison suggests your signed payment limit; the actual settlement may differ within that limit. No swap payment is taken at deposit; gas still costs USDC.';
export const EVENT_CUTOFF_NOTE = 'Valid only until 8 hours before the selected event starts. This cutoff is included in your signed intent.';
export const DEMO_SCHEDULE_NOTE = 'Demo schedule; these times are not taken from the concert posters.';
export const CLOSED_SESSION_NOTE = 'The cutoff for this night has passed. Choose another night.';
export const MISSING_SCHEDULE_NOTE = 'No start time is configured for this night. Signing is unavailable.';
export const WALLET_IMPORT_NOTE = 'NFTs are already issued on-chain. Confirm the add-NFT requests in MetaMask. If your wallet cannot import them, use Import NFT with the contract and token IDs below. These tickets currently have no image metadata, so a placeholder may appear.';
export const DEMO_TICKET_NOTE = 'Receive two free Arc Testnet tickets, once per wallet. Sign a claim message; the demo issuer pays the minting gas. Deposits and swaps still use your USDC for gas.';
export const PICK_OFFERED_NOTE = 'Tick the tickets you want to offer.';
export const NO_NET_PAYMENT = 'No net payment';
export const ADJACENCY_ACCEPTED = 'accepted';
export const ADJACENCY_ERROR = 'SeatsNotAdjacent';
export const STEPS = ['What would you like instead?', 'Which tickets do you have?'] as const;
export const SOLVER_NOTE = 'Submitted by an independent solver — no participant sent this transaction';
export const ADJACENCY_NOTE = 'Seat numbers are consecutive integers within one session, section and row because we issue the tickets. This does not generalise to arbitrary venues.';
export const EXPLORER = 'https://testnet.arcscan.app';

export const maskClasses = (mask: bigint) => Array.from({ length: 256 }, (_, n) => n).filter(n => (mask & (1n << BigInt(n))) !== 0n);
export const maskSummary = (mask: bigint) => maskClasses(mask).join(', ') || 'none';
export function paymentLabel(amount: bigint) {
  if (amount === 0n) return NO_NET_PAYMENT;
  return `${amount > 0n ? 'I pay up to' : 'I must receive at least'} ${formatUSDC(amount < 0n ? -amount : amount)} USDC`;
}
export function condition(i: Pick<IntentParams, 'exactCount' | 'sessionMask' | 'sectionMask' | 'mustShareSession' | 'mustShareSection' | 'mustBeAdjacent' | 'maxNetPay'>) {
  return `Receive exactly ${i.exactCount} tickets; sessions ${maskSummary(i.sessionMask)}; sections ${maskSummary(i.sectionMask)}; ${i.mustShareSession ? 'one session' : 'mixed sessions permitted'}; ${i.mustShareSection ? 'one section' : 'mixed sections permitted'}; ${i.mustBeAdjacent ? 'consecutive seats within the same session, section and row required' : 'adjacency not required'}; ${i.maxNetPay >= 0n ? 'pay at most' : 'receive at least'} ${formatUSDC(i.maxNetPay >= 0n ? i.maxNetPay : -i.maxNetPay)} USDC net.`;
}
export function intentReview(i: IntentParams, ownerPending = false) {
  return {
    sentence: `Take ${i.offered.length ? `my tickets ${i.offered.map(id => `#${id}`).join(', ')}` : 'no tickets from me'} only if the whole settlement succeeds. ${condition(i)}`,
    metadata: `Event ${i.eventId} · valid until ${new Date(Number(i.deadline) * 1000).toISOString()} · owner ${ownerPending ? 'wallet selected at signing' : i.owner} · nonce ${ownerPending ? 'read after connection' : i.nonce}`,
  };
}
export function intentSentence(i: IntentParams) {
  const review = intentReview(i);
  return `${review.sentence} ${review.metadata}`;
}
export const indexingMessage = (block: bigint) => `Indexing block #${block}…`;
export const INDEXING_PENDING = 'Transaction confirmed. Waiting for the updated pool before matching or answering.';
export const INDEXING_RETRY = 'Retry indexing';
