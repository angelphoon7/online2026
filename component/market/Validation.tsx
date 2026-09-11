"use client";
import { useEffect, useState } from 'react';
import type { NamedRejection } from '@/lib/proposal-controls';
import { EXPLORER } from '@/lib/ui-copy';

const checks = [
  ['V0', 'Struct hashes and settlement shape'], ['V1', 'Committed intents live and unexpired'],
  ['V2', 'Tickets escrowed by their owners · event binding'], ['V3', 'Tickets unused'],
  ['V4', 'Every offered ticket allocated exactly once'], ['V5', 'Counts, session and section masks, cohesion, adjacency'],
  ['V6', 'Every participant’s signed payment limit'], ['V7', 'Net USDC sum = 0'], ['V8', 'Owner net balances and allowances'],
] as const;
const failures: Record<string, number> = { MalformedSettlement: 0, DuplicateIntentHash: 0, IntentHashMismatch: 0,
  IntentNotLive: 1, IntentExpired: 1, TicketNotEscrowed: 2, WrongEvent: 2, TicketRedeemed: 3,
  ConservationViolated: 4, CountMismatch: 5, SessionNotAccepted: 5, SectionNotAccepted: 5, NotSameSession: 5,
  NotSameSection: 5, SeatsNotAdjacent: 5, BudgetExceeded: 6, PaymentImbalance: 7, InsufficientPaymentCapacity: 8 };
export default function Validation({ status, hash, rejection }: { status: string; hash?: string; rejection?: NamedRejection | null }) {
  const [shown, setShown] = useState(0);
  const done = status === 'confirmed' || status === 'reverted';
  const stop = rejection ? failures[rejection.name] : undefined;
  useEffect(() => {
    if (!done) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const timer = setTimeout(() => setShown(checks.length), 0);
      return () => clearTimeout(timer);
    }
    let n = 0;
    const timer = setInterval(() => { setShown(++n); if (n >= checks.length) clearInterval(timer); }, 120);
    return () => clearInterval(timer);
  }, [done, hash, rejection?.name]);
  return <section className="validation" aria-live="polite">
    <div className="panel-heading"><span className="eyebrow">Contract validation</span><span className="mono">{status}</span></div>
    {hash && <a className="hash" href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">{hash} ↗</a>}
    <p className="quiet">{done ? 'Receipt confirmed. This is a visual explanation of contract order, not a live execution trace.' : 'Waiting for the wallet or receipt. Checks have not been marked as passed.'} Signatures were authenticated when each intent was committed.</p>
    <ol className="check-list">{checks.map(([code, label], index) => {
      const passed = status === 'confirmed' && index < shown;
      const failed = status === 'reverted' && stop === index && index < shown;
      return <li key={code} className={passed ? 'passed' : failed ? 'rejected' : ''}><span className="mono">{passed ? '✓' : failed ? '×' : '·'} {code}</span>{label}</li>;
    })}</ol>
    {rejection && <div className="rejection" role="alert"><h2>{rejection.name}({rejection.args.join(', ')})</h2>
      <p>{hash ? 'The receipt confirms failure. Error arguments come from replaying the transaction at the preceding block; intermediate checks are not individually traced.' : 'Decoded from eth_call. No transaction was broadcast.'}</p></div>}
  </section>;
}
