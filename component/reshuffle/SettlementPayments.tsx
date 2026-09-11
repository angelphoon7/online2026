import { formatUSDC } from '@/lib/format';
import { CHAIN } from '@/lib/config';
import { settlementPayments } from '@/lib/settlement-payments';

function signedAmount(amount: bigint) {
  return `${amount < 0n ? '−' : amount > 0n ? '+' : ''}${formatUSDC(amount < 0n ? -amount : amount)}`;
}

export default function SettlementPayments({ legs, txHash, blockNumber, evidenceId }: {
  legs: { owner: string; netPayment: bigint }[];
  txHash: string;
  blockNumber: string;
  evidenceId: string;
}) {
  const { rows, paid, received, total, balanced } = settlementPayments(legs);

  return (
    <section aria-label="Confirmed USDC net distribution" className="overflow-hidden rounded-xl border border-emerald-400/25 bg-emerald-400/[.04]">
      <div className="border-b border-white/10 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-lg font-semibold text-white">USDC net distribution</h4>
          <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-300">Confirmed onchain</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-white/60">
          Every signed condition checked. All payments and ticket transfers completed in one transaction.
        </p>
      </div>

      <table className="w-full table-fixed text-sm">
        <caption className="sr-only">Net USDC paid or received by each wallet, excluding network gas fees</caption>
        <thead className="text-left text-xs text-white/50">
          <tr>
            <th scope="col" className="w-[54%] px-4 py-3 font-medium sm:px-5">Wallet</th>
            <th scope="col" className="px-2 py-3 font-medium">Direction</th>
            <th scope="col" className="px-4 py-3 text-right font-medium sm:px-5">Net USDC</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map(({ owner, amount }) => (
            <tr key={owner.toLowerCase()}>
              <th scope="row" className="break-all px-4 py-4 text-left font-mono text-xs font-normal text-white/80 sm:px-5">{owner}</th>
              <td className="px-2 py-4 text-xs text-white/60">{amount < 0n ? 'Paid' : amount > 0n ? 'Received' : 'No payment'}</td>
              <td className={`break-all px-4 py-4 text-right font-mono font-semibold tabular-nums sm:px-5 ${amount < 0n ? 'text-rose-300' : amount > 0n ? 'text-emerald-300' : 'text-white/60'}`}>
                {signedAmount(amount)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-white/15 bg-white/[.03]">
          <tr>
            <th scope="row" colSpan={2} className="px-4 py-4 text-left font-medium text-white sm:px-5">Net sum <span className="text-white/50">(Σ)</span></th>
            <td className={`break-all px-4 py-4 text-right font-mono text-xl font-semibold tabular-nums sm:px-5 ${balanced ? 'text-emerald-300' : 'text-rose-300'}`}>{signedAmount(total)}</td>
          </tr>
        </tfoot>
      </table>

      <div className="space-y-3 border-t border-white/10 p-4 sm:p-5">
        <p className={`font-mono text-lg font-semibold ${balanced ? 'text-emerald-300' : 'text-rose-300'}`}>
          Σ = {signedAmount(total)} USDC · {balanced ? 'Balanced' : 'Distribution mismatch'}
        </p>
        <p className="text-sm text-white/70">Total paid: {formatUSDC(paid)} USDC · Total received: {formatUSDC(received)} USDC</p>
        {!balanced && <p role="alert" className="text-sm text-rose-300">The displayed distribution could not be reconciled. Check the transaction evidence.</p>}
        <p className="text-xs leading-relaxed text-white/50">
          Net amounts combine all intents from the same wallet. Gas is separate and paid by the submitting wallet{CHAIN.id === 5042002 ? ' in USDC' : ''}; it is excluded from Σ.
        </p>
        <div className="space-y-2 border-t border-white/10 pt-3 text-xs text-white/50">
          <p>Confirmed in block <span className="font-mono text-white/75">{blockNumber}</span></p>
          {CHAIN.id === 5042002 ? (
            <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="block break-all font-mono text-emerald-300 underline decoration-emerald-300/30 underline-offset-4 hover:text-emerald-200" aria-label={`View settlement transaction ${txHash} on Arc Explorer`}>{txHash}</a>
          ) : <p className="break-all font-mono">{txHash}</p>}
          <a href={`/api/evidence/${evidenceId}`} target="_blank" rel="noopener noreferrer" className="inline-block text-white/70 underline underline-offset-4 hover:text-white">View verified settlement evidence</a>
        </div>
      </div>
    </section>
  );
}
