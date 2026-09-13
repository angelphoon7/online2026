"use client";
import { useEffect, useRef, useState } from 'react';
import type { Address } from 'viem';
import type { IntentParams } from '@/lib/contracts';
import type { ChainTicket, MarketSnapshot } from '@/lib/market-types';
import { intentTypedData, jsonNumbers } from '@/lib/intent-typed-data';
import { initialIntent, nextRecordedNonce } from '@/lib/intent-draft';
import { sectionSupply } from '@/lib/section-supply';
import { CONTRACTS } from '@/lib/config';
import { getIntentPool, getSeatCustody, getTicketsFor, ticketHolder } from '@/lib/chain-reads';
import { DEMO_SECTION_PRICES, demoPriceQuote } from '@/lib/demo-pricing';
import { selectedClass, sessionStart, sessionDeadline, formatEventTime, sessionLabel } from '@/lib/event-schedule';
import { CLOSED_SESSION_NOTE, MISSING_SCHEDULE_NOTE } from '@/lib/ui-copy';
import { FREE_TICKETS_LABEL, DEMO_PRICE_NOTE } from '@/lib/ui-copy';
import { formatUSDC, truncateAddress } from '@/lib/format';
import { DEMO_TICKET_NOTE } from '@/lib/ui-copy';
import { ADJACENCY_ACCEPTED, ADJACENCY_ERROR, ADJACENCY_NOTE, ALLOWANCE_NOTE, CONNECT_POSITIONS_NOTE, EMPTY_POSITIONS_NOTE, ESCROW_NOTE, OWN_POSITIONS_NOTE, PICK_OFFERED_NOTE, STEPS, WITHDRAWAL_DETAIL, intentReview, maskClasses } from '@/lib/ui-copy';
import { Minus, Plus, Clock, Check, ArrowRight } from 'lucide-react';

const same = (a: string, b: string | null) => a.toLowerCase() === b?.toLowerCase();
const hasClass = (mask: bigint, n: number) => (mask & (1n << BigInt(n))) !== 0n;
export default function IntentBuilder({ market, account, approved, busy, seatMapOpen, onSeatMapClose, onComplete, onApprove, onCustody, onDepositSelected, onSign, onDemo, onConnect, connectionError }: {
  market: MarketSnapshot; account: Address | null; approved: boolean; busy: boolean;
  seatMapOpen: boolean;
  onSeatMapClose: () => void;
  onComplete: () => void;
  onConnect: () => Promise<void>;
  connectionError: string | null;
  onApprove: () => Promise<void>;
  onDemo: () => Promise<void>;
  onCustody: (ticket: ChainTicket, mode: 'deposit' | 'withdraw') => Promise<void>;
  onDepositSelected: (tokenIds: bigint[]) => Promise<void>;
  onSign: (intent: IntentParams, prepared: (intent: IntentParams) => void, committed: (intent: IntentParams) => void) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => initialIntent(market, account));
  const [prepared, setPrepared] = useState<IntentParams | null>(null);
  const [committed, setCommitted] = useState<IntentParams | null>(null);
  const [step, setStep] = useState(1);
  const [reached, setReached] = useState(1);
  const [raw, setRaw] = useState(false);
  const stepTitles = useRef<(HTMLHeadingElement | null)[]>([]);
  const seatMapRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = seatMapRef.current;
    if (!seatMapOpen || !dialog) return;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [seatMapOpen]);
  const [selectionAccount, setSelectionAccount] = useState(account?.toLowerCase() ?? null);
  if (selectionAccount !== (account?.toLowerCase() ?? null)) {
    setSelectionAccount(account?.toLowerCase() ?? null);
    setDraft(previous => ({ ...previous, offered: [] }));
    setPrepared(null); setCommitted(null);
    setStep(previous => Math.min(previous, 2));
    setReached(previous => Math.min(previous, 2));
  }
  const savedIntent: IntentParams = prepared && same(prepared.owner, account) ? prepared : {
    ...draft, owner: account ?? draft.owner, nonce: nextRecordedNonce(market, account),
  };
  const update = (patch: Partial<IntentParams>) => {
    setPrepared(null); setCommitted(null); setDraft(i => ({ ...i, ...patch }));
    if (patch.offered?.length === 0) setReached(n => Math.min(n, 2));
    if (patch.sectionMask === 0n || patch.sessionMask === 0n) setReached(1);
  };
  const go = (next: number) => {
    setCommitted(null); setStep(next); setReached(n => Math.max(n, next));
    setTimeout(() => stepTitles.current[next - 1]?.focus({ preventScroll: true }), 0);
  };
  const complete = (confirmed: IntentParams) => {
    setCommitted(confirmed);
    setTimeout(() => stepTitles.current[1]?.focus({ preventScroll: true }), 0);
  };
  const completed = committed && same(committed.owner, account) ? committed : null;
  const positions = account ? getTicketsFor(account, market, savedIntent.eventId) : [];
  const baseIntent = { ...savedIntent, offered: savedIntent.offered.filter(id => positions.some(t => t.tokenId === String(id) && t.status !== 1)) };
  const allTickets = getTicketsFor(null, market, baseIntent.eventId);
  const quote = demoPriceQuote(baseIntent, allTickets);
  const intent: IntentParams = { ...baseIntent, maxNetPay: quote?.paymentAmount ?? 0n };
  const selectedPositions = positions.filter(t => intent.offered.includes(BigInt(t.tokenId)) && t.status !== 1);
  const toDeposit = selectedPositions.filter(t => t.depositor === '0x0000000000000000000000000000000000000000');
  const live = getIntentPool(market, intent.eventId);
  const sessions = [...new Set(allTickets.map(t => t.sessionId))].sort((a, b) => a - b);
  const sections = [...new Set([...Object.keys(DEMO_SECTION_PRICES).map(Number), ...allTickets.map(t => t.sectionId)])].sort((a, b) => a - b);
  const offered = allTickets.filter(t => (completed ?? intent).offered.includes(BigInt(t.tokenId)));
  const review = intentReview(intent, !account);
  const preview = intentTypedData(intent);
  const selectedSession = selectedClass(intent.sessionMask);
  const supply = sectionSupply(market, intent.eventId, selectedSession, CONTRACTS.escrow);
  const eventStart = selectedSession === null ? null : sessionStart(selectedSession);
  const cutoff = sessionDeadline(intent.sessionMask);
  const timingUnavailable = cutoff === null || cutoff <= BigInt(market.timestamp);
  const choiceInvalid = selectedClass(intent.sessionMask) === null || selectedClass(intent.sectionMask) === null;
  const summary = (n: number) => n === 2
    ? `${offered.map(t => `R${t.row} S${t.seat}`).join(', ')} · ${[...new Set(offered.map(t => t.sessionId))].map(sessionLabel).join(', ')}`
    : n === 1 ? `${intent.exactCount} ticket${intent.exactCount === 1 ? '' : 's'} · ${maskClasses(intent.sessionMask).map(sessionLabel).join(', ')} · ${maskClasses(intent.sectionMask).map(n => `CAT ${n}`).join(', ')}`
      : `event ${intent.eventId} · nonce ${intent.nonce}`;
  const position = (t: ChainTicket) => {
    const escrowed = t.depositor !== '0x0000000000000000000000000000000000000000';
    const committed = escrowed && live.some(i => same(i.owner, ticketHolder(t)) && i.offered.includes(t.tokenId));
    const isOffered = intent.offered.includes(BigInt(t.tokenId));
    return (
      <article key={t.tokenId} className={`position ${isOffered ? 'is-offered' : ''}`}>
        <div className="position-main">
          <label className="position-select">
            <input
              type="checkbox"
              aria-label={`Offer ticket ${t.tokenId}`}
              disabled={busy || t.status === 1}
              checked={isOffered}
              onChange={() =>
                update({
                  offered: isOffered
                    ? intent.offered.filter(id => id !== BigInt(t.tokenId))
                    : [...intent.offered, BigInt(t.tokenId)],
                })
              }
            />
            <span className="mono ticket-token-chip">#{t.tokenId}</span>
            <span className="ticket-session-chip">{sessionLabel(t.sessionId)}</span>
          </label>
          <div className="position-details">
            <p className="mono seat-coords">
              ROW <strong>{t.row}</strong> / SEAT <strong>{t.seat}</strong> / CAT <strong>{t.sectionId}</strong>
            </p>
            <p className="quiet mono holder-addr">{truncateAddress(ticketHolder(t))}</p>
            <p className="mono demo-price-ref">
              {DEMO_SECTION_PRICES[t.sectionId] === undefined
                ? 'Demo reference price unavailable'
                : `Demo reference: ${formatUSDC(DEMO_SECTION_PRICES[t.sectionId])} USDC / ticket`}
            </p>
          </div>
        </div>
        <div className="position-actions">
          <span className={`badge badge-${t.status === 1 ? 'used' : committed ? 'committed' : escrowed ? 'escrowed' : 'wallet'}`}>
            {t.status === 1 ? 'USED' : committed ? 'committed' : escrowed ? 'escrowed' : 'wallet'}
          </span>
          {t.status !== 1 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onCustody(t, escrowed ? 'withdraw' : 'deposit')}
            >
              {escrowed ? 'Withdraw' : 'Deposit'}
            </button>
          )}
        </div>
      </article>
    );
  };
  return (
    <div className="intent-flow">
      {/* Step Progress Tracker */}
      <div className="intent-step-tracker" role="navigation" aria-label="Step progress">
        {STEPS.map((stepTitle, idx) => {
          const sNum = idx + 1;
          const isCur = step === sNum && !completed;
          const isDone = sNum < step || (completed && sNum <= STEPS.length);
          const canGo = sNum <= reached && !busy;
          return (
            <div key={stepTitle} className="step-tracker-node">
              {idx > 0 && <span className="step-tracker-divider" aria-hidden="true" />}
              <button
                type="button"
                className={`step-tracker-item ${isCur ? 'active' : ''} ${isDone ? 'completed' : ''}`}
                disabled={!canGo}
                onClick={() => go(sNum)}
              >
                <span className="step-tracker-num">{isDone ? '✓' : sNum}</span>
                <span className="step-tracker-label">
                  <span className="step-tracker-sub">STEP 0{sNum}</span>
                  <span className="step-tracker-title">{stepTitle}</span>
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {step > 1 && !completed && (
        <button type="button" className="back-nav-btn" onClick={() => go(step - 1)}>
          ← Back to Preferences
        </button>
      )}

      {STEPS.map((title, index) => {
        const number = index + 1;
        const expanded = step === number && !completed;
        const visited = reached >= number;
        if (!expanded) return null;
        return (
          <section
            key={title}
            className={`workspace-panel intent-step ${expanded ? 'is-expanded' : visited ? 'is-complete' : 'is-future'}`}
            data-step={number}
            data-expanded={expanded}
          >
            <div className="step-heading">
              <div className="step-heading-main">
                <h2 ref={element => { stepTitles.current[index] = element; }} tabIndex={-1} id={`step-title-${number}`}>
                  {!expanded && (number < reached || completed) && <span className="step-check" aria-label="Completed">✓</span>}
                  {title}
                </h2>
                <p className="step-heading-sub">
                  {number === 1
                    ? 'Specify the exact outcome you will accept. All signed conditions are enforced on-chain before settlement.'
                    : 'Select tickets you currently hold to offer into the reshuffle pool.'}
                </p>
              </div>
              {expanded ? (
                <span className="mono step-marker">step {number} of {STEPS.length}</span>
              ) : (
                visited && (
                  <>
                    <span className="mono step-summary">{summary(number)}</span>
                    <button className="text-button" disabled={busy} onClick={() => go(number)} aria-label={`Change ${title}`}>
                      Change
                    </button>
                  </>
                )
              )}
            </div>

            {expanded && (
              <div className="step-content" aria-labelledby={`step-title-${number}`}>
                {number === 2 && (
                  <>
                    <p className="quiet">{account ? OWN_POSITIONS_NOTE : CONNECT_POSITIONS_NOTE}</p>
                    {!account && (
                      <button className="secondary connect-positions" disabled={busy} onClick={() => void onConnect()}>
                        Connect wallet to see my tickets
                      </button>
                    )}
                    {connectionError && <p role="alert">{connectionError}</p>}
                    <button className="secondary" disabled={busy} onClick={() => void onDemo()} aria-label={FREE_TICKETS_LABEL}>
                      {FREE_TICKETS_LABEL}
                    </button>
                    <p className="quiet">{DEMO_TICKET_NOTE}</p>
                    {account && !approved && positions.some(t => t.status !== 1 && same(t.owner, account) && t.depositor === '0x0000000000000000000000000000000000000000') && (
                      <button className="secondary" disabled={busy} onClick={() => void onApprove()}>
                        Approve tickets
                      </button>
                    )}
                    <div className="position-list">{positions.slice(0, 8).map(position)}</div>
                    {positions.length > 8 && (
                      <details className="more-tickets">
                        <summary className="mono">+{positions.length - 8} more</summary>
                        <div>{positions.slice(8).map(position)}</div>
                      </details>
                    )}
                    {account && !positions.length && <p role="status">{EMPTY_POSITIONS_NOTE}</p>}
                    {positions.length > 0 && (
                      <>
                        <div className="batch-deposit">
                          <button
                            className="secondary"
                            disabled={busy || !toDeposit.length}
                            onClick={() => void onDepositSelected(selectedPositions.map(t => BigInt(t.tokenId)))}
                          >
                            {selectedPositions.length && !toDeposit.length
                              ? 'Selected tickets deposited'
                              : toDeposit.length
                              ? `Deposit ${toDeposit.length} selected ticket${toDeposit.length === 1 ? '' : 's'}`
                              : 'Deposit selected tickets'}
                          </button>
                          <p className="quiet">
                            Select your tickets above, then deposit them together in one transaction. If approval is needed, confirm it first; the deposit follows automatically. Tickets already deposited are skipped.
                          </p>
                        </div>
                        <p className="quiet">{ESCROW_NOTE} {WITHDRAWAL_DETAIL} {PICK_OFFERED_NOTE}</p>
                        <div className="price-comparison">
                          <h3>Your swap payment</h3>
                          <p className="quiet">{DEMO_PRICE_NOTE}</p>
                          {quote ? (
                            <dl className="quote-lines mono" aria-live="polite">
                              <div>
                                <dt>Your selected tickets</dt>
                                <dd>{formatUSDC(quote.offeredTotal)} USDC</dd>
                              </div>
                              <div>
                                <dt>Wanted tickets</dt>
                                <dd>{formatUSDC(quote.wantedTotal)} USDC</dd>
                              </div>
                              <div className="quote-total">
                                <dt>{quote.paymentAmount > 0n ? 'Upgrade payment' : quote.paymentAmount < 0n ? 'Credit requested' : 'Payment difference'}</dt>
                                <dd>{formatUSDC(quote.paymentAmount < 0n ? -quote.paymentAmount : quote.paymentAmount)} USDC</dd>
                              </div>
                            </dl>
                          ) : (
                            <p className="quiet" role="status">
                              {intent.offered.length
                                ? 'A payment amount is unavailable for these tickets. Choose tickets and a wanted section with demo reference prices to continue.'
                                : 'Select your offered tickets to calculate the payment amount.'}
                            </p>
                          )}
                          {quote && (
                            <p className="quiet">
                              {quote.paymentAmount > 0n
                                ? 'Approve this amount and sign your intent. USDC is charged only when the whole swap succeeds; the final charge may be lower. Gas is separate.'
                                : quote.paymentAmount < 0n
                                ? 'No USDC payment approval is needed. Your intent requires at least this credit when the whole swap succeeds. Gas is separate.'
                                : 'No USDC payment approval is needed. Your intent allows no net charge for the swap. Gas is separate.'}
                            </p>
                          )}
                        </div>
                      </>
                    )}
                    <div className="inline-intent-review">
                      <h3>{quote && quote.paymentAmount > 0n ? 'Approve payment and create intent' : 'Review and create intent'}</h3>
                      {timingUnavailable && <p role="alert">{cutoff === null ? MISSING_SCHEDULE_NOTE : CLOSED_SESSION_NOTE}</p>}
                      {intent.offered.length > 0 && (
                        <>
                          <div className="signed-sentence">
                            <p>{review.sentence}</p>
                            <p className="quiet mono">{review.metadata}</p>
                          </div>
                          <button className="text-button" onClick={() => setRaw(!raw)} aria-expanded={raw}>
                            View signed struct {raw ? '−' : '+'}
                          </button>
                          {raw && (
                            <pre className="raw-struct">
                              {jsonNumbers(account ? preview : { ...preview, message: { ...preview.message, owner: 'Wallet selected at signing', nonce: 'Read after connection' } })}
                            </pre>
                          )}
                        </>
                      )}
                      {!intent.offered.length && <p className="quiet">Select the tickets you want to offer above to review your request.</p>}
                      {toDeposit.length > 0 && <p className="quiet">Deposit your selected tickets above before signing.</p>}
                      <button
                        className="primary full sign-intent"
                        disabled={busy || !account || !quote || !intent.offered.length || toDeposit.length > 0 || choiceInvalid || timingUnavailable}
                        onClick={() => void onSign(intent, setPrepared, confirmed => { complete(confirmed); onComplete(); })}
                      >
                        {quote && quote.paymentAmount > 0n ? `Approve ${formatUSDC(quote.paymentAmount)} USDC & create intent` : 'Create intent'} <span>↗</span>
                      </button>
                      {quote && quote.paymentAmount > 0n && <p className="quiet">{ALLOWANCE_NOTE}</p>}
                    </div>
                  </>
                )}

                {number === 1 && (
                  <div className="builder">
                    {/* Condition 1: How many tickets */}
                    <div className="condition-row">
                      <div className="condition-meta">
                        <label id="count-label" className="condition-title">How many tickets</label>
                        <span className="condition-desc">Exact ticket count you will receive. Settlement requires an exact match.</span>
                      </div>
                      <div className="condition-control">
                        <div className="stepper-pill" role="group" aria-labelledby="count-label">
                          <button
                            type="button"
                            className="stepper-btn"
                            disabled={intent.exactCount <= 1}
                            onClick={() => update({ exactCount: intent.exactCount - 1, ...(intent.exactCount === 2 ? { mustBeAdjacent: false } : {}) })}
                            aria-label="Decrease ticket count"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <div className="stepper-value">
                            <output className="mono stepper-number" aria-live="polite">{intent.exactCount}</output>
                          </div>
                          <button
                            type="button"
                            className="stepper-btn"
                            disabled={intent.exactCount >= 4}
                            onClick={() => update({ exactCount: intent.exactCount + 1, ...(intent.exactCount === 1 ? { mustBeAdjacent: true } : {}) })}
                            aria-label="Increase ticket count"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Condition 2: Session */}
                    <div className="condition-row">
                      <div className="condition-meta">
                        <span id="sessions-label" className="condition-title">Session</span>
                        <span className="condition-desc">Choose the event session you want to attend.</span>
                      </div>
                      <div className="condition-control">
                        <div className="session-grid" role="radiogroup" aria-labelledby="sessions-label">
                          {sessions.map(n => {
                            const isSelected = hasClass(intent.sessionMask, n);
                            const start = sessionStart(n);
                            return (
                              <label
                                key={n}
                                className={`session-card ${isSelected ? 'is-selected' : ''}`}
                                data-selected={isSelected}
                              >
                                <input
                                  type="radio"
                                  name="wanted-session"
                                  value={n}
                                  checked={isSelected}
                                  onChange={() => update({ sessionMask: 1n << BigInt(n), deadline: sessionDeadline(1n << BigInt(n)) ?? 0n })}
                                  className="sr-only"
                                />
                                <div className="card-top">
                                  <span className="session-day">{sessionLabel(n)}</span>
                                  <div className={`radio-dot ${isSelected ? 'active' : ''}`} aria-hidden="true">
                                    {isSelected && <span className="dot-inner" />}
                                  </div>
                                </div>
                                {start !== null && (
                                  <div className="session-time mono">{formatEventTime(start)}</div>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Condition 3: Category */}
                    <div className="condition-row">
                      <div className="condition-meta">
                        <span id="sections-label" className="condition-title">Category</span>
                        <span className="condition-desc">Target seating tier and current swap inventory in pool.</span>
                      </div>
                      <div className="condition-control">
                        <div className="category-grid" role="radiogroup" aria-labelledby="sections-label">
                          {sections.map(n => {
                            const isSelected = hasClass(intent.sectionMask, n);
                            const counts = supply.get(n) ?? { issued: 0, deposited: 0, offered: 0 };
                            return (
                              <label
                                key={n}
                                className={`category-card ${isSelected ? 'is-selected' : ''}`}
                                data-selected={isSelected}
                              >
                                <input
                                  type="radio"
                                  name="wanted-section"
                                  value={n}
                                  checked={isSelected}
                                  onChange={() => update({ sectionMask: 1n << BigInt(n) })}
                                  className="sr-only"
                                />
                                <div className="card-top">
                                  <span className="cat-title">CAT {n}</span>
                                  <div className={`radio-dot ${isSelected ? 'active' : ''}`} aria-hidden="true">
                                    {isSelected && <span className="dot-inner" />}
                                  </div>
                                </div>
                                {DEMO_SECTION_PRICES[n] !== undefined && (
                                  <div className="cat-price mono">
                                    {formatUSDC(DEMO_SECTION_PRICES[n])} USDC
                                  </div>
                                )}
                                <div className="cat-pool mono">
                                  {counts.offered} in pool
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Condition 4: Consecutive Seating */}
                    <div className="condition-row">
                      <div className="condition-meta">
                        <label htmlFor="adjacent-seats" className="condition-title">Consecutive Seating</label>
                        <span className="condition-desc">Require tickets to be strictly contiguous within the same row, section, and session.</span>
                      </div>
                      <div className="condition-control">
                        <div className="adjacency-wrapper">
                          <div className="toggle-row">
                            <label htmlFor="adjacent-seats" className="toggle-label-wrap">
                              <div className="switch-control">
                                <input
                                  id="adjacent-seats"
                                  type="checkbox"
                                  checked={intent.mustBeAdjacent}
                                  onChange={e => update({ mustBeAdjacent: e.target.checked, ...(e.target.checked && intent.exactCount < 2 ? { exactCount: 2 } : {}) })}
                                  className="switch-input"
                                />
                                <span className="switch-slider" />
                              </div>
                              <span className="switch-text">Seats must be next to each other</span>
                            </label>
                            {intent.mustBeAdjacent && (
                              <span className="adjacency-active-badge">
                                <span aria-hidden="true">✓</span> Enforced by Settlement contract
                              </span>
                            )}
                          </div>

                          {intent.mustBeAdjacent && (
                            <div className="adjacency-showcase" role="img" aria-label={`${ADJACENCY_ACCEPTED}: 3, 4. ${ADJACENCY_ERROR}: 3, 5.`}>
                              <div className="showcase-header">
                                <span className="showcase-title">ON-CHAIN ADJACENCY VERIFICATION</span>
                                <span className="showcase-note">Same session, section, row, and consecutive seat numbers</span>
                              </div>
                              <div className="showcase-scenarios">
                                <div className="scenario-card is-valid">
                                  <div className="scenario-badge valid-badge">
                                    <span className="badge-icon">✓</span> {ADJACENCY_ACCEPTED}
                                  </div>
                                  <div className="seat-row-visual" aria-hidden="true">
                                    {[1, 2, 3, 4, 5, 6].map(seatNum => {
                                      const isTarget = seatNum === 3 || seatNum === 4;
                                      return (
                                        <div key={seatNum} className={`mini-seat ${isTarget ? 'seat-accepted' : ''}`}>
                                          <span className="mini-seat-back" />
                                          <span className="mini-seat-cushion">{seatNum}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                  <div className="scenario-explanation">
                                    Seats 3 &amp; 4 are consecutive in Row 1 · Valid swap proposal
                                  </div>
                                </div>

                                <div className="scenario-card is-invalid">
                                  <div className="scenario-badge invalid-badge">
                                    <span className="badge-icon">×</span> {ADJACENCY_ERROR}
                                  </div>
                                  <div className="seat-row-visual" aria-hidden="true">
                                    {[1, 2, 3, 4, 5, 6].map(seatNum => {
                                      const isTarget = seatNum === 3 || seatNum === 5;
                                      return (
                                        <div key={seatNum} className={`mini-seat ${isTarget ? 'seat-rejected' : ''}`}>
                                          <span className="mini-seat-back" />
                                          <span className="mini-seat-cushion">{seatNum}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                  <div className="scenario-explanation">
                                    Seats 3 &amp; 5 have a gap · Reverted unconditionally
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Condition 5: Valid until */}
                    <div className="condition-row">
                      <div className="condition-meta">
                        <span id="valid-until-label" className="condition-title">Settlement Window</span>
                        <span className="condition-desc">Automatic expiry protection for your signed commitment.</span>
                      </div>
                      <div className="condition-control">
                        <div className="validity-banner">
                          <div className="validity-icon-wrap">
                            <Clock className="w-5 h-5 text-amber-400" />
                          </div>
                          <div className="validity-content">
                            <p id="valid-until" className="validity-headline" aria-labelledby="valid-until-label">
                              8 hours before the event starts.
                            </p>
                            {cutoff !== null && eventStart !== null ? (
                              <>
                                <p className="validity-sub">
                                  Event starts: <time className="mono" dateTime={new Date(Number(eventStart) * 1000).toISOString()}>{formatEventTime(eventStart)}</time>
                                </p>
                                {timingUnavailable && <p className="validity-alert" role="alert">{CLOSED_SESSION_NOTE}</p>}
                              </>
                            ) : (
                              <p className="validity-alert" role="alert">{MISSING_SCHEDULE_NOTE}</p>
                            )}
                            <p className="validity-footnote">
                              If unmatched at cutoff, intent expires automatically on-chain.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Action Footer */}
                    <div className="intent-step-actions">
                      <button
                        type="button"
                        className="primary step-continue"
                        disabled={choiceInvalid || timingUnavailable}
                        onClick={() => go(2)}
                      >
                        <span>Continue to Tickets</span>
                        <ArrowRight className="w-4 h-4 btn-icon" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    <dialog ref={seatMapRef} className="intent-pool-dialog seat-map-dialog" aria-labelledby="seat-map-title" onClose={onSeatMapClose} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
    }}>
      <div className="panel-heading"><h2 id="seat-map-title">Seat Map</h2><button className="secondary" onClick={() => seatMapRef.current?.close()} aria-label="Close seat map">Close ×</button></div>
      <div className="seat-map-content">
      {maskClasses(intent.sessionMask).flatMap(session => maskClasses(intent.sectionMask).map(section => {
        const visible = getSeatCustody(session, section, market, intent.eventId);
        const rows = [...new Set(visible.map(t => t.row))].sort((a, b) => a - b);
        return <section key={`${session}:${section}`}><h3 className="mono">{sessionLabel(session)} / CAT {section}</h3><div className="stage mono">STAGE</div><div className="seat-grid">
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
      </div>
    </dialog>
  </div>
  );
}
