// A timeout stops waiting in the app; it cannot dismiss an extension's popup.
export function walletRequest(provider: EthereumProvider, method: string, timeoutMs = 10_000, params?: unknown[] | Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject({ code: 'WALLET_TIMEOUT', method }), timeoutMs);
    Promise.resolve().then(() => provider.request({ method, params })).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}
