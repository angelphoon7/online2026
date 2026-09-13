"use client";

import { useEffect, useId, useRef } from 'react';
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
  const retry = useRef(onRetry);

  useEffect(() => { retry.current = onRetry; }, [onRetry]);

  useEffect(() => {
    let stopped = false;
    let delay = 2000;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = async () => {
      // The shared reader coalesces in-flight reads and honors Retry-After. Never bypass
      // its cooldown or receipt block floor just to dismiss the loading dialog.
      const loaded = await retry.current().catch(() => false);
      if (stopped || loaded) return;
      delay = Math.min(delay * 2, 15000);
      timer = setTimeout(() => void attempt(), delay);
    };
    timer = setTimeout(() => void attempt(), delay);
    return () => { stopped = true; clearTimeout(timer); };
  }, []);

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

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); onBack(); }}>
    <span className={`eyebrow ${styles.eyebrow}`}>AFTER HOURS / EVENT 1</span>
    <div role="status" aria-live="polite" aria-atomic="true">
      <QuarterRing className={`size-14 ${styles.spinner}`} aria-hidden="true" />
      <h2 id={titleId}>Loading…</h2>
      <p id={descriptionId} className={styles.description}>{error
        ? 'This is taking longer than usual. We’ll keep trying automatically.'
        : 'Getting the latest tickets and swap requests.'}</p>
      <p className={styles.description}>Your workspace will open automatically when ready.</p>
    </div>
    <div className={styles.actions}>
      <button type="button" className="secondary" onClick={onBack}>Back to Events</button>
    </div>
  </dialog>;
}
