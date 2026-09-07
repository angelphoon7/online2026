import ConnectWalletButton from "../connectWallet/ConnectWalletButton";
import WorldVerifyButton from "../world_verif_button/WorldVerifyButton";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-black">
      <header className="flex items-center justify-between p-6">
        <h1 className="text-2xl font-bold text-white">Online 2026</h1>
        <div className="flex items-center gap-4">
          <ConnectWalletButton />
          <WorldVerifyButton />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center">
      </main>
    </div>
  );
}
