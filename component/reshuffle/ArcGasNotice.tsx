import type { ReactNode } from 'react';
import { CHAIN } from '@/lib/config';

export default function ArcGasNotice({ children }: { children?: ReactNode }) {
  if (CHAIN.id !== 5042002) return null;
  return (
    <section aria-label="USDC gas on Arc" className="flex w-full flex-col gap-5 rounded-xl border border-emerald-400/25 bg-emerald-400/[.06] p-5 text-left sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-xl">
        <span className="text-xs font-semibold tracking-widest text-emerald-300">ARC TESTNET · USDC GAS</span>
        <h2 className="mt-2 text-lg font-semibold text-white">USDC pays for your tickets and gas.</h2>
        <p className="mt-1 text-sm leading-relaxed text-white/65">
          USDC is Arc&apos;s native gas token. Pay ticket differences and network fees
          from the same balance. No second token to buy or manage.
        </p>
      </div>
      {children}
    </section>
  );
}
