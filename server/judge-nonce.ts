import type { Address } from 'viem';

/** Live pool data is a starting hint; only the registry can declare a nonce unused. */
export async function nextJudgeNonce(
  current: { owner: Address; nonce: bigint },
  pool: Iterable<{ owner: Address; nonce: bigint }>,
  used: (nonce: bigint) => Promise<boolean>,
): Promise<bigint> {
  let highest = current.nonce;
  for (const intent of pool) {
    if (intent.owner.toLowerCase() === current.owner.toLowerCase() && intent.nonce > highest) highest = intent.nonce;
  }
  // Avoid walking every old commitment from the edited intent onward on the public RPC.
  // Revoked/settled or not-yet-indexed nonces remain reserved and are checked here too.
  for (let offset = 1n; offset <= 64n; offset++) {
    const nonce = highest + offset;
    if (!await used(nonce)) return nonce;
  }
  throw new Error('No unused intent nonce found within 64 registry checks.');
}
