import type { Address, Hex } from 'viem';
import type { IntentParams } from './contracts';
export type WireIntent = Omit<IntentParams, 'offered' | 'sessionMask' | 'sectionMask' | 'maxNetPay' | 'deadline' | 'nonce'> & {
  offered: string[]; sessionMask: string; sectionMask: string; maxNetPay: string; deadline: string; nonce: string;
  hash: Hex; commitTx: Hex; state: number; expired: boolean;
};
export interface ChainTicket {
  tokenId: string; eventId: number; sessionId: number; sectionId: number; row: number; seat: number; status: number;
  owner: Address; depositor: Address;
}
export interface MarketSnapshot {
  blockNumber: string; timestamp: string; tickets: ChainTicket[]; intents: WireIntent[];
  settlements: { hash: Hex; block: string; participants: string }[]; defaultHashes: Hex[];
  // Which mechanism discovered this market. Displayed rather than assumed: the same UI runs
  // against a local Anvil chain over RPC, and a label claiming The Graph there would be false.
  source: 'graph' | 'rpc';
  // Intents the subgraph returned that did not re-hash to the id they were published under
  // (trust rule 1). Dropped from the pool, and named here so the drop is visible.
  hashMismatched: Hex[];
}
export interface ChainReceipt {
  hash: Hex; blockNumber: string; status: 'success' | 'reverted'; proposer: Address; independent: boolean;
  ticketTransfers: number; usdcTransfers: number; netSum: string;
  participants: { owner: Address; offered: string[]; receives: string[]; netPayment: string }[];
  rejection: { name: string; args: string[] } | null;
}
export const restoreIntent = (i: WireIntent): IntentParams => ({ ...i, offered: i.offered.map(BigInt), sessionMask: BigInt(i.sessionMask), sectionMask: BigInt(i.sectionMask), maxNetPay: BigInt(i.maxNetPay), deadline: BigInt(i.deadline), nonce: BigInt(i.nonce) });
