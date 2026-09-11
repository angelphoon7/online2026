"use client";
import { useEffect, useRef, type ReactNode } from 'react';

export default function PoolDialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);
  return <dialog ref={ref} className="intent-pool-dialog" aria-labelledby="intent-pool-title" aria-describedby="intent-pool-description" onClose={onClose} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
  }}>
    <div className="panel-heading"><h2 id="intent-pool-title">Intent pool</h2><button className="secondary" onClick={() => ref.current?.close()} aria-label="Close intent pool">Close ×</button></div>
    <p id="intent-pool-description" className="quiet">Browse signed swap requests. Matching continues automatically while this list is closed. Selecting checkboxes switches to manual search.</p>
    {children}
  </dialog>;
}
