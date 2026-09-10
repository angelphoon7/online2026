"use client";

import { useWallet } from "@/lib/hooks/useWallet";

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function ConnectWalletButton() {
  const { account, connect, isConnecting, error } = useWallet();

  if (account) {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={connect}
          disabled={isConnecting}
          className="flex h-9 items-center justify-center gap-2 rounded-full border border-solid border-black/[.08] px-4 text-sm font-medium transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
        >
          <span className="h-2 w-2 rounded-full bg-green-500" />
          {truncateAddress(account)}
        </button>
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 sm:items-start">
      <button
        type="button"
        onClick={connect}
        disabled={isConnecting}
        className="flex h-9 items-center justify-center gap-2 rounded-full bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-60 dark:hover:bg-[#ccc]"
      >
        {isConnecting ? "Connecting..." : "Connect Wallet"}
      </button>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {isConnecting && <p role="status" className="text-sm">Open MetaMask from your browser toolbar and approve the connection.</p>}
    </div>
  );
}
