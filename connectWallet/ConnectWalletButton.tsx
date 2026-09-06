"use client";

import { useEffect, useState } from "react";

interface EthereumProvider {
  isMetaMask?: boolean;
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function ConnectWalletButton() {
  const [account, setAccount] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { ethereum } = window;
    if (!ethereum) return;

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      setAccount(accounts[0] ?? null);
    };

    ethereum
      .request({ method: "eth_accounts" })
      .then((accounts) => handleAccountsChanged(accounts))
      .catch(() => {});

    ethereum.on("accountsChanged", handleAccountsChanged);
    return () => ethereum.removeListener("accountsChanged", handleAccountsChanged);
  }, []);

  async function connect() {
    const { ethereum } = window;
    if (!ethereum) {
      window.open("https://metamask.io/download", "_blank", "noopener,noreferrer");
      return;
    }

    setError(null);
    setIsConnecting(true);
    try {
      const accounts = (await ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      setAccount(accounts[0] ?? null);
    } catch {
      setError("Connection request was rejected.");
    } finally {
      setIsConnecting(false);
    }
  }

  if (account) {
    return (
      <button
        type="button"
        onClick={connect}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-solid border-black/[.08] px-5 text-base font-medium transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a] md:w-[180px]"
      >
        <span className="h-2 w-2 rounded-full bg-green-500" />
        {truncateAddress(account)}
      </button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 sm:items-start">
      <button
        type="button"
        onClick={connect}
        disabled={isConnecting}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-base font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-60 dark:hover:bg-[#ccc] md:w-[180px]"
      >
        {isConnecting ? "Connecting..." : "Connect Wallet"}
      </button>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
