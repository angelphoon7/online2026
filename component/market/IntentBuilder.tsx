"use client";
import { useRef, useState } from 'react';
import type { Address } from 'viem';
import type { IntentParams } from '@/lib/contracts';
import type { ChainTicket, MarketSnapshot } from '@/lib/market-types';
import { intentTypedData, jsonNumbers } from '@/lib/intent-typed-data';
import { initialIntent, nextRecordedNonce } from '@/lib/intent-draft';
import { getIntentPool, getSeatCustody, getTicketsFor, ticketHolder } from '@/lib/chain-reads';
import { DEMO_SECTION_PRICES, demoPriceQuote } from '@/lib/demo-pricing';
import { selectedClass, sessionStart, sessionDeadline, formatEventTime } from '@/lib/event-schedule';
import { EVENT_CUTOFF_NOTE, DEMO_SCHEDULE_NOTE, CLOSED_SESSION_NOTE, MISSING_SCHEDULE_NOTE } from '@/lib/ui-copy';
import { FREE_TICKETS_LABEL, DEMO_PRICE_NOTE } from '@/lib/ui-copy';
import { formatUSDC, truncateAddress } from '@/lib/format';
import { DEMO_TICKET_NOTE } from '@/lib/ui-copy';
import { ADJACENCY_ACCEPTED, ADJACENCY_ERROR, ADJACENCY_NOTE, ALLOWANCE_NOTE, CONNECT_POSITIONS_NOTE, EMPTY_POSITIONS_NOTE, ENFORCEABLE, ESCROW_NOTE, EXACT_COUNT_NOTE, OWN_POSITIONS_NOTE, PICK_OFFERED_NOTE, STEPS, WITHDRAWAL_DETAIL, intentReview, maskClasses, maskSummary, paymentLabel } from '@/lib/ui-copy';

const same = (a: string, b: string | null) => a.toLowerCase() === b?.toLowerCase();
const hasClass = (mask: bigint, n: number) => (mask & (1n << BigInt(n))) !== 0n;
export default function IntentBuilder({ market, account, approved, busy, onApprove, onCustody, onDepositSelected, onSign, onDemo, onConnect, connectionError }: {
  market: MarketSnapshot; account: Address | null; approved: boolean; busy: boolean;
  onConnect: () => Promise<void>;
  connectionError: string | null;
  onApprove: () => Promise<void>;
  onDemo: () => Promise<void>;
  onCustody: (ticket: ChainTicket, mode: 'deposit' | 'withdraw') => Promise<void>;
  onDepositSelected: (tokenIds: bigint[]) => Promise<void>;
  onSign: (intent: IntentParams, prepared: (intent: IntentParams) => void) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => initialIntent(market, account));
  const [prepared, setPrepared] = useState<IntentParams | null>(null);
  const [step, setStep] = useState(1);
  const [reached, setReached] = useState(1);
  const [manualBudget, setManualBudget] = useState(false);
  const [raw, setRaw] = useState(false);
  const stepTitles = useRef<(HTMLHeadingElement | null)[]>([]);
  const [selectionAccount, setSelectionAccount] = useState(account?.toLowerCase() ?? null);
  if (selectionAccount !== (account?.toLowerCase() ?? null)) {
    setSelectionAccount(account?.toLowerCase() ?? null);
    setDraft(previous => ({ ...previous, offered: [] }));
    setPrepared(null); setManualBudget(false);
    setStep(previous => Math.min(previous, 2));
    setReached(previous => Math.min(previous, 2));
  }
  const savedIntent: IntentParams = prepared && same(prepared.owner, account) ? prepared : {
    ...draft, owner: account ?? draft.owner, nonce: nextRecordedNonce(market, account),
  };
  const update = (patch: Partial<IntentParams>) => {
    setPrepared(null); setDraft(i => ({ ...i, ...patch }));
    if (patch.offered?.length === 0) setReached(n => Math.min(n, 2));
    if (patch.sectionMask === 0n || patch.sessionMask === 0n) setReached(1);
  };
  const go = (next: number) => {
    setStep(next); setReached(n => Math.max(n, next));
    setTimeout(() => stepTitles.current[next - 1]?.focus({ preventScroll: true }), 0);
  };
  const positions = account ? getTicketsFor(account, market, savedIntent.eventId) : [];
  const baseIntent = { ...savedIntent, offered: savedIntent.offered.filter(id => positions.some(t => t.tokenId === String(id) && t.status !== 1)) };
  const allTickets = getTicketsFor(null, market, baseIntent.eventId);
  const quote = demoPriceQuote(baseIntent, allTickets);
  const intent: IntentParams = { ...baseIntent, maxNetPay: prepared && same(prepared.owner, account) || manualBudget || !quote ? baseIntent.maxNetPay : quote.suggestedLimit };
  const selectedPositions = positions.filter(t => intent.offered.includes(BigInt(t.tokenId)) && t.status !== 1);
  const toDeposit = selectedPositions.filter(t => t.depositor === '0x0000000000000000000000000000000000000000');
  const live = getIntentPool(market, intent.eventId);
  const sessions = [...new Set(allTickets.map(t => t.sessionId))].sort((a, b) => a - b);
  const sections = [...new Set([...Object.keys(DEMO_SECTION_PRICES).map(Number), ...allTickets.map(t => t.sectionId)])].sort((a, b) => a - b);
  const offered = allTickets.filter(t => intent.offered.includes(BigInt(t.tokenId)));
  const review = intentReview(intent, !account);
  const preview = intentTypedData(intent);
  const selectedSession = selectedClass(intent.sessionMask);
  const eventStart = selectedSession === null ? null : sessionStart(selectedSession);
  const cutoff = sessionDeadline(intent.sessionMask);
  const timingUnavailable = cutoff === null || cutoff <= BigInt(market.timestamp);
  const choiceInvalid = selectedClass(intent.sessionMask) === null || selectedClass(intent.sectionMask) === null;
  const budgetValue = Number(intent.maxNetPay) / 1000000;
  const summary = (n: number) => n === 2
    ? `${offered.map(t => `R${t.row} S${t.seat}`).join(', ')} · sessions ${[...new Set(offered.map(t => t.sessionId))].join(', ')}`
    : n === 1 ? `exactly ${intent.exactCount} · sessions ${maskSummary(intent.sessionMask)} · sections ${maskSummary(intent.sectionMask)} · ${paymentLabel(intent.maxNetPay)}`
      : `event ${intent.eventId} · nonce ${intent.nonce}`;
  const position = (t: ChainTicket) => {
    const escrowed = t.depositor !== '0x0000000000000000000000000000000000000000';
    const committed = escrowed && live.some(i => same(i.owner, ticketHolder(t)) && i.offered.includes(t.tokenId));
    return <article key={t.tokenId} className="position">
      <div><label><input type="checkbox" aria-label={`Offer ticket ${t.tokenId}`} disabled={busy || t.status === 1} checked={intent.offered.includes(BigInt(t.tokenId))}
        onChange={() => update({ offered: intent.offered.includes(BigInt(t.tokenId)) ? intent.offered.filter(id => id !== BigInt(t.tokenId)) : [...intent.offered, BigInt(t.tokenId)] })} />
        <span className="mono">#{t.tokenId} · SESSION {t.sessionId}</span></label>
        <p className="mono">ROW {t.row} / SEAT {t.seat} / SECTION {t.sectionId}</p><p className="quiet mono">{truncateAddress(ticketHolder(t))}</p><p className="mono">{DEMO_SECTION_PRICES[t.sectionId] === undefined ? 'Demo reference price unavailable' : `Demo reference: ${formatUSDC(DEMO_SECTION_PRICES[t.sectionId])} USDC / ticket`}</p>
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
        </h2>{expanded ? <span className="mono step-marker">step {number} of {STEPS.length}</span> : visited && <><span className="mono step-summary">{summary(number)}</span><button className="text-button" disabled={busy} onClick={() => go(number)} aria-label={`Change ${title}`}>Change</button></>}</div>
        {expanded && <div className="step-content" aria-labelledby={`step-title-${number}`}>
          {number === 2 && <>
            <p className="quiet">{account ? OWN_POSITIONS_NOTE : CONNECT_POSITIONS_NOTE}</p>
            {!account && <button className="secondary connect-positions" disabled={busy} onClick={() => void onConnect()}>Connect wallet to see my tickets</button>}
            {connectionError && <p role="alert">{connectionError}</p>}
            <button className="secondary" disabled={busy} onClick={() => void onDemo()} aria-label={FREE_TICKETS_LABEL}>{FREE_TICKETS_LABEL}</button>
            <p className="quiet">{DEMO_TICKET_NOTE}</p>
            {account && !approved && positions.some(t => t.status !== 1 && same(t.owner, account) && t.depositor === '0x0000000000000000000000000000000000000000') && <button className="secondary" disabled={busy} onClick={() => void onApprove()}>Approve tickets</button>}
            <div className="position-list">{positions.slice(0, 8).map(position)}</div>
            {positions.length > 8 && <details className="more-tickets"><summary className="mono">+{positions.length - 8} more</summary><div>{positions.slice(8).map(position)}</div></details>}
            {account && !positions.length && <p role="status">{EMPTY_POSITIONS_NOTE}</p>}
            {positions.length > 0 && <><div className="batch-deposit">
              <button className="secondary" disabled={busy || !toDeposit.length} onClick={() => void onDepositSelected(selectedPositions.map(t => BigInt(t.tokenId)))}>
                {selectedPositions.length && !toDeposit.length ? 'Selected tickets deposited' : toDeposit.length ? `Deposit ${toDeposit.length} selected ticket${toDeposit.length === 1 ? '' : 's'}` : 'Deposit selected tickets'}
              </button>
              <p className="quiet">Select your tickets above, then deposit them together in one transaction. If approval is needed, confirm it first; the deposit follows automatically. Tickets already deposited are skipped.</p>
            </div>
            <p className="quiet">{ESCROW_NOTE} {WITHDRAWAL_DETAIL} {PICK_OFFERED_NOTE}</p>
            <div className="price-comparison"><h3>Compare your tickets</h3><p className="quiet">{DEMO_PRICE_NOTE}</p>
              {quote ? <dl className="quote-lines mono"><div><dt>Your selected tickets</dt><dd>{formatUSDC(quote.offeredTotal)} USDC</dd></div><div><dt>Wanted tickets</dt><dd>{formatUSDC(quote.wantedMin)}{quote.wantedMin !== quote.wantedMax ? ` - ${formatUSDC(quote.wantedMax)}` : ''} USDC</dd></div><div><dt>Suggested payment limit</dt><dd>{paymentLabel(quote.suggestedLimit)}</dd></div></dl> : <p className="quiet">Select your offered tickets to calculate the comparison. Tickets in unpriced sections use your manually chosen limit.</p>}
            </div>
            <div className="condition-row"><label htmlFor="net-budget">Your signed payment limit</label><div><div className="budget-label mono" aria-live="polite">{paymentLabel(intent.maxNetPay)}</div>
              <input id="net-budget" className="budget-slider" disabled={busy} type="range" min="-40" max="40" step="0.5" value={budgetValue} onChange={e => { setManualBudget(true); update({ maxNetPay: BigInt(Math.round(Number(e.target.value) * 1000000)) }); }} />
              <div className="slider-scale mono"><span>−40 USDC</span><span>even</span><span>+40 USDC</span></div>
            </div></div>
            </>}
            <div className="intent-step-actions">
              {positions.length > 0 && <button className="secondary suggested-limit" disabled={busy || !quote || !manualBudget} onClick={() => { setPrepared(null); setManualBudget(false); }}>{quote && !manualBudget ? 'Suggested limit applied' : 'Use suggested limit'}</button>}
            </div>
            <div className="inline-intent-review">
              <h3>Review and sign</h3>
            {timingUnavailable && <p role="alert">{cutoff === null ? MISSING_SCHEDULE_NOTE : CLOSED_SESSION_NOTE}</p>}
            {intent.offered.length > 0 && <><div className="signed-sentence"><p>{review.sentence}</p><p className="quiet mono">{review.metadata}</p></div>
            <button className="text-button" onClick={() => setRaw(!raw)} aria-expanded={raw}>View signed struct {raw ? '−' : '+'}</button>
            {raw && <pre className="raw-struct">{jsonNumbers(account ? preview : { ...preview, message: { ...preview.message, owner: 'Wallet selected at signing', nonce: 'Read after connection' } })}</pre>}
            </>}
            {!intent.offered.length && <p className="quiet">Select the tickets you want to offer above to review your request.</p>}
            {toDeposit.length > 0 && <p className="quiet">Deposit your selected tickets above before signing.</p>}
            <button className="primary full sign-intent" disabled={busy || !account || !intent.offered.length || toDeposit.length > 0 || choiceInvalid || timingUnavailable} onClick={() => void onSign(intent, setPrepared)}>Sign and commit <span>↗</span></button>
            <p className="quiet">{ALLOWANCE_NOTE}</p>
            </div>
          </>}
          {number === 1 && <div className="builder">
            <p className="quiet">{ENFORCEABLE}</p>
            <div className="condition-row"><label id="count-label">How many tickets</label><div className="condition-control"><div className="stepper" aria-labelledby="count-label">
              <button disabled={busy || intent.exactCount <= 1} onClick={() => update({ exactCount: intent.exactCount - 1, ...(intent.exactCount === 2 ? { mustBeAdjacent: false } : {}) })} aria-label="Decrease ticket count">−</button>
              <output className="mono" aria-live="polite">{intent.exactCount}</output><button disabled={busy || intent.exactCount >= 4} onClick={() => update({ exactCount: intent.exactCount + 1, ...(intent.exactCount === 1 ? { mustBeAdjacent: true } : {}) })} aria-label="Increase ticket count">+</button>
            </div><span className="quiet">{EXACT_COUNT_NOTE}</span></div></div>
            <div className="condition-row"><span id="sessions-label">Which night</span><div className="chips" role="radiogroup" aria-labelledby="sessions-label">{sessions.map(n => <label key={n} className="single-choice" data-selected={hasClass(intent.sessionMask, n)}><input type="radio" name="wanted-session" value={n} disabled={busy} checked={hasClass(intent.sessionMask, n)} onChange={() => update({ sessionMask: 1n << BigInt(n), deadline: sessionDeadline(1n << BigInt(n)) ?? 0n })} /><span>SESSION <span className="mono">{n}</span>{sessionStart(n) !== null && <span className="choice-detail mono">{formatEventTime(sessionStart(n)!)}</span>}</span></label>)}</div></div>
            <div className="condition-row"><span id="sections-label">Which section</span><div className="chips" role="radiogroup" aria-labelledby="sections-label">{sections.map(n => {
              const issued = allTickets.filter(t => t.sessionId === selectedSession && t.sectionId === n).length;
              return <label key={n} className="single-choice" data-selected={hasClass(intent.sectionMask, n)}><input type="radio" name="wanted-section" value={n} disabled={busy} checked={hasClass(intent.sectionMask, n)} onChange={() => update({ sectionMask: 1n << BigInt(n) })} /><span>SECTION <span className="mono">{n}</span>{DEMO_SECTION_PRICES[n] !== undefined && <span className="choice-detail mono">{formatUSDC(DEMO_SECTION_PRICES[n])} USDC / ticket</span>}<span className="choice-detail">{issued ? `${issued} issued tickets` : 'No tickets issued yet'}</span></span></label>;
            })}</div></div>
            <div className="condition-row"><span>Cohesion</span><div className="toggles"><label><input type="checkbox" disabled={busy} checked={intent.mustShareSection} onChange={e => update({ mustShareSection: e.target.checked })} />Same section</label><label><input type="checkbox" disabled={busy} checked={intent.mustShareSession} onChange={e => update({ mustShareSession: e.target.checked })} />Same session</label></div></div>
            <div className="condition-row"><label htmlFor="adjacent-seats">Seats must be next to each other</label><div><input id="adjacent-seats" type="checkbox" disabled={busy} checked={intent.mustBeAdjacent} onChange={e => update({ mustBeAdjacent: e.target.checked, ...(e.target.checked && intent.exactCount < 2 ? { exactCount: 2 } : {}) })} />
              {intent.mustBeAdjacent && <div className="adjacency-illustration" role="img" aria-label={`${ADJACENCY_ACCEPTED}: 3, 4. ${ADJACENCY_ERROR}: 3, 5.`}>
                {[true, false].map(valid => <div className="adjacency-example" key={String(valid)}><div aria-hidden="true">{[1, 2, 3, 4, 5, 6].map(n => <span key={n} className={n === 3 || n === (valid ? 4 : 5) ? 'illustration-seat filled' : 'illustration-seat'} />)}</div><span className={valid ? '' : 'mono rejected'}>{valid ? ADJACENCY_ACCEPTED : ADJACENCY_ERROR}</span></div>)}
              </div>}
            </div></div>
            <div className="condition-row"><span id="valid-until-label">Valid until</span><div><p>{EVENT_CUTOFF_NOTE}</p>{cutoff !== null && eventStart !== null ? <><p id="valid-until" className="mono" aria-labelledby="valid-until-label">{formatEventTime(cutoff)}</p><p className="quiet">Event starts: {formatEventTime(eventStart)}</p>{timingUnavailable && <p role="alert">{CLOSED_SESSION_NOTE}</p>}</> : <p role="alert">{MISSING_SCHEDULE_NOTE}</p>}<p className="quiet">{DEMO_SCHEDULE_NOTE}</p></div></div>
            <button className="primary step-continue" disabled={busy || choiceInvalid || timingUnavailable} onClick={() => go(2)}>Continue <span>→</span></button>
          </div>}

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
