import ConnectWalletButton from "../connectWallet/ConnectWalletButton";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-black">
      <header className="flex items-center justify-between p-6">
        <h1 className="text-2xl font-bold text-white">Online 2026</h1>
        <ConnectWalletButton />
      </header>
      <main className="flex flex-1 items-center justify-center">
      </main>
    </div>
  );
}
