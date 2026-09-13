"use client";

import { useEffect, useId, useRef, useState } from 'react';
import { QuarterRing } from '@/components/quarter-ring';
import styles from './EventLoadingDialog.module.css';

export default function EventLoadingDialog({ error, onRetry, onBack }: {
  error: string;
  onRetry: () => Promise<boolean>;
  onBack: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [retrying, setRetrying] = useState(false);
  const failed = !!error && !retrying;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      if (element.open) element.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const retry = async () => {
    setRetrying(true);
    try { await onRetry(); }
    finally { setRetrying(false); }
  };

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); onBack(); }}>
    <span className={`eyebrow ${styles.eyebrow}`}>AFTER HOURS / EVENT 1</span>
    <div role="status" aria-live="polite" aria-atomic="true">
      {!failed && <QuarterRing className={`size-14 ${styles.spinner}`} aria-hidden="true" />}
      <h2 id={titleId}>{failed ? 'Unable to load event' : 'Loading event…'}</h2>
      <p id={descriptionId} className={styles.description}>{failed
        ? 'Event data could not be loaded. Please try again.'
        : 'Reading tickets and live intents from the chain. Your workspace will open automatically when ready.'}</p>
    </div>
    {failed && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.actions}>
      {failed && <button type="button" className="primary" onClick={() => void retry()}>Retry loading</button>}
      <button type="button" className="secondary" onClick={onBack}>Back to Events</button>
    </div>
  </dialog>;
}
