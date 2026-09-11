"use client";
import { useState } from 'react';
import type { Address } from 'viem';
import type { IntentParams } from '@/lib/contracts';
import type { ChainTicket, MarketSnapshot } from '@/lib/market-types';
import { intentTypedData, jsonNumbers } from '@/lib/intent-typed-data';
import { formatUSDC, truncateAddress } from '@/lib/format';

const includesClass = (mask: bigint, id: number) => !!(mask & (1n << BigInt(id)));

export function condition(i: Pick<IntentParams, 'exactCount' | 'sessionMask' | 'sectionMask' | 'mustShareSession' | 'mustShareSection' | 'mustBeAdjacent' | 'maxNetPay'>) {
  const ids = (mask: bigint) => Array.from({ length: 256 }, (_, n) => n).filter(n => !!(mask & (1n << BigInt(n)))).join(', ') || 'none';
  return `Receive exactly ${i.exactCount} ${i.mustBeAdjacent ? 'adjacent ' : ''}tickets; sessions ${ids(i.sessionMask)}; sections ${ids(i.sectionMask)}; ${i.mustShareSession ? 'one session' : 'mixed sessions permitted'}; ${i.mustShareSection ? 'one section' : 'mixed sections permitted'}; ${i.maxNetPay >= 0n ? 'pay at most' : 'receive at least'} ${formatUSDC(i.maxNetPay >= 0n ? i.maxNetPay : -i.maxNetPay)} USDC net.`;
}
export default function IntentBuilder({ market, account, offered, desired, clearDesired, busy, onSign }: {
  market: MarketSnapshot; account: Address | null; offered: string[]; desired: ChainTicket[]; clearDesired: () => void;
  busy: boolean; onSign: (intent: IntentParams) => Promise<void>;
}) {
  const [count, setCount] = useState(2);
  const [sessions, setSessions] = useState(3n);
  const [sections, setSections] = useState(7n);
  const [sameSection, setSameSection] = useState(true);
  const [sameSession, setSameSession] = useState(true);
  const [adjacent, setAdjacent] = useState(true);
  const [budget, setBudget] = useState(0);
  const [deadline, setDeadline] = useState(Number(market.timestamp) + 86400);
  const [raw, setRaw] = useState(false);
  const sessionMask = desired.length ? desired.reduce((n, t) => n | (1n << BigInt(t.sessionId)), 0n) : sessions;
  const sectionMask = desired.length ? desired.reduce((n, t) => n | (1n << BigInt(t.sectionId)), 0n) : sections;
  const nonce = market.intents.filter(i => i.owner.toLowerCase() === account?.toLowerCase()).reduce((n, i) => BigInt(i.nonce) >= n ? BigInt(i.nonce) + 1n : n, 0n);
  const intent: IntentParams = { owner: account ?? '0x0000000000000000000000000000000000000000', offered: offered.map(BigInt),
    eventId: 1, sessionMask, sectionMask, exactCount: count, mustShareSession: sameSession, mustShareSection: sameSection,
    mustBeAdjacent: adjacent, maxNetPay: BigInt(budget) * 1000000n, deadline: BigInt(deadline), nonce };
  const availableSessions = [...new Set(market.tickets.filter(t => t.eventId === 1).map(t => t.sessionId))].sort((a, b) => a - b);
  const availableSections = [...new Set(market.tickets.filter(t => t.eventId === 1).map(t => t.sectionId))].sort((a, b) => a - b);
  const preview = intentTypedData(intent);
  return <section className="workspace-panel builder" aria-labelledby="builder-title">
    <div className="panel-heading"><h2 id="builder-title">Your conditions</h2><span className="eyebrow">03 / Authorise</span></div>
    <p className="quiet">Choose what you will accept. Seat selection sets session and section masks; a specific row or ticket ID is not an enforceable receiving condition.</p>
    <div className="builder-row"><label>Replacement count</label><div className="stepper"><button disabled={busy || count <= 1} onClick={() => { setCount(count - 1); if (count === 2) setAdjacent(false); }} aria-label="Decrease ticket count">−</button><output>{count}</output><button disabled={busy || count >= 4} onClick={() => setCount(count + 1)} aria-label="Increase ticket count">+</button></div></div>
    <fieldset disabled={busy}><legend>Accepted sessions · chain class IDs</legend><div className="chips">{availableSessions.map(n => <button key={n} aria-pressed={includesClass(sessionMask, n)} onClick={() => { clearDesired(); setSessions(sessionMask ^ (1n << BigInt(n))); }}>SESSION <span className="mono">{n}</span></button>)}</div></fieldset>
    <fieldset disabled={busy}><legend>Accepted sections</legend><div className="chips">{availableSections.map(n => <button key={n} aria-pressed={includesClass(sectionMask, n)} onClick={() => { clearDesired(); setSections(sectionMask ^ (1n << BigInt(n))); }}>SECTION <span className="mono">{n}</span></button>)}</div><p className="quiet">No ticket prices are defined by these contracts.</p></fieldset>
    <div className="toggles">
      <label><input type="checkbox" disabled={busy} checked={sameSection} onChange={e => setSameSection(e.target.checked)} />Same section</label>
      <label><input type="checkbox" disabled={busy} checked={sameSession} onChange={e => setSameSession(e.target.checked)} />Same session</label>
      <label><input type="checkbox" disabled={busy} checked={adjacent} onChange={e => { setAdjacent(e.target.checked); if (e.target.checked && count < 2) setCount(2); }} />Adjacent seats</label>
    </div>
    <label className="budget-label" htmlFor="net-budget">{budget >= 0 ? 'I pay up to' : 'I must receive at least'} <span className="mono">{Math.abs(budget)} USDC</span></label>
    <input id="net-budget" className="budget-slider" disabled={busy} type="range" min="-1000" max="1000" step="1" value={budget} onChange={e => setBudget(Number(e.target.value))} />
    <div className="slider-scale mono"><span>−1,000</span><span>0</span><span>+1,000</span></div>
    <label className="deadline">Valid until (your local time)<input disabled={busy} type="datetime-local" value={new Date((deadline - new Date(deadline * 1000).getTimezoneOffset() * 60) * 1000).toISOString().slice(0, 16)} onChange={e => { const n = Date.parse(e.target.value); if (Number.isFinite(n)) setDeadline(Math.floor(n / 1000)); }} /></label>
    <div className="signed-sentence"><p>Take {offered.length ? `my tickets ${offered.map(id => `#${id}`).join(', ')}` : 'no tickets from me'} only if the whole settlement succeeds. {condition(intent)}</p><p className="quiet">Event <span className="mono">{intent.eventId}</span> · valid until <span className="mono">{new Date(deadline * 1000).toLocaleString()}</span> · owner {account ? truncateAddress(account) : 'wallet selected at signing'} · nonce <span className="mono">{account ? String(nonce) : 'read after connection'}</span>. Adjacency {adjacent ? 'requires the same session, section and row, with consecutive seats' : 'is not required'}.</p></div>
    <button className="text-button" onClick={() => setRaw(!raw)}>View signed struct {raw ? '−' : '+'}</button>
    {raw && <pre className="raw-struct">{jsonNumbers(account ? preview : { ...preview, message: { ...preview.message, owner: 'Wallet selected at signing', nonce: 'Read after connection' } })}</pre>}
    <button className="primary full" disabled={busy || !sessionMask || !sectionMask} onClick={() => void onSign(intent)}>Sign and commit <span>↗</span></button>
    <p className="quiet">A USDC spending allowance may be requested in this flow. An allowance does not reserve funds.</p>
  </section>;
}
