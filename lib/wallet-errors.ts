export function walletConnectionMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'WALLET_TIMEOUT') {
    return 'MetaMask did not respond in time. Open the extension and unlock it. Complete or cancel any pending connection request, then retry the original action. If there is no request, reload this page.';
  }
  const code = error && typeof error === 'object' && 'code' in error ? Number(error.code) : null;
  if (code === 4001) return 'Wallet request cancelled. Retry the action when you are ready.';
  if (code === -32002) return 'A wallet request is already pending. Open MetaMask and complete or cancel it, then try again.';
  if (code === 4100) return 'Wallet access is not authorized. Open MetaMask, allow this site to connect, then try again.';
  if (code === 4900 || code === 4901) return 'Your wallet is disconnected from the network. Open MetaMask, check its connection, then try again.';
  return 'Could not reach your wallet. Open and unlock MetaMask, check that the extension is enabled for this site, then reload and try again.';
}

// Providers may reject with plain objects; viem can wrap them in `cause`.
// Only an explicit rejection code means the user cancelled the request.
export function walletActionMessage(error: unknown): string {
  const seen = new Set<unknown>();
  const pending: unknown[] = [error];
  let detail = '';
  while (pending.length) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const value = current as { code?: unknown; message?: unknown; shortMessage?: unknown; cause?: unknown; data?: unknown; originalError?: unknown; error?: unknown };
    if (value.code === 'WALLET_TIMEOUT' || [4001, -32002, 4100, 4900, 4901].includes(Number(value.code))) {
      return walletConnectionMessage(value);
    }
    const message = value.shortMessage ?? value.message;
    if (typeof message === 'string' && message.trim()) detail = message;
    pending.push(value.cause, value.data, value.originalError, value.error);
  }
  if (detail) return detail;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Wallet action failed without an error message. Open MetaMask to check for a pending request and confirm its network connection, then retry.';
}
