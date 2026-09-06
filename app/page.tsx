import ConnectWalletButton from "../connectWallet/ConnectWalletButton";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-black">
      <main className="flex flex-col items-center gap-8">
        <h1 className="text-4xl font-bold text-white">Online 2026</h1>
        <ConnectWalletButton />
      </main>
    </div>
  );
}
