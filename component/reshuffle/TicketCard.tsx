"use client";

import { sessionName, sectionName } from '@/lib/config';

interface TicketCardProps {
  tokenId: bigint;
  eventId: number;
  sessionId: number;
  sectionId: number;
  row: number;
  seat: number;
  status: number;
  owner?: string;
  escrowed?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}

export default function TicketCard({
  tokenId,
  sessionId,
  sectionId,
  row,
  seat,
  status,
  escrowed,
  selected,
  onSelect,
}: TicketCardProps) {
  const redeemed = status === 1;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!onSelect || redeemed}
      className={`relative flex flex-col gap-1 rounded-lg border p-3 text-left text-sm transition-all ${
        selected
          ? 'border-blue-500 bg-blue-500/10'
          : redeemed
            ? 'border-red-500/30 bg-red-500/5 opacity-50'
            : 'border-white/10 bg-white/5 hover:border-white/20'
      } ${onSelect && !redeemed ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-white/50">#{tokenId.toString()}</span>
        <div className="flex gap-1">
          {escrowed && (
            <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-[10px] text-yellow-400">
              ESCROWED
            </span>
          )}
          {redeemed && (
            <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-400">
              REDEEMED
            </span>
          )}
        </div>
      </div>
      <div className="font-medium text-white">
        {sessionName(sessionId)} &middot; {sectionName(sectionId)}
      </div>
      <div className="text-white/60">
        Row {row}, Seat {seat}
      </div>
    </button>
  );
}
