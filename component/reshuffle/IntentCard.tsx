"use client";

import { sessionName, sectionName, SESSIONS, SECTIONS } from '@/lib/config';
import { formatUSDC, truncateAddress } from '@/lib/format';

interface IntentCardProps {
  intentHash: string;
  owner: string;
  offered: bigint[];
  exactCount: number;
  sessionMask: bigint;
  sectionMask: bigint;
  mustShareSession: boolean;
  mustShareSection: boolean;
  mustBeAdjacent: boolean;
  maxNetPay: bigint;
  deadline: bigint;
  state: number;
  onRevoke?: () => void;
}

function maskToNames(mask: bigint, names: Record<number, string>): string[] {
  const result: string[] = [];
  for (const [id, name] of Object.entries(names)) {
    if ((mask & (1n << BigInt(id))) !== 0n) {
      result.push(name);
    }
  }
  return result;
}

const STATE_LABELS: Record<number, { text: string; color: string }> = {
  0: { text: 'NONE', color: 'text-white/40' },
  1: { text: 'LIVE', color: 'text-green-400' },
  2: { text: 'REVOKED', color: 'text-red-400' },
  3: { text: 'SETTLED', color: 'text-blue-400' },
};

export default function IntentCard({
  intentHash,
  owner,
  offered,
  exactCount,
  sessionMask,
  sectionMask,
  mustShareSession,
  mustShareSection,
  mustBeAdjacent,
  maxNetPay,
  state,
  onRevoke,
}: IntentCardProps) {
  const stateLabel = STATE_LABELS[state] ?? STATE_LABELS[0];
  const sessions = maskToNames(sessionMask, SESSIONS);
  const sections = maskToNames(sectionMask, SECTIONS);
  const isPureSeller = exactCount === 0;
  const isPureBuyer = offered.length === 0;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-white/40">
          {intentHash.slice(0, 10)}...
        </span>
        <span className={`text-xs font-medium ${stateLabel.color}`}>
          {stateLabel.text}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-white/60">{truncateAddress(owner)}</span>
        {isPureSeller && (
          <span className="rounded bg-orange-500/20 px-1.5 py-0.5 text-[10px] text-orange-400">
            SELLER
          </span>
        )}
        {isPureBuyer && (
          <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] text-green-400">
            BUYER
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {offered.length > 0 && (
          <div>
            <span className="text-white/40">Offering:</span>{' '}
            <span className="text-white/80">
              {offered.map((id) => `#${id}`).join(', ')}
            </span>
          </div>
        )}
        <div>
          <span className="text-white/40">Wants:</span>{' '}
          <span className="text-white/80">
            {exactCount === 0 ? 'cash only' : `${exactCount} ticket${exactCount > 1 ? 's' : ''}`}
          </span>
        </div>
        <div>
          <span className="text-white/40">Sessions:</span>{' '}
          <span className="text-white/80">{sessions.join(', ') || 'any'}</span>
        </div>
        <div>
          <span className="text-white/40">Sections:</span>{' '}
          <span className="text-white/80">{sections.join(', ') || 'any'}</span>
        </div>
        <div>
          <span className="text-white/40">Budget:</span>{' '}
          <span className="text-white/80">
            {maxNetPay >= 0n
              ? `pay at most ${formatUSDC(maxNetPay)} USDC`
              : `receive at least ${formatUSDC(-maxNetPay)} USDC`}
          </span>
        </div>
        {(mustShareSession || mustShareSection || mustBeAdjacent) && (
          <div>
            <span className="text-white/40">Constraints:</span>{' '}
            <span className="text-white/80">
              {[
                mustShareSession && 'same session',
                mustShareSection && 'same section',
                mustBeAdjacent && 'adjacent seats',
              ]
                .filter(Boolean)
                .join(', ')}
            </span>
          </div>
        )}
      </div>

      {onRevoke && state === 1 && (
        <button
          type="button"
          onClick={onRevoke}
          className="mt-1 self-start rounded border border-red-500/30 px-3 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/10"
        >
          Revoke
        </button>
      )}
    </div>
  );
}
