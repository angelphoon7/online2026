export function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function formatUSDC(amount: bigint): string {
  const abs = amount < 0n ? -amount : amount;
  const whole = abs / 1_000_000n;
  const frac = abs % 1_000_000n;
  const sign = amount < 0n ? '-' : '';
  if (frac === 0n) return `${sign}${whole}`;
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
  return `${sign}${whole}.${fracStr}`;
}

export function formatUSDCPayment(amount: bigint): string {
  // Round only the display; on-chain amounts retain all six USDC decimals.
  const abs = amount < 0n ? -amount : amount;
  const rounded = (abs + 50n) / 100n;
  const sign = amount < 0n && rounded !== 0n ? '-' : '';
  return `${sign}${rounded / 10_000n}.${(rounded % 10_000n).toString().padStart(4, '0')}`;
}

export function parseUSDC(value: string): bigint {
  const parts = value.split('.');
  const whole = BigInt(parts[0] || '0') * 1_000_000n;
  if (parts.length === 1) return whole;
  const fracStr = (parts[1] || '0').padEnd(6, '0').slice(0, 6);
  return whole + BigInt(fracStr);
}
