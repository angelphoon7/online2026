"use client";

import { useEffect, useRef, useState } from 'react';
import type { Hex } from 'viem';
import { EXPLORER } from '@/lib/ui-copy';

type Props = {
  busy: string;
  notice: string;
  hash?: Hex;
  confirmation: { block: string; hashes: Hex[] } | null;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
};

function Toast({ title, confirmed, paused, onOpen }: { title: string; confirmed: boolean; paused: boolean; onOpen: () => void }) {
  const [phase, setPhase] = useState<'visible' | 'leaving' | 'hidden'>('visible');
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (phase === 'hidden' || paused || hovered || focused) return;
    const timer = setTimeout(() => setPhase(phase === 'visible' ? 'leaving' : 'hidden'), phase === 'visible' ? 5000 : 240);
    return () => clearTimeout(timer);
  }, [phase, paused, hovered, focused]);
  if (phase === 'hidden') return null;
  return <div className={`activity-toast${phase === 'leaving' ? ' is-leaving' : ''}`}
    onMouseEnter={() => { setHovered(true); setPhase('visible'); }} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => { setFocused(true); setPhase('visible'); }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <button type="button" className="activity-toast-open" onClick={onOpen} aria-haspopup="dialog" aria-label={`${title}. View activity details`}>
      <span className={`activity-toast-icon${confirmed ? ' is-confirmed' : ''}`} aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          {confirmed ? <path d="m5 12 4 4L19 6" /> : <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>}
        </svg>
      </span>
      <span className="activity-toast-copy"><strong>{title}</strong><span>View details <span aria-hidden="true">↗</span></span></span>
    </button>
    <button type="button" className="activity-toast-dismiss" aria-label="Dismiss notification" onClick={() => setPhase('hidden')}>×</button>
  </div>;
}

export default function ActivityNotification({ busy, notice, hash, confirmation, open, onOpen, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      if (element.open) element.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);
  const active = !!(busy || notice || hash || confirmation);
  // An earlier approval receipt must not label the next, still-pending transaction confirmed.
  const currentConfirmed = !!confirmation && (!hash || confirmation.hashes.includes(hash));
  const title = currentConfirmed ? 'Transaction confirmed' : busy || 'Activity update';
  const hashes = [...new Set([...(confirmation?.hashes ?? []), ...(hash ? [hash] : [])])];
  // Only a new action update restarts the toast. Market polling cannot bring it back.
  const notificationKey = JSON.stringify([busy, notice, hash, confirmation?.block, confirmation?.hashes]);
  return <>
    <div className="activity-notifications" role="status" aria-live="polite" aria-atomic="true">
      {active && <Toast key={notificationKey} title={title} confirmed={currentConfirmed} paused={open} onOpen={onOpen} />}
    </div>
    <dialog ref={dialog} className="activity-details-dialog" aria-labelledby="activity-details-title" onClose={onClose} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
    }}>
      <header className="activity-details-heading"><h2 id="activity-details-title">Activity details</h2><button type="button" className="activity-details-close" aria-label="Close activity details" onClick={() => dialog.current?.close()}>×</button></header>
      <p className="activity-details-status">{title}</p>
      {notice && <p>{notice}</p>}
      {busy && <p className="quiet">{busy}. This action is still in progress.</p>}
      {confirmation && <p className="quiet">Transaction confirmed at block <span className="mono">#{confirmation.block}</span>.</p>}
      {hashes.length > 0 && <div className="activity-details-transactions"><h3>Transactions</h3>{hashes.map(tx => <a key={tx} className="hash" href={`${EXPLORER}/tx/${tx}`} target="_blank" rel="noreferrer">{tx} <span aria-hidden="true">↗</span></a>)}</div>}
      {!active && <p>No activity yet.</p>}
    </dialog>
  </>;
}
