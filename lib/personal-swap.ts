import type { Address, Hex } from 'viem';
import type { ChainReceipt } from './market-types';
import type { SettlementProposal } from './solve-api';

type Outcome = { owner: string; offered: readonly (string | bigint)[]; receives: readonly (string | bigint)[] };

// Compare a wallet's complete bundle across all of its intents. Moving tickets between
// two requests owned by the same wallet does not change that wallet's tickets.
export function walletChangesTickets(outcomes: Outcome[], account: string): boolean {
  const rows = outcomes.filter(row => row.owner.toLowerCase() === account.toLowerCase());
  const before = new Set(rows.flatMap(row => row.offered.map(String)));
  const after = new Set(rows.flatMap(row => row.receives.map(String)));
  return before.size !== after.size || [...before].some(id => !after.has(id));
}

export function proposalForWallet(proposal: SettlementProposal, account: Address, requiredHash?: Hex): boolean {
  if (requiredHash && !proposal.legs.some((leg, i) => leg.intentHash.toLowerCase() === requiredHash.toLowerCase()
    && proposal.intents[i]?.owner.toLowerCase() === account.toLowerCase())) return false;
  return walletChangesTickets(proposal.intents.map((intent, i) => ({
    owner: intent.owner, offered: intent.offered, receives: proposal.legs[i]?.receives ?? [],
  })), account);
}

export function receiptOutcomes(receipt: ChainReceipt): ChainReceipt['participants'] {
  const groups = new Map<string, ChainReceipt['participants'][number]>();
  for (const row of receipt.participants) {
    const key = row.owner.toLowerCase();
    const previous = groups.get(key);
    groups.set(key, previous ? { owner: previous.owner,
      offered: [...new Set([...previous.offered, ...row.offered])],
      receives: [...new Set([...previous.receives, ...row.receives])],
      netPayment: (BigInt(previous.netPayment) + BigInt(row.netPayment)).toString(),
    } : { ...row });
  }
  return [...groups.values()];
}

export function receiptTitle(receipt: ChainReceipt, account: Address | null): string {
  if (!receipt.participants.some(row => walletChangesTickets(receipt.participants, row.owner))) return 'Tickets returned.';
  return account && walletChangesTickets(receipt.participants, account) ? 'Your swap confirmed.' : 'Settlement confirmed.';
}
