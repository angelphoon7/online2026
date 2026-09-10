"use client";

import { useEffect, useState, useCallback, useRef } from 'react';
import { isAddress, type Address } from 'viem';
import { walletConnectionMessage } from '../wallet-errors';
import { walletRequest } from '../wallet-request';

function firstAccount(value: unknown): Address | null {
  return Array.isArray(value) && typeof value[0] === 'string' && isAddress(value[0]) ? value[0] : null;
}

function parseChain(value: unknown): number {
  const id = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid wallet chain ID');
  return id;
}

export function useWallet() {
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connecting = useRef(false);
  const revision = useRef(0);

  useEffect(() => {
    let active = true;
    let eth: EthereumProvider | undefined;
    const initialRevision = revision.current;
    const handleAccounts = (...args: unknown[]) => {
      if (!active) return;
      revision.current++;
      setAccount(firstAccount(args[0]));
      setError(null);
    };
    const handleChain = (...args: unknown[]) => {
      if (!active) return;
      revision.current++;
      try { setChainId(parseChain(args[0])); }
      catch { setChainId(null); }
    };
    const handleDisconnect = (reason: unknown) => {
      if (!active) return;
      revision.current++;
      setAccount(null); setChainId(null);
      setError(walletConnectionMessage(reason));
    };
    // Start inside a promise so a broken extension's synchronous throws are
    // handled as well as rejected provider promises. No connection prompt here.
    void Promise.resolve().then(async () => {
      if (!active) return;
      eth = window.ethereum;
      if (!eth) return;
      eth.on('accountsChanged', handleAccounts);
      eth.on('chainChanged', handleChain);
      eth.on('disconnect', handleDisconnect);
      const provider = eth;
      const [accounts, id] = await Promise.all([
        walletRequest(provider, 'eth_accounts'),
        walletRequest(provider, 'eth_chainId'),
      ]);
      if (!active || revision.current !== initialRevision) return;
      const nextChain = parseChain(id);
      setAccount(firstAccount(accounts)); setChainId(nextChain);
    }).catch(reason => {
      if (active && revision.current === initialRevision) setError(walletConnectionMessage(reason));
    });
    return () => {
      active = false;
      for (const [event, handler] of [['accountsChanged', handleAccounts], ['chainChanged', handleChain], ['disconnect', handleDisconnect]] as const) {
        try { eth?.removeListener(event, handler); } catch { /* The extension may already have disconnected. */ }
      }
    };
  }, []);

  const connect = useCallback(async () => {
    if (connecting.current) return;
    connecting.current = true;
    revision.current++;
    setIsConnecting(true); setError(null);
    try {
      const eth = window.ethereum;
      if (!eth) {
        setError('No wallet detected. Install or enable MetaMask for this browser, then reload the page.');
        return;
      }
      const accounts = await walletRequest(eth, 'eth_requestAccounts', 30_000);
      const nextAccount = firstAccount(accounts);
      if (!nextAccount) {
        setAccount(null); setChainId(null);
        setError('No account was shared. Open MetaMask and select an account to connect.');
        return;
      }
      const nextChain = parseChain(await walletRequest(eth, 'eth_chainId'));
      setAccount(nextAccount); setChainId(nextChain); setError(null);
    } catch (reason) {
      setError(walletConnectionMessage(reason));
    } finally {
      connecting.current = false;
      setIsConnecting(false);
    }
  }, []);

  return { account, chainId, connect, isConnecting, error };
}
