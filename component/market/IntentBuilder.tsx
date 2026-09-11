"use client";
import { useRef, useState } from 'react';
import type { Address } from 'viem';
import type { IntentParams } from '@/lib/contracts';
import type { ChainTicket, MarketSnapshot } from '@/lib/market-types';
import { intentTypedData, jsonNumbers } from '@/lib/intent-typed-data';
import { initialIntent, nextRecordedNonce } from '@/lib/intent-draft';
import { getIntentPool, getSeatCustody, getTicketsFor, ticketHolder } from '@/lib/chain-reads';
import { truncateAddress } from '@/lib/format';
import { ADJACENCY_ACCEPTED, ADJACENCY_ERROR, ADJACENCY_NOTE, ALLOWANCE_NOTE, DEMO_POSITIONS_NOTE, EMPTY_POSITIONS_NOTE, ENFORCEABLE, ESCROW_NOTE, EXACT_COUNT_NOTE, OWN_POSITIONS_NOTE, PICK_OFFERED_NOTE, STEPS, WITHDRAWAL_DETAIL, intentReview, maskClasses, maskSummary, paymentLabel } from '@/lib/ui-copy';

const same = (a: string, b: string | null) => a.toLowerCase() === b?.toLowerCase();
const hasClass = (mask: bigint, n: number) => (mask & (1n << BigInt(n))) !== 0n;
export default function IntentBuilder({ market, account, approved, busy, onApprove, onCustody, onSign }: {
  market: MarketSnapshot; account: Address | null; approved: boolean; busy: boolean;
  onApprove: () => Promise<void>;
  onCustody: (ticket: ChainTicket, mode: 'deposit' | 'withdraw') => Promise<void>;
  onSign: (intent: IntentParams, prepared: (intent: IntentParams) => void) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => initialIntent(market, account));
  const [prepared, setPrepared] = useState<IntentParams | null>(null);
  const [step, setStep] = useState(1);
  const [reached, setReached] = useState(1);
  const [raw, setRaw] = useState(false);
  const stepTitles = useRef<(HTMLHeadingElement | null)[]>([]);
  const intent: IntentParams = prepared && same(prepared.owner, account) ? prepared : {
    ...draft, owner: account ?? draft.owner, nonce: nextRecordedNonce(market, account),
  };
  const update = (patch: Partial<IntentParams>) => {
    setPrepared(null); setDraft(i => ({ ...i, ...patch }));
    if (patch.offered?.length === 0) setReached(1);
  };
  const go = (next: number) => {
    setStep(next); setReached(n => Math.max(n, next));
    setTimeout(() => stepTitles.current[next - 1]?.focus({ preventScroll: true }), 0);
  };
  const allTickets = getTicketsFor(null, market, intent.eventId);
  const positions = getTicketsFor(account, market, intent.eventId);
  const live = getIntentPool(market, intent.eventId);
  const sessions = [...new Set(allTickets.map(t => t.sessionId))].sort((a, b) => a - b);
  const sections = [...new Set(allTickets.map(t => t.sectionId))].sort((a, b) => a - b);
  const offered = allTickets.filter(t => intent.offered.includes(BigInt(t.tokenId)));
  const review = intentReview(intent, !account);
  const preview = intentTypedData(intent);
  const deadline = Number(intent.deadline);
  const budgetValue = Number(intent.maxNetPay / 1000000n);
  const summary = (n: number) => n === 1
    ? `${offered.map(t => `R${t.row} S${t.seat}`).join(', ')} · sessions ${[...new Set(offered.map(t => t.sessionId))].join(', ')}`
    : n === 2 ? `exactly ${intent.exactCount} · sessions ${maskSummary(intent.sessionMask)} · sections ${maskSummary(intent.sectionMask)} · ${paymentLabel(intent.maxNetPay)}`
      : `event ${intent.eventId} · nonce ${intent.nonce}`;
  const position = (t: ChainTicket) => {
    const escrowed = t.depositor !== '0x0000000000000000000000000000000000000000';
    const committed = escrowed && live.some(i => same(i.owner, ticketHolder(t)) && i.offered.includes(t.tokenId));
    return <article key={t.tokenId} className="position">
      <div><label><input type="checkbox" aria-label={`Offer ticket ${t.tokenId}`} disabled={busy || t.status === 1} checked={intent.offered.includes(BigInt(t.tokenId))}
        onChange={() => update({ offered: intent.offered.includes(BigInt(t.tokenId)) ? intent.offered.filter(id => id !== BigInt(t.tokenId)) : [...intent.offered, BigInt(t.tokenId)] })} />
        <span className="mono">#{t.tokenId} · SESSION {t.sessionId}</span></label>
        <p className="mono">ROW {t.row} / SEAT {t.seat} / SECTION {t.sectionId}</p><p className="quiet mono">{truncateAddress(ticketHolder(t))}</p>
      </div>
      <div className="position-actions"><span className="badge">{t.status === 1 ? 'USED' : committed ? 'committed' : escrowed ? 'escrowed' : 'wallet'}</span>
        {t.status !== 1 && <button disabled={busy} onClick={() => void onCustody(t, escrowed ? 'withdraw' : 'deposit')}>{escrowed ? 'Withdraw' : 'Deposit'}</button>}
      </div>
    </article>;
  };
  return <div className="intent-flow">
    {STEPS.map((title, index) => {
      const number = index + 1;
      const expanded = step === number;
      const visited = reached >= number;
      return <section key={title} className={`workspace-panel intent-step ${expanded ? 'is-expanded' : visited ? 'is-complete' : 'is-future'}`} data-step={number} data-expanded={expanded}>
        <div className="step-heading"><h2 ref={element => { stepTitles.current[index] = element; }} tabIndex={-1} id={`step-title-${number}`}>
          {!expanded && number < reached && <span className="step-check" aria-label="Completed">✓</span>}{title}
        </h2>{expanded ? <span className="mono step-marker">step {number} of 3</span> : visited && <><span className="mono step-summary">{summary(number)}</span><button className="text-button" disabled={busy} onClick={() => go(number)} aria-label={`Change ${title}`}>Change</button></>}</div>
        {expanded && <div className="step-content" aria-labelledby={`step-title-${number}`}>
          {number === 1 && <>
            <p className="quiet">{account ? OWN_POSITIONS_NOTE : DEMO_POSITIONS_NOTE}</p>
            {account && !approved && <button className="secondary" disabled={busy} onClick={() => void onApprove()}>Approve tickets</button>}
            <div className="position-list">{positions.slice(0, 8).map(position)}</div>
            {positions.length > 8 && <details className="more-tickets"><summary className="mono">+{positions.length - 8} more</summary><div>{positions.slice(8).map(position)}</div></details>}
            {!positions.length && <p>{EMPTY_POSITIONS_NOTE}</p>}
            <p className="quiet">{ESCROW_NOTE} {WITHDRAWAL_DETAIL} {PICK_OFFERED_NOTE}</p>
            <button className="primary step-continue" disabled={busy || !intent.offered.length} onClick={() => go(2)}>Continue <span>→</span></button>
          </>}
          {number === 2 && <div className="builder">
            <p className="quiet">{ENFORCEABLE}</p>
            <div className="condition-row"><label id="count-label">How many tickets</label><div className="condition-control"><div className="stepper" aria-labelledby="count-label">
              <button disabled={busy || intent.exactCount <= 1} onClick={() => update({ exactCount: intent.exactCount - 1, ...(intent.exactCount === 2 ? { mustBeAdjacent: false } : {}) })} aria-label="Decrease ticket count">−</button>
              <output className="mono" aria-live="polite">{intent.exactCount}</output><button disabled={busy || intent.exactCount >= 4} onClick={() => update({ exactCount: intent.exactCount + 1 })} aria-label="Increase ticket count">+</button>
            </div><span className="quiet">{EXACT_COUNT_NOTE}</span></div></div>
            <div className="condition-row"><span id="sessions-label">Which nights</span><div className="chips" role="group" aria-labelledby="sessions-label">{sessions.map(n => <button key={n} disabled={busy} aria-pressed={hasClass(intent.sessionMask, n)} onClick={() => update({ sessionMask: intent.sessionMask ^ (1n << BigInt(n)) })}>SESSION <span className="mono">{n}</span></button>)}</div></div>
            <div className="condition-row"><span id="sections-label">Which sections</span><div className="chips" role="group" aria-labelledby="sections-label">{sections.map(n => <button key={n} disabled={busy} aria-pressed={hasClass(intent.sectionMask, n)} onClick={() => update({ sectionMask: intent.sectionMask ^ (1n << BigInt(n)) })}>SECTION <span className="mono">{n}</span></button>)}</div></div>
            <div className="condition-row"><span>Cohesion</span><div className="toggles"><label><input type="checkbox" disabled={busy} checked={intent.mustShareSection} onChange={e => update({ mustShareSection: e.target.checked })} />Same section</label><label><input type="checkbox" disabled={busy} checked={intent.mustShareSession} onChange={e => update({ mustShareSession: e.target.checked })} />Same session</label></div></div>
            <div className="condition-row"><label htmlFor="adjacent-seats">Seats must be next to each other</label><div><input id="adjacent-seats" type="checkbox" disabled={busy} checked={intent.mustBeAdjacent} onChange={e => update({ mustBeAdjacent: e.target.checked, ...(e.target.checked && intent.exactCount < 2 ? { exactCount: 2 } : {}) })} />
              {intent.mustBeAdjacent && <div className="adjacency-illustration" role="img" aria-label={`${ADJACENCY_ACCEPTED}: 3, 4. ${ADJACENCY_ERROR}: 3, 5.`}>
                {[true, false].map(valid => <div className="adjacency-example" key={String(valid)}><div aria-hidden="true">{[1, 2, 3, 4, 5, 6].map(n => <span key={n} className={n === 3 || n === (valid ? 4 : 5) ? 'illustration-seat filled' : 'illustration-seat'} />)}</div><span className={valid ? '' : 'mono rejected'}>{valid ? ADJACENCY_ACCEPTED : ADJACENCY_ERROR}</span></div>)}
              </div>}
            </div></div>
            <div className="condition-row"><label htmlFor="net-budget">Money</label><div><div className="budget-label mono" aria-live="polite">{paymentLabel(intent.maxNetPay)}</div>
              <input id="net-budget" className="budget-slider" disabled={busy} type="range" min="-1000" max="1000" step="1" value={budgetValue} onChange={e => update({ maxNetPay: BigInt(e.target.value) * 1000000n })} />
              <div className="slider-scale mono"><span>−1,000</span><span>even</span><span>+1,000</span></div>
            </div></div>
            <div className="condition-row"><label htmlFor="valid-until">Valid until</label><input id="valid-until" disabled={busy} type="datetime-local" value={new Date((deadline - new Date(deadline * 1000).getTimezoneOffset() * 60) * 1000).toISOString().slice(0, 16)} onChange={e => { const n = Date.parse(e.target.value); if (Number.isFinite(n)) update({ deadline: BigInt(Math.floor(n / 1000)) }); }} /></div>
            <button className="primary step-continue" disabled={busy || !intent.sessionMask || !intent.sectionMask} onClick={() => go(3)}>Continue <span>→</span></button>
          </div>}
          {number === 3 && <>
            <div className="signed-sentence"><p>{review.sentence}</p><p className="quiet mono">{review.metadata}</p></div>
            <button className="text-button" onClick={() => setRaw(!raw)} aria-expanded={raw}>View signed struct {raw ? '−' : '+'}</button>
            {raw && <pre className="raw-struct">{jsonNumbers(account ? preview : { ...preview, message: { ...preview.message, owner: 'Wallet selected at signing', nonce: 'Read after connection' } })}</pre>}
            <button className="primary full" disabled={busy || !intent.offered.length || !intent.sessionMask || !intent.sectionMask} onClick={() => void onSign(intent, setPrepared)}>Sign and commit <span>↗</span></button>
            <p className="quiet">{ALLOWANCE_NOTE}</p>
          </>}
        </div>}
      </section>;
    })}
    <details className="workspace-panel seat-map"><summary>Seat map</summary><div className="seat-map-content">
      {maskClasses(intent.sessionMask).flatMap(session => maskClasses(intent.sectionMask).map(section => {
        const visible = getSeatCustody(session, section, market, intent.eventId);
        const rows = [...new Set(visible.map(t => t.row))].sort((a, b) => a - b);
        return <section key={`${session}:${section}`}><h3 className="mono">SESSION {session} / SECTION {section}</h3><div className="stage mono">STAGE</div><div className="seat-grid">
          {rows.map(row => {
            const windows = [...new Set(visible.filter(t => t.row === row).map(t => Math.floor(Math.max(0, t.seat - 1) / 12) * 12))].sort((a, b) => a - b);
            return windows.map(start => <div className="seat-row" key={`${row}:${start}`}><span className="mono row-label">R{row}</span><div className="seat-cells">{Array.from({ length: 12 }, (_, n) => start + n + 1).map(seat => {
              const at = visible.filter(t => t.row === row && t.seat === seat);
              return <div key={seat} className="seat-cell">{at.length ? at.map(t => <span key={t.tokenId} className={`seat ${same(ticketHolder(t), account) ? 'yours' : t.depositor !== '0x0000000000000000000000000000000000000000' ? 'available' : 'other'}`} title={`Ticket #${t.tokenId} · ${ticketHolder(t)}${t.status === 1 ? ' · USED' : ''}`}>{seat}{t.status === 1 ? '×' : ''}</span>) : <span className="seat unissued" title="No issued ticket at this position">·</span>}</div>;
            })}</div></div>);
          })}
        </div></section>;
      }))}
      <div className="seat-legend"><span>□ Escrowed</span><span>▣ Held by you</span><span>▧ Other wallet</span><span>· Unissued</span><span>× USED</span></div>
      <p className="quiet">{ADJACENCY_NOTE}</p>
    </div></details>
  </div>;
}
