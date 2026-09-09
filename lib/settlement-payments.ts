interface PaymentLeg {
  owner: string;
  netPayment: bigint;
}

export function settlementPayments(legs: readonly PaymentLeg[]) {
  const byOwner = new Map<string, { owner: string; amount: bigint }>();
  for (const leg of legs) {
    const key = leg.owner.toLowerCase();
    const row = byOwner.get(key) ?? { owner: leg.owner, amount: 0n };
    // Contract netPayment is positive for a debit; show the wallet's change.
    row.amount -= leg.netPayment;
    byOwner.set(key, row);
  }
  const rows = [...byOwner.values()];
  const paid = rows.reduce((sum, row) => sum + (row.amount < 0n ? -row.amount : 0n), 0n);
  const received = rows.reduce((sum, row) => sum + (row.amount > 0n ? row.amount : 0n), 0n);
  const total = received - paid;
  return { rows, paid, received, total, balanced: rows.length > 0 && total === 0n };
}
