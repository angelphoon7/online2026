function randomNonce() {
  const words = crypto.getRandomValues(new Uint32Array(8));
  return words.reduce((nonce, word) => (nonce << 32n) | BigInt(word), 0n);
}

export async function findUnusedIntentNonce(minimum: bigint, isUsed: (nonce: bigint) => Promise<boolean>, next = randomNonce) {
  if (minimum >= 0n && minimum < (1n << 256n) && !await isUsed(minimum)) return minimum;
  // The indexer may omit revoked/settled intents. Avoid scanning their consumed nonces.
  // Nonces need only be unused, not consecutive; commit still reserves the chosen value.
  const candidate = next();
  if (candidate !== minimum && !await isUsed(candidate)) return candidate;
  throw new Error('Could not prepare an unused intent nonce. Retry creating the intent.');
}
