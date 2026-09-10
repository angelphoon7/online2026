export function walletConnectionMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'WALLET_TIMEOUT') {
    return 'MetaMask did not respond in time. Open the extension and unlock it. Complete or cancel any pending connection request, then click Connect Wallet again. If there is no request, reload this page.';
  }
  const code = error && typeof error === 'object' && 'code' in error ? Number(error.code) : null;
  if (code === 4001) return 'Connection cancelled. Click Connect Wallet when you are ready.';
  if (code === -32002) return 'A wallet request is already pending. Open MetaMask and complete or cancel it, then try again.';
  if (code === 4100) return 'Wallet access is not authorized. Open MetaMask, allow this site to connect, then try again.';
  if (code === 4900 || code === 4901) return 'Your wallet is disconnected from the network. Open MetaMask, check its connection, then try again.';
  return 'Could not reach your wallet. Open and unlock MetaMask, check that the extension is enabled for this site, then reload and try again.';
}
