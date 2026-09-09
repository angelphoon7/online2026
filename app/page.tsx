import Link from 'next/link';
import ArcGasNotice from '@/component/reshuffle/ArcGasNotice';

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-black">
      <header className="flex items-center justify-between border-b border-white/10 p-6">
        <h1 className="text-2xl font-bold text-white">RESHUFFLE</h1>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-8 p-6">
        <div className="max-w-lg text-center">
          <h2 className="mb-4 text-4xl font-bold text-white">
            A market for outcomes, not listings.
          </h2>
          <p className="mb-8 text-lg text-white/60">
            Never sell your old tickets and hope. Trade only when your whole replacement
            is guaranteed.
          </p>
          <Link
            href="/reshuffle"
            className="inline-flex rounded-lg bg-blue-600 px-8 py-3 text-lg font-medium text-white transition-colors hover:bg-blue-500"
          >
            Launch App
          </Link>
        </div>

        <div className="w-full max-w-3xl">
          <ArcGasNotice />
        </div>

        <div className="mt-8 grid max-w-3xl grid-cols-3 gap-6">
          <FeatureCard
            title="Sign Once, Leave"
            description="EIP-712 typed data signature. The market works while you're offline."
          />
          <FeatureCard
            title="All or Nothing"
            description="Atomic settlement. Every condition checked on-chain before anything moves."
          />
          <FeatureCard
            title="Your Conditions"
            description="Sessions, sections, adjacent seats, exact count, budget — enforced by the contract."
          />
        </div>
      </main>
    </div>
  );
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-5">
      <h3 className="mb-2 font-medium text-white">{title}</h3>
      <p className="text-sm text-white/50">{description}</p>
    </div>
  );
}
