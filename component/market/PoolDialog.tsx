"use client";
import { useEffect, useRef, type ReactNode } from 'react';

export default function PoolDialog({
  open,
  onClose,
  count,
  children,
}: {
  open: boolean;
  onClose: () => void;
  count?: number;
  children: ReactNode;
}) {
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

  return (
    <dialog
      ref={ref}
      className="intent-pool-dialog"
      aria-labelledby="intent-pool-title"
      aria-describedby="intent-pool-description"
      onClose={onClose}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          event.currentTarget.close();
        }
      }}
    >
      <div className="pool-dialog-inner">
        <header className="pool-dialog-header">
          <div className="pool-header-top">
            <div className="pool-header-title-group">
              <h2 id="intent-pool-title">Intent pool</h2>
              {count !== undefined && (
                <span className="pool-count-badge mono" aria-label={`${count} live intents in pool`}>
                  {count} live intents
                </span>
              )}
            </div>
            <button
              type="button"
              className="secondary pool-close-btn"
              onClick={() => ref.current?.close()}
              aria-label="Close intent pool"
            >
              Close ×
            </button>
          </div>
          <p id="intent-pool-description" className="pool-dialog-desc quiet">
            Browse signed swap requests. Matching continues automatically while this list is closed. Selecting checkboxes switches to manual search.
          </p>
        </header>
        {children}
      </div>
    </dialog>
  );
}
