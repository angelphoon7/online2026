"use client";

import { useEffect, useState } from 'react';
import { formatUnits, type Address } from 'viem';
import { getPublicClient } from '@/lib/contracts';
import { CHAIN } from '@/lib/config';
import ArcGasNotice from './ArcGasNotice';

export default function ArcWalletBalance({ account, walletChainId }: { account: Address; walletChainId: number | null }) {
  const [snapshot, setSnapshot] = useState<{ account: Address; balance?: bigint; error?: boolean } | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (CHAIN.id !== 5042002) return;
    let cancelled = false;
    let pending = false;
    const readBalance = async () => {
      if (pending) return;
      pending = true;
      try {
        const client = getPublicClient();
        if (await client.getChainId() !== 5042002) throw new Error('Wrong balance source');
        const balance = await client.getBalance({ address: account });
        if (!cancelled) setSnapshot({ account, balance });
      } catch {
        if (!cancelled) setSnapshot({ account, error: true });
      } finally {
        pending = false;
      }
    };
    void readBalance();
    const timer = setInterval(() => void readBalance(), 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [account, refresh]);

  const current = snapshot?.account === account ? snapshot : null;
  // Native balance uses 18 decimals; the settlement ERC-20 interface uses 6.
  const balance = current?.balance === undefined ? null : formatUnits(current.balance, 18);
  return (
    <ArcGasNotice>
      <div className="min-w-0 shrink-0 rounded-lg border border-emerald-400/15 bg-black/20 p-4 sm:max-w-xs">
        <p className="text-xs text-white/50">Wallet balance on Arc</p>
        <p className="mt-1 break-all font-mono text-lg text-white" aria-live="polite">
          {current?.error ? 'Balance unavailable' : balance === null ? 'Loading balance…' : `${balance} USDC`}
        </p>
        <p className="mt-1 text-xs text-white/50">Shared by ticket payments and gas.</p>
        {walletChainId !== null && walletChainId !== 5042002 && (
          <p className="mt-2 text-xs text-amber-300">Switch your wallet to Arc Testnet to transact.</p>
        )}
        <button type="button" onClick={() => setRefresh(n => n + 1)} className="mt-2 text-xs text-emerald-300 underline underline-offset-4 hover:text-emerald-200">
          Refresh balance
        </button>
      </div>
    </ArcGasNotice>
  );
}
