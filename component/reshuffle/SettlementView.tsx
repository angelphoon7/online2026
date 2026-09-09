"use client";

import { formatUSDC, truncateAddress } from '@/lib/format';

interface LegDisplay {
  intentHash: string;
  owner: string;
  receives: bigint[];
  netPayment: bigint;
  maxNetPay: bigint;
}

interface SettlementViewProps {
  legs: LegDisplay[];
  gross: bigint;
  candidateCount: number;
  status: 'pending' | 'simulating' | 'simulated' | 'submitting' | 'settled' | 'failed';
  error?: string;
  txHash?: string;
  onSimulate?: () => void;
  onSubmit?: () => void;
}

export default function SettlementView({
  legs,
  gross,
  candidateCount,
  status,
  error,
  txHash,
  onSimulate,
  onSubmit,
}: SettlementViewProps) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-white">Proposed Settlement</h3>
        <span className="text-xs text-white/40">
          Least cash moved among {candidateCount} candidate{candidateCount !== 1 ? 's' : ''} found
          within the search budget
        </span>
      </div>

      <div className="text-sm text-white/60">
        Gross cash moved: <span className="text-white">{formatUSDC(gross)} USDC</span>
      </div>

      <div className="flex flex-col gap-2">
        {legs.map((leg) => (
          <div
            key={leg.intentHash}
            className="flex items-center justify-between rounded border border-white/5 bg-white/[.02] px-3 py-2 text-sm"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-white/60">{truncateAddress(leg.owner)}</span>
              <span className="text-xs text-white/40">
                Receives: {leg.receives.length === 0
                  ? 'nothing (seller)'
                  : leg.receives.map((id) => `#${id}`).join(', ')}
              </span>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <span
                className={
                  leg.netPayment > 0n
                    ? 'text-red-400'
                    : leg.netPayment < 0n
                      ? 'text-green-400'
                      : 'text-white/60'
                }
              >
                {leg.netPayment > 0n ? '-' : leg.netPayment < 0n ? '+' : ''}
                {formatUSDC(leg.netPayment < 0n ? -leg.netPayment : leg.netPayment)} USDC
              </span>
              <span className="text-[10px] text-white/30">
                limit: {leg.maxNetPay >= 0n ? `pay ≤${formatUSDC(leg.maxNetPay)}` : `receive ≥${formatUSDC(-leg.maxNetPay)}`}
              </span>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {txHash && (
        <div className="text-xs text-white/40">
          Transaction: <span className="font-mono text-white/60">{txHash}</span>
        </div>
      )}

      <div className="flex gap-2">
        {onSimulate && status === 'pending' && (
          <button
            type="button"
            onClick={onSimulate}
            className="rounded bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/20"
          >
            Simulate (eth_call)
          </button>
        )}
        {status === 'simulating' && (
          <span className="px-4 py-2 text-sm text-white/40">Simulating...</span>
        )}
        {onSubmit && status === 'simulated' && (
          <button
            type="button"
            onClick={onSubmit}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-500"
          >
            Submit Settlement
          </button>
        )}
        {status === 'submitting' && (
          <span className="px-4 py-2 text-sm text-white/40">Submitting...</span>
        )}
        {status === 'settled' && (
          <span className="px-4 py-2 text-sm text-green-400">Settled</span>
        )}
        {status === 'failed' && (
          <span className="px-4 py-2 text-sm text-red-400">
            Rejected — {error}
          </span>
        )}
      </div>
    </div>
  );
}
