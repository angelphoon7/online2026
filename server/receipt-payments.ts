import 'server-only';
import type { Address } from 'viem';
import type { ChainReceipt } from '@/lib/market-types';

type Transfer = { from: Address; to: Address; value: bigint };

// Settlement pulls each net debit into the contract, then pays each net credit.
// Reconcile those receipt logs with the signed sum of that owner's submitted legs.
// Count a payment once, not once for each of its two routing hops.
export function confirmedReceiptPayments(legs: { owner: Address; netPayment: bigint }[], logs: Transfer[], settlement: Address): NonNullable<ChainReceipt['payments']> {
  const accounts = new Map<string, { owner: Address; net: bigint; paid: bigint; received: bigint }>();
  for (const leg of legs) {
    const key = leg.owner.toLowerCase();
    const account = accounts.get(key) ?? { owner: leg.owner, net: 0n, paid: 0n, received: 0n };
    account.net += leg.netPayment;
    accounts.set(key, account);
  }
  const contract = settlement.toLowerCase();
  for (const log of logs) {
    const debit = log.to.toLowerCase() === contract;
    const credit = log.from.toLowerCase() === contract;
    if (debit === credit || log.value < 0n) throw new Error('Invalid settlement USDC transfer route');
    const account = accounts.get((debit ? log.from : log.to).toLowerCase());
    if (!account) throw new Error('USDC transfer names a wallet outside this settlement');
    if (debit) account.paid += log.value;
    else account.received += log.value;
  }
  let paid = 0n, received = 0n;
  for (const account of accounts.values()) {
    if (account.paid !== (account.net > 0n ? account.net : 0n)
      || account.received !== (account.net < 0n ? -account.net : 0n)) throw new Error('USDC receipt transfers do not match settlement payments');
    paid += account.paid; received += account.received;
  }
  if (paid !== received) throw new Error('Settlement USDC transfers do not balance');
  return { totalTransferred: paid.toString(), wallets: [...accounts.values()].map(account => ({
    owner: account.owner, paid: account.paid.toString(), received: account.received.toString(),
  })) };
}
