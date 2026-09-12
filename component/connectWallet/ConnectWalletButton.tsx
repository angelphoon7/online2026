"use client";

import { useWallet } from "@/lib/hooks/useWallet";

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function ConnectWalletButton() {
  const { account, connect, isConnecting, error } = useWallet();

  if (account) {
    return (
      <div className="relative flex items-center">
        <button
          type="button"
          onClick={connect}
          disabled={isConnecting}
          className="flex h-9 items-center justify-center gap-2.5 rounded-full border border-white/20 bg-white/[0.06] px-4 text-xs font-mono text-white transition-all hover:border-white/40 hover:bg-white/[0.12] active:scale-95 disabled:opacity-50"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span>{truncateAddress(account)}</span>
        </button>
        {error && (
          <p role="alert" className="absolute right-0 top-full mt-2 whitespace-nowrap rounded bg-red-950/90 px-2.5 py-1 text-xs text-red-300 border border-red-800/50 shadow-lg z-50">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        onClick={connect}
        disabled={isConnecting}
        className="flex h-9 items-center justify-center gap-2 rounded-full bg-white px-4 text-xs font-semibold tracking-tight text-[#180a10] transition-all hover:bg-zinc-200 hover:shadow-[0_0_16px_rgba(255,255,255,0.25)] active:scale-95 disabled:opacity-60"
      >
        {isConnecting ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#180a10] border-t-transparent" />
            <span>Connecting...</span>
          </>
        ) : (
          "Connect Wallet"
        )}
      </button>
      {error && (
        <p role="alert" className="absolute right-0 top-full mt-2 whitespace-nowrap rounded bg-red-950/90 px-2.5 py-1 text-xs text-red-300 border border-red-800/50 shadow-lg z-50">
          {error}
        </p>
      )}
      {isConnecting && (
        <p role="status" className="absolute right-0 top-full mt-2 whitespace-nowrap rounded bg-zinc-900/90 px-3 py-1.5 text-xs text-zinc-300 border border-white/10 shadow-lg z-50">
          Approve in your browser wallet
        </p>
      )}
    </div>
  );
}
