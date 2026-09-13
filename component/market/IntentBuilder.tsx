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
import { Minus, Plus, ArrowRight } from 'lucide-react';

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
  const [seatMapSession, setSeatMapSession] = useState<number | null>(null);
  const [seatMapSection, setSeatMapSection] = useState<number | null>(null);
  const [hoveredSeat, setHoveredSeat] = useState<{
    row: number;
    displayRow: number | string;
    seat: number;
    section: number;
    session: number;
    ticket?: ChainTicket;
    status: 'available' | 'yours' | 'other' | 'unissued' | 'used';
  } | null>(null);
  useEffect(() => {
    const dialog = seatMapRef.current;
    if (!seatMapOpen || !dialog) return;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    setHoveredSeat(null);
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
    ? (offered.length
        ? `${offered.map(t => `R${t.row} S${t.seat}`).join(', ')} · ${[...new Set(offered.map(t => t.sessionId))].map(sessionLabel).join(', ')}`
        : 'No tickets offered')
    : n === 1
      ? `${intent.exactCount} ticket${intent.exactCount === 1 ? '' : 's'} · ${maskClasses(intent.sessionMask).map(sessionLabel).join(', ')} · ${maskClasses(intent.sectionMask).map(n => `CAT ${n}`).join(', ')}`
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
            <div className="position-chips-group">
              <span className="mono ticket-token-chip">#{t.tokenId}</span>
              <span className="ticket-session-chip">{sessionLabel(t.sessionId)}</span>
              <span className="ticket-cat-chip">CAT {t.sectionId}</span>
            </div>
          </label>
          <div className="position-details">
            <p className="mono seat-coords">
              ROW <strong>{t.row}</strong> / SEAT <strong>{t.seat}</strong> / CAT <strong>{t.sectionId}</strong>
            </p>
            <div className="position-meta-row">
              <span className="quiet mono holder-addr">{truncateAddress(ticketHolder(t))}</span>
              <span className="position-bullet" aria-hidden="true">•</span>
              <span className="mono demo-price-ref">
                {DEMO_SECTION_PRICES[t.sectionId] === undefined
                  ? 'Demo reference price unavailable'
                  : `Demo reference: ${formatUSDC(DEMO_SECTION_PRICES[t.sectionId])} USDC / ticket`}
              </span>
            </div>
          </div>
        </div>
        <div className="position-actions">
          <span className={`badge badge-${t.status === 1 ? 'used' : committed ? 'committed' : escrowed ? 'escrowed' : 'wallet'}`}>
            <span className="badge-dot" aria-hidden="true" />
            {t.status === 1 ? 'USED' : committed ? 'committed' : escrowed ? 'escrowed' : 'wallet'}
          </span>
          {t.status !== 1 && (
            <button
              type="button"
              className="position-custody-btn"
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
                {expanded && (
                  <p className="step-heading-sub">
                    {number === 1
                      ? 'Specify the exact outcome you will accept. All signed conditions are enforced on-chain before settlement.'
                      : 'Select tickets you currently hold to offer into the reshuffle pool.'}
                  </p>
                )}
              </div>
              {expanded ? (
                <span className="mono step-marker">step {number} of {STEPS.length}</span>
              ) : visited ? (
                <div className="step-collapsed-summary">
                  <span className="mono step-summary">{summary(number)}</span>
                  <button
                    className="text-button step-change-btn"
                    disabled={busy}
                    onClick={() => go(number)}
                    aria-label={`Change ${title === 'Ticket Preferences' ? 'What would you like instead?' : title}`}
                  >
                    Change
                  </button>
                </div>
              ) : null}
            </div>

            {expanded && (
              <div className="step-content" aria-labelledby={`step-title-${number}`}>
                {number === 2 && (
                  <>
                    <div className="inventory-header-panel">
                      <div className="inventory-status-row">
                        <div className="inventory-status-pill">
                          <span className={`inventory-status-dot ${account ? 'connected' : 'disconnected'}`} aria-hidden="true" />
                          <span className="mono">{account ? truncateAddress(account) : 'Disconnected'}</span>
                        </div>
                        {account && (
                          <span className="inventory-ticket-count mono">
                            {positions.length} ticket{positions.length === 1 ? '' : 's'} available
                          </span>
                        )}
                      </div>
                      <p className="quiet inventory-context-note">{account ? OWN_POSITIONS_NOTE : CONNECT_POSITIONS_NOTE}</p>
                    </div>

                    {!account && (
                      <div className="wallet-connect-card">
                        <div className="wallet-connect-info">
                          <div className="wallet-connect-icon" aria-hidden="true">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                              <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                              <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
                            </svg>
                          </div>
                          <div>
                            <h4 className="wallet-connect-title">Connect Wallet</h4>
                            <p className="quiet wallet-connect-desc">Connect your Web3 wallet to load your held and escrowed tickets for this event.</p>
                          </div>
                        </div>
                        <button className="secondary connect-positions" disabled={busy} onClick={() => void onConnect()}>
                          Connect wallet to see my tickets
                        </button>
                      </div>
                    )}

                    {connectionError && <p role="alert" className="connection-error-box">{connectionError}</p>}

                    <div className="demo-faucet-card">
                      <div className="demo-faucet-body">
                        <div className="demo-faucet-badge-row">
                          <span className="demo-badge">ARC TESTNET DEMO</span>
                          <span className="demo-sub-tag">Free Mint Voucher</span>
                        </div>
                        <div className="demo-faucet-text">
                          <h4 className="demo-faucet-title">Need tickets to test reshuffling?</h4>
                          <p className="quiet demo-faucet-desc">{DEMO_TICKET_NOTE}</p>
                        </div>
                      </div>
                      <button
                        className="secondary demo-faucet-btn"
                        disabled={busy}
                        onClick={() => void onDemo()}
                        aria-label={FREE_TICKETS_LABEL}
                      >
                        {FREE_TICKETS_LABEL}
                      </button>
                    </div>

                    {account && !approved && positions.some(t => t.status !== 1 && same(t.owner, account) && t.depositor === '0x0000000000000000000000000000000000000000') && (
                      <div className="approval-notice-card">
                        <div className="approval-notice-text">
                          <h4>NFT Transfer Approval Required</h4>
                          <p className="quiet">Grant permission for the Escrow contract to deposit your event tickets.</p>
                        </div>
                        <button className="secondary" disabled={busy} onClick={() => void onApprove()}>
                          Approve tickets
                        </button>
                      </div>
                    )}

                    <div className="position-list">{positions.slice(0, 8).map(position)}</div>
                    {positions.length > 8 && (
                      <details className="more-tickets">
                        <summary className="mono">+{positions.length - 8} more</summary>
                        <div>{positions.slice(8).map(position)}</div>
                      </details>
                    )}

                    {account && !positions.length && (
                      <div className="empty-positions-card">
                        <h4 className="empty-positions-title">No tickets held in this wallet</h4>
                        <p role="status" className="empty-positions-text">{EMPTY_POSITIONS_NOTE}</p>
                      </div>
                    )}

                    {positions.length > 0 && (
                      <>
                        <div className="batch-deposit">
                          <div className="batch-deposit-header">
                            <div className="batch-deposit-text">
                              <h4 className="batch-deposit-title">Escrow Deposit Required</h4>
                              <p className="quiet">
                                Select your tickets above, then deposit them together in one transaction. If approval is needed, confirm it first; the deposit follows automatically. Tickets already deposited are skipped.
                              </p>
                            </div>
                          </div>
                          <button
                            className="secondary batch-deposit-btn"
                            disabled={busy || !toDeposit.length}
                            onClick={() => void onDepositSelected(selectedPositions.map(t => BigInt(t.tokenId)))}
                          >
                            {selectedPositions.length && !toDeposit.length
                              ? 'Selected tickets deposited'
                              : toDeposit.length
                              ? `Deposit ${toDeposit.length} selected ticket${toDeposit.length === 1 ? '' : 's'}`
                              : 'Deposit selected tickets'}
                          </button>
                        </div>
                        <p className="quiet escrow-guarantee-note">{ESCROW_NOTE} {WITHDRAWAL_DETAIL} {PICK_OFFERED_NOTE}</p>
                        <div className="price-comparison">
                          <div className="price-comparison-header">
                            <span className="price-calc-badge">FINANCIAL SETTLEMENT</span>
                            <h3>Your swap payment</h3>
                            <p className="quiet price-calc-sub">{DEMO_PRICE_NOTE}</p>
                          </div>
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
                            <div className="quote-empty-box">
                              <p className="quiet" role="status">
                                {intent.offered.length
                                  ? 'A payment amount is unavailable for these tickets. Choose tickets and a wanted section with demo reference prices to continue.'
                                  : 'Select your offered tickets to calculate the payment amount.'}
                              </p>
                            </div>
                          )}
                          {quote && (
                            <div className="quote-footnote-box">
                              <p className="quiet">
                                {quote.paymentAmount > 0n
                                  ? 'Approve this amount and sign your intent. USDC is charged only when the whole swap succeeds; the final charge may be lower. Gas is separate.'
                                  : quote.paymentAmount < 0n
                                  ? 'No USDC payment approval is needed. Your intent requires at least this credit when the whole swap succeeds. Gas is separate.'
                                  : 'No USDC payment approval is needed. Your intent allows no net charge for the swap. Gas is separate.'}
                              </p>
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    <div className="inline-intent-review">
                      <div className="review-section-header">
                        <span className="review-badge">EIP-712 INTENT REVIEW</span>
                        <h3>{quote && quote.paymentAmount > 0n ? 'Approve payment and create intent' : 'Review and create intent'}</h3>
                      </div>
                      {timingUnavailable && <p role="alert" className="timing-alert-box">{cutoff === null ? MISSING_SCHEDULE_NOTE : CLOSED_SESSION_NOTE}</p>}
                      {intent.offered.length > 0 && (
                        <div className="review-active-card">
                          <div className="signed-sentence">
                            <div className="signed-sentence-tag">
                              <span>Signed Outcome Commitment</span>
                            </div>
                            <p className="signed-sentence-text">{review.sentence}</p>
                            <p className="quiet mono signed-metadata">{review.metadata}</p>
                          </div>
                          <div className="raw-struct-container">
                            <button type="button" className="text-button raw-struct-toggle" onClick={() => setRaw(!raw)} aria-expanded={raw}>
                              View signed struct {raw ? '−' : '+'}
                            </button>
                            {raw && (
                              <pre className="raw-struct">
                                {jsonNumbers(account ? preview : { ...preview, message: { ...preview.message, owner: 'Wallet selected at signing', nonce: 'Read after connection' } })}
                              </pre>
                            )}
                          </div>
                        </div>
                      )}
                      {!intent.offered.length && (
                        <div className="review-pending-placeholder">
                          <p className="quiet">Select the tickets you want to offer above to review your request.</p>
                        </div>
                      )}
                      {toDeposit.length > 0 && (
                        <div className="deposit-required-banner">
                          <p className="quiet">Deposit your selected tickets above before signing.</p>
                        </div>
                      )}
                      <button
                        className="primary full sign-intent"
                        disabled={busy || !account || !quote || !intent.offered.length || toDeposit.length > 0 || choiceInvalid || timingUnavailable}
                        onClick={() => void onSign(intent, setPrepared, confirmed => { complete(confirmed); onComplete(); })}
                      >
                        <span>{quote && quote.paymentAmount > 0n ? `Approve ${formatUSDC(quote.paymentAmount)} USDC & create intent` : 'Create intent'}</span>
                        <span className="btn-arrow" aria-hidden="true">↗</span>
                      </button>
                      {quote && quote.paymentAmount > 0n && <p className="quiet allowance-footnote">{ALLOWANCE_NOTE}</p>}
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
                            <div className="adjacency-showcase adjacency-illustration" role="img" aria-label={`${ADJACENCY_ACCEPTED}: 3, 4. ${ADJACENCY_ERROR}: 3, 5.`}>
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
                                        <div key={seatNum} className={`mini-seat illustration-seat ${isTarget ? 'seat-accepted' : ''}`}>
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
                                        <div key={seatNum} className={`mini-seat illustration-seat ${isTarget ? 'seat-rejected' : ''}`}>
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
                        <div className="validity-card">
                          <p id="valid-until" className="validity-headline" aria-labelledby="valid-until-label">
                            8 hours before the event starts.
                          </p>
                          {cutoff !== null && eventStart !== null ? (
                            <>
                              <p className="validity-time mono">
                                Event starts: <time dateTime={new Date(Number(eventStart) * 1000).toISOString()}>{formatEventTime(eventStart)}</time>
                              </p>
                              {timingUnavailable && <p className="validity-alert mono" role="alert">{CLOSED_SESSION_NOTE}</p>}
                            </>
                          ) : (
                            <p className="validity-alert mono" role="alert">{MISSING_SCHEDULE_NOTE}</p>
                          )}
                          <p className="validity-note mono">
                            If unmatched at cutoff, intent expires automatically on-chain.
                          </p>
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
    <dialog
      ref={seatMapRef}
      className="intent-pool-dialog seat-map-dialog seat-map"
      aria-labelledby="seat-map-title"
      aria-describedby="seat-map-description"
      onClose={onSeatMapClose}
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
      <summary className="sr-only" aria-hidden="true" onClick={() => seatMapRef.current?.showModal?.()}>
        Seat Map
      </summary>
      <div className="pool-dialog-inner seat-map-inner">
        <header className="pool-dialog-header seat-map-header">
          <div className="pool-header-top">
            <div className="pool-header-title-group">
              <h2 id="seat-map-title">Stadium Seat Map</h2>
              <span className="pool-count-badge mono">
                Grandstand Custody Grid
              </span>
            </div>
            <button
              type="button"
              className="secondary pool-close-btn"
              onClick={() => seatMapRef.current?.close()}
              aria-label="Close seat map"
            >
              Close ×
            </button>
          </div>
          <p id="seat-map-description" className="pool-dialog-desc quiet">
            Live on-chain stadium grandstand custody and escrow status per night and category tier. Seats in escrow are available for immediate atomic reshuffling.
          </p>

          <div className="stadium-filter-bar">
            <div className="stadium-filter-group">
              <span className="stadium-filter-label">Session:</span>
              <div className="stadium-filter-pills" role="tablist" aria-label="Stadium Session Filter">
                <button
                  type="button"
                  role="tab"
                  aria-selected={seatMapSession === null}
                  className={`stadium-filter-pill ${seatMapSession === null ? 'is-active' : ''}`}
                  onClick={() => setSeatMapSession(null)}
                >
                  Wishlist ({maskClasses(intent.sessionMask).map(sessionLabel).join(', ')})
                </button>
                {sessions.map(s => (
                  <button
                    key={s}
                    type="button"
                    role="tab"
                    aria-selected={seatMapSession === s}
                    className={`stadium-filter-pill ${seatMapSession === s ? 'is-active' : ''}`}
                    onClick={() => setSeatMapSession(s)}
                  >
                    {sessionLabel(s)}
                  </button>
                ))}
              </div>
            </div>

            <div className="stadium-filter-group">
              <span className="stadium-filter-label">Grandstand Tier:</span>
              <div className="stadium-filter-pills" role="tablist" aria-label="Grandstand Tier Filter">
                <button
                  type="button"
                  role="tab"
                  aria-selected={seatMapSection === null}
                  className={`stadium-filter-pill ${seatMapSection === null ? 'is-active' : ''}`}
                  onClick={() => setSeatMapSection(null)}
                >
                  Wishlist ({maskClasses(intent.sectionMask).map(n => `CAT ${n}`).join(', ')})
                </button>
                {sections.map(sec => (
                  <button
                    key={sec}
                    type="button"
                    role="tab"
                    aria-selected={seatMapSection === sec}
                    className={`stadium-filter-pill ${seatMapSection === sec ? 'is-active' : ''}`}
                    onClick={() => setSeatMapSection(sec)}
                  >
                    CAT {sec}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </header>

        <div className="seat-map-content">
          {(seatMapSession !== null ? [seatMapSession] : maskClasses(intent.sessionMask)).flatMap(session =>
            (seatMapSection !== null ? [seatMapSection] : maskClasses(intent.sectionMask)).map(section => {
              const visible = getSeatCustody(session, section, market, intent.eventId);
              const rows = [...new Set(visible.map(t => t.row))].sort((a, b) => a - b);
              const totalTickets = visible.length;
              const inEscrow = visible.filter(t => t.depositor !== '0x0000000000000000000000000000000000000000' && t.status !== 1).length;

              return (
                <section key={`${session}:${section}`} className="seat-section-block">
                  <div className="seat-section-header">
                    <h3 className="mono seat-section-heading">
                      {sessionLabel(session)} / CAT {section}
                    </h3>
                    <div className="seat-section-meta mono">
                      <span className="meta-badge escrow-meta">{inEscrow} in escrow</span>
                      <span className="meta-sep">·</span>
                      <span className="meta-badge">{totalTickets} minted</span>
                      {DEMO_SECTION_PRICES[section] !== undefined && (
                        <>
                          <span className="meta-sep">·</span>
                          <span className="meta-badge price-meta">{formatUSDC(DEMO_SECTION_PRICES[section])} USDC</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="stage-wrapper stadium-pitch-wrapper" aria-hidden="true">
                    <div className="stage-glow" />
                    <div className="stage stadium-pitch mono">
                      <div className="pitch-center-circle" />
                      <div className="stage-platform">
                        <span className="stage-label">MAIN STAGE / PITCH</span>
                        <span className="stage-sub">▲ FACING FIELD &amp; PERFORMANCE AREA ▲</span>
                      </div>
                    </div>
                  </div>

                  <div className="seat-grid-container">
                    <div className="seat-grid">
                      {rows.length === 0 ? (
                        <div className="empty-section-grid">
                          <div className="empty-section-badge mono">No tickets minted in CAT {section} yet · Showing Grandstand Riser Layout</div>
                          {[1, 2, 3].map(fakeRow => (
                            <div className="seat-row empty-row" key={fakeRow}>
                              <span className="mono row-label">R{fakeRow}</span>
                              <div className="seat-cells">
                                {Array.from({ length: 12 }, (_, n) => n + 1).map(seat => (
                                  <div key={seat} className="seat-cell">
                                    <span
                                      className="seat unissued"
                                      onMouseEnter={() => setHoveredSeat({ row: fakeRow, displayRow: fakeRow, seat, section, session, status: 'unissued' })}
                                      onMouseLeave={() => setHoveredSeat(null)}
                                      title={`Row ${fakeRow}, Seat ${seat} · Unissued coordinate`}
                                    >
                                      <span className="seat-back" />
                                      <span className="seat-cushion">{seat}</span>
                                    </span>
                                  </div>
                                ))}
                              </div>
                              <span className="mono row-label row-label-end" aria-hidden="true">R{fakeRow}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        rows.map(row => {
                          const displayRow = row > 1000 ? (row % 100) : row;
                          const windows = [
                            ...new Set(
                              visible
                                .filter(t => t.row === row)
                                .map(t => Math.floor(Math.max(0, t.seat - 1) / 12) * 12)
                            ),
                          ].sort((a, b) => a - b);

                          return windows.map(start => (
                            <div className="seat-row" key={`${row}:${start}`}>
                              <span className="mono row-label" title={`Contract Row ${row}`}>R{displayRow}</span>
                              <div className="seat-cells">
                                {Array.from({ length: 12 }, (_, n) => start + n + 1).map(seat => {
                                  const at = visible.filter(t => t.row === row && t.seat === seat);
                                  return (
                                    <div key={seat} className="seat-cell">
                                      {at.length ? (
                                        at.map(t => {
                                          const isYours = same(ticketHolder(t), account);
                                          const isEscrowed = t.depositor !== '0x0000000000000000000000000000000000000000';
                                          const isUsed = t.status === 1;
                                          const statusClass = isYours ? 'yours' : isEscrowed ? 'available' : 'other';
                                          return (
                                            <span
                                              key={t.tokenId}
                                              className={`seat ${statusClass} ${isUsed ? 'used' : ''}`}
                                              onMouseEnter={() => setHoveredSeat({ row, displayRow, seat, section, session, ticket: t, status: statusClass })}
                                              onMouseLeave={() => setHoveredSeat(null)}
                                              title={`Ticket #${t.tokenId} · Row ${displayRow} (Contract Row ${row}), Seat ${seat} · ${ticketHolder(t)}${isUsed ? ' · USED' : ''}`}
                                            >
                                              <span className="seat-back" />
                                              <span className="seat-cushion">{seat}{isUsed ? '×' : ''}</span>
                                            </span>
                                          );
                                        })
                                      ) : (
                                        <span
                                          className="seat unissued"
                                          onMouseEnter={() => setHoveredSeat({ row, displayRow, seat, section, session, status: 'unissued' })}
                                          onMouseLeave={() => setHoveredSeat(null)}
                                          title={`Row ${displayRow}, Seat ${seat} · Unissued coordinate`}
                                        >
                                          <span className="seat-back" />
                                          <span className="seat-cushion">·</span>
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              <span className="mono row-label row-label-end" aria-hidden="true">R{displayRow}</span>
                            </div>
                          ));
                        })
                      )}
                    </div>
                  </div>
                </section>
              );
            })
          )}

          {/* Live Stadium Seat Inspector */}
          <div className="stadium-inspector-card" aria-live="polite">
            {hoveredSeat ? (
              <div className="inspector-active">
                <div className="inspector-seat-badge">
                  <span className="inspector-row-col mono">ROW {hoveredSeat.displayRow} · SEAT {hoveredSeat.seat}</span>
                  <span className={`inspector-status-badge is-${hoveredSeat.status}`}>
                    {hoveredSeat.status === 'available' && '● In Escrow (Available for Swap)'}
                    {hoveredSeat.status === 'yours' && '● In Your Connected Wallet'}
                    {hoveredSeat.status === 'other' && '● Held in Private Wallet'}
                    {hoveredSeat.status === 'unissued' && '○ Unissued Slot'}
                    {hoveredSeat.status === 'used' && '✕ Redeemed / USED'}
                  </span>
                </div>
                <div className="inspector-details-row">
                  <span className="inspector-detail"><strong>Tier:</strong> CAT {hoveredSeat.section}</span>
                  <span className="inspector-sep">·</span>
                  <span className="inspector-detail"><strong>Night:</strong> {sessionLabel(hoveredSeat.session)}</span>
                  {hoveredSeat.ticket ? (
                    <>
                      <span className="inspector-sep">·</span>
                      <span className="inspector-detail"><strong>Token ID:</strong> #{hoveredSeat.ticket.tokenId.toString()}</span>
                      <span className="inspector-sep">·</span>
                      <span className="inspector-detail"><strong>Holder:</strong> {truncateAddress(ticketHolder(hoveredSeat.ticket))}</span>
                      <span className="inspector-sep">·</span>
                      <span className="inspector-detail"><strong>Custody:</strong> {hoveredSeat.ticket.depositor !== '0x0000000000000000000000000000000000000000' ? 'In Escrow Contract' : 'In Private Wallet'}</span>
                      {DEMO_SECTION_PRICES[hoveredSeat.section] !== undefined && (
                        <>
                          <span className="inspector-sep">·</span>
                          <span className="inspector-detail"><strong>Price:</strong> {formatUSDC(DEMO_SECTION_PRICES[hoveredSeat.section])} USDC</span>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="inspector-sep">·</span>
                      <span className="inspector-detail muted">Position in grandstand template; no on-chain NFT issued yet.</span>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="inspector-placeholder">
                <span className="inspector-hint-icon">ⓘ</span>
                <span>Hover over any stadium seat in the grandstand to inspect on-chain token ID, holder address, and escrow custody status.</span>
              </div>
            )}
          </div>

          <div className="seat-legend">
            <div className="legend-item">
              <span className="legend-swatch swatch-available">
                <span className="swatch-back" />
                <span className="swatch-cushion" />
              </span>
              <span className="legend-text">Escrowed (Available)</span>
            </div>
            <div className="legend-item">
              <span className="legend-swatch swatch-yours">
                <span className="swatch-back" />
                <span className="swatch-cushion" />
              </span>
              <span className="legend-text">Held by you</span>
            </div>
            <div className="legend-item">
              <span className="legend-swatch swatch-other">
                <span className="swatch-back" />
                <span className="swatch-cushion" />
              </span>
              <span className="legend-text">Other wallet</span>
            </div>
            <div className="legend-item">
              <span className="legend-swatch swatch-unissued">
                <span className="swatch-back" />
                <span className="swatch-cushion" />
              </span>
              <span className="legend-text">Unissued</span>
            </div>
            <div className="legend-item">
              <span className="legend-swatch swatch-used">
                <span className="swatch-back" />
                <span className="swatch-cushion">×</span>
              </span>
              <span className="legend-text">USED</span>
            </div>
          </div>

          <p className="seat-map-note quiet">{ADJACENCY_NOTE}</p>
        </div>
      </div>
    </dialog>
  </div>
  );
}
