"use client";

import { useEffect, useState, useCallback } from 'react';
import type { Address } from 'viem';

export function useWallet() {
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) return;

    eth
      .request({ method: 'eth_accounts' })
      .then((accs) => {
        const accounts = accs as string[];
        if (accounts[0]) setAccount(accounts[0] as Address);
      })
      .catch(() => {});

    eth
      .request({ method: 'eth_chainId' })
      .then((id) => setChainId(Number(id as string)))
      .catch(() => {});

    const handleAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      setAccount(accounts[0] ? (accounts[0] as Address) : null);
    };
    const handleChain = (...args: unknown[]) => {
      setChainId(Number(args[0] as string));
    };

    eth.on('accountsChanged', handleAccounts);
    eth.on('chainChanged', handleChain);
    return () => {
      eth.removeListener('accountsChanged', handleAccounts);
      eth.removeListener('chainChanged', handleChain);
    };
  }, []);

  const connect = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) {
      window.open('https://metamask.io/download', '_blank', 'noopener,noreferrer');
      return;
    }
    const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
    if (accounts[0]) setAccount(accounts[0] as Address);
  }, []);

  return { account, chainId, connect };
}
