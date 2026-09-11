"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { erc20Abi, erc721Abi, type Address, type Hex } from 'viem';
import { useWallet } from '@/lib/hooks/useWallet';
import { settlementShape } from '@/lib/settlement-shape';
import { CONTRACTS } from '@/lib/config';
import { getPublicClient, getWalletClient, approveNFTsForEscrow, depositTickets, withdrawTickets, signAndCommitIntent, revokeIntent, submitSettlement, approveUSDC, redeemTicket, waitForTransaction, type IntentParams } from '@/lib/contracts';
import { findSettlement, type SettlementProposal, type SolveEvidence } from '@/lib/solve-api';
import { formatUSDC, truncateAddress } from '@/lib/format';
import { restoreIntent, type MarketSnapshot, type ChainReceipt, type ChainTicket } from '@/lib/market-types';
import { ADJACENCY_NOTE, EMPTY_RESULT, ESCROW_NOTE, EXPLORER, POOL_LABEL, RANKING_RULE, SOLVER_NOTE } from '@/lib/ui-copy';
import { dishonestProposal, namedRejection, simulate, type Attack, type NamedRejection } from '@/lib/proposal-controls';
import ArcWalletBalance from '@/component/reshuffle/ArcWalletBalance';
import IntentBuilder, { condition } from './IntentBuilder';
import Validation from './Validation';
import rejectionDemo from '@/deployments/act-three.json';

const scrollTo = (element: HTMLElement | null) => element?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
const zero = '0x0000000000000000000000000000000000000000';
const holder = (t: ChainTicket) => t.depositor !== zero ? t.depositor : t.owner;
const equal = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? 'Service unavailable');
  return body;
}

export default function Market() {
  const wallet = useWallet();
  const { account, chainId, runWithWallet } = wallet;
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [readError, setReadError] = useState('');
  const [opened, setOpened] = useState(false);
  const [selected, setSelected] = useState<Hex[]>([]);
  const [offered, setOffered] = useState<string[]>([]);
  const [desired, setDesired] = useState<string[]>([]);
  const [gridSession, setGridSession] = useState<number | null>(null);
  const [gridSection, setGridSection] = useState<number | null>(null);
  const [proposal, setProposal] = useState<SettlementProposal | null>(null);
  const [evidence, setEvidence] = useState<SolveEvidence | null>(null);
  const [solverError, setSolverError] = useState('');
  const [solving, setSolving] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [txHash, setTxHash] = useState<Hex>();
  const [status, setStatus] = useState('idle');
  const [rejection, setRejection] = useState<NamedRejection | null>(null);
  const [receipt, setReceipt] = useState<ChainReceipt | null>(null);
  const [approved, setApproved] = useState(false);
  const [attack, setAttack] = useState<Attack>('siphon');
  const [resetEnabled, setResetEnabled] = useState(false);
  const [operator, setOperator] = useState('');
  const workspace = useRef<HTMLElement>(null);
  const receiptPanel = useRef<HTMLElement>(null);
  const initial = useRef(false);
  const activeAction = useRef(false);
  const searchVersion = useRef(0);
  const publicRead = useRef<Promise<MarketSnapshot> | null>(null);

  const runSolver = useCallback(async (hashes: Hex[]) => {
    const version = ++searchVersion.current;
    setSolving(true); setSolverError(''); setProposal(null); setEvidence(null);
    try {
      if (hashes.length < 2 || hashes.length > 4) throw new Error('Select 2–4 live intents for this bounded search.');
      const result = await findSettlement(hashes.map(hash => ({ hash })));
      if (version !== searchVersion.current) return;
      setProposal(result.proposal); setEvidence(result.evidence);
    } catch (e) { if (version === searchVersion.current) setSolverError(e instanceof Error && e.message.startsWith('Select') ? e.message : 'Solver unreachable. Public chain reads remain available. Retry the solver.'); }
    finally { if (version === searchVersion.current) setSolving(false); }
  }, []);
  const refresh = useCallback(async (fresh = false) => {
    try {
      // Preload the complete deployment while the visitor reads the hero. Polls
      // share an unfinished read; a post-transaction refresh must start after it.
      if (fresh && publicRead.current) await publicRead.current.catch(() => {});
      if (!publicRead.current) {
        publicRead.current = jsonFetch<MarketSnapshot>(fresh ? '/api/market?fresh=1' : '/api/market')
          .finally(() => { publicRead.current = null; });
      }
      const data = await publicRead.current;
      setMarket(data); setReadError('');
      if (!initial.current) {
        initial.current = true;
        const live = data.intents.filter(i => i.eventId === 1 && i.state === 1 && !i.expired);
        const defaults = data.defaultHashes.filter(h => live.some(i => i.hash === h));
        const hashes = defaults.length >= 2 ? defaults : live.slice(0, 4).map(i => i.hash);
        setSelected(hashes);
        if (hashes.length >= 2) void runSolver(hashes);
      }
    } catch (e) { setReadError(e instanceof Error ? e.message : 'Chain reads unavailable'); }
  }, [runSolver]);
  useEffect(() => { void Promise.resolve().then(() => refresh()); const timer = setInterval(() => void refresh(), 30000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => {
    void jsonFetch<{ enabled: boolean; operator?: string }>('/api/demo/reset').then(d => { setResetEnabled(d.enabled); setOperator(d.operator ?? ''); }).catch(() => {});
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (account) void getPublicClient().readContract({ address: CONTRACTS.ticketNFT, abi: erc721Abi, functionName: 'isApprovedForAll', args: [account, CONTRACTS.escrow] }).then(value => { if (!cancelled) setApproved(value); }).catch(() => { if (!cancelled) setApproved(false); });
    return () => { cancelled = true; };
  }, [account, market?.blockNumber]);
  const action = async (label: string, fn: (address: Address) => Promise<void>) => {
    if (activeAction.current) return;
    activeAction.current = true; setBusy(label); setNotice(''); setTxHash(undefined); setStatus('idle'); setRejection(null);
    try { await runWithWallet(fn); }
    catch (e) { setNotice(e instanceof Error ? e.message : 'Wallet request cancelled. You can retry this action.'); }
    finally { setBusy(''); activeAction.current = false; }
  };
  const track = async (hash: Hex) => { setTxHash(hash); await waitForTransaction(hash); };
  const custody = (t: ChainTicket, mode: 'deposit' | 'withdraw') => action(mode === 'deposit' ? 'Deposit' : 'Withdraw', async address => {
    const client = getPublicClient();
    if (!equal(holder(t), address)) throw new Error(`Ticket #${t.tokenId} belongs to another participant. Use its holder’s wallet.`);
    if (mode === 'deposit') {
      if (!await client.readContract({ address: CONTRACTS.ticketNFT, abi: erc721Abi, functionName: 'isApprovedForAll', args: [address, CONTRACTS.escrow] })) await track(await approveNFTsForEscrow(address));
      await track(await depositTickets(address, [BigInt(t.tokenId)]));
    } else await track(await withdrawTickets(address, [BigInt(t.tokenId)]));
    setNotice(`Ticket #${t.tokenId}: ${mode} confirmed.`); await refresh(true);
  });
  const sign = (draft: IntentParams) => action('Sign and commit', async address => {
    if (!market) return;
    for (const id of draft.offered) {
      const depositor = await getPublicClient().readContract({ address: CONTRACTS.escrow, abi: [{ type: 'function', name: 'depositor', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] }], functionName: 'depositor', args: [id] });
      if (!equal(depositor, address)) throw new Error(`Deposit your offered ticket #${id} before committing.`);
    }
    let nonce = market.intents.filter(i => equal(i.owner, address)).reduce((n, i) => BigInt(i.nonce) >= n ? BigInt(i.nonce) + 1n : n, 0n);
    while (await getPublicClient().readContract({ address: CONTRACTS.intentRegistry, abi: [{ type: 'function', name: 'usedNonce', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] }], functionName: 'usedNonce', args: [address, nonce] })) nonce++;
    if (draft.maxNetPay > 0n) {
      const allowance = await getPublicClient().readContract({ address: CONTRACTS.usdc, abi: erc20Abi, functionName: 'allowance', args: [address, CONTRACTS.settlement] });
      if (allowance < draft.maxNetPay) await track(await approveUSDC(address, draft.maxNetPay));
    }
    await track(await signAndCommitIntent(address, { ...draft, owner: address, nonce }));
    setNotice('Intent committed. Your signed conditions are now in the pool.'); setOffered([]); await refresh(true);
  });
  const openReceipt = async (hash: Hex) => {
    const result = await jsonFetch<ChainReceipt>(`/api/market/receipt?hash=${hash}`);
    if (result.status === 'success') { setReceipt(result); setTimeout(() => scrollTo(receiptPanel.current), 50); }
    return result;
  };
  const settle = (malicious?: Attack) => action(malicious ? 'Submit dishonest proposal' : 'Propose and settle', async address => {
    setStatus('preparing'); setRejection(null); setReceipt(null);
    let broadcast = false;
    try {
      let hashes = selected;
      if (malicious === 'adjacency') hashes = rejectionDemo.control.proposal.legs.map(l => l.intentHash as Hex);
      const fresh = await findSettlement(hashes.map(hash => ({ hash })));
      if (!fresh.proposal || !fresh.evidence.simulationResult?.success) {
        setProposal(fresh.proposal); setEvidence(fresh.evidence);
        throw new Error(fresh.evidence.simulationResult?.error ?? EMPTY_RESULT);
      }
      let payload = fresh.proposal;
      if (malicious) {
        payload = dishonestProposal(payload, malicious, market?.tickets ?? []);
        let actual: NamedRejection | null = null;
        try { await simulate(payload, address); } catch (e) { actual = namedRejection(e); }
        const expected = { siphon: 'PaymentImbalance', count: 'CountMismatch', adjacency: 'SeatsNotAdjacent' }[malicious];
        if (actual?.name !== expected) throw new Error(`This state does not isolate ${expected}. ${actual?.name ?? 'Refresh the pool and try again.'}`);
      } else {
        // One UI action, two RPC calls. Simulation does not reserve chain state.
        await simulate(payload, address);
      }
      setStatus('wallet approval');
      const hash = await submitSettlement(address, payload.intents, payload.legs);
      broadcast = true; setTxHash(hash); setStatus('pending receipt');
      const r = await getPublicClient().waitForTransactionReceipt({ hash });
      const verified = await openReceipt(hash);
      setStatus(r.status === 'success' ? 'confirmed' : 'reverted'); setRejection(verified.rejection);
      setProposal(null); setEvidence(null); await refresh(true);
    } catch (e) {
      if (!broadcast) { const named = namedRejection(e); setRejection(named); setStatus(named ? 'simulation rejected' : 'idle'); }
      throw e;
    }
  });
  const reset = () => action('Reset demo', async address => {
    const challenge = await jsonFetch<{ enabled: boolean; operator: string; message: string }>('/api/demo/reset');
    if (!challenge.enabled || !equal(address, challenge.operator)) throw new Error('Reset requires the configured demo operator on the local development server.');
    const signature = await getWalletClient().signMessage({ account: address, message: challenge.message });
    await jsonFetch('/api/demo/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: challenge.message, signature }) });
    for (let i = 0; i < 300; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const d = await jsonFetch<{ state: string }>('/api/demo/reset');
      if (d.state === 'failed') throw new Error('Demo preparation failed. Inspect the local operator script log.');
      if (d.state === 'complete') { initial.current = false; await refresh(true); setNotice('Demo preparation complete. Current chain state loaded.'); return; }
    }
    setNotice('Preparation is still running. Refresh the chain state after the local script completes.');
  });

  const live = market?.intents.filter(i => i.eventId === 1 && i.state === 1 && !i.expired) ?? [];
  const tickets = market?.tickets.filter(t => t.eventId === 1) ?? [];
  const positions = account ? tickets.filter(t => equal(holder(t), account)) : tickets;
  const sessions = [...new Set(tickets.map(t => t.sessionId))].sort((a, b) => a - b);
  const sections = [...new Set(tickets.map(t => t.sectionId))].sort((a, b) => a - b);
  const visible = tickets.filter(t => t.sessionId === (gridSession ?? sessions[0]) && t.sectionId === (gridSection ?? sections[0]));
  const rows = [...new Set(visible.map(t => t.row))].sort((a, b) => a - b);
  const wants = tickets.filter(t => desired.includes(t.tokenId));
  const adjacentSelection = wants.length < 2 || wants.every(t => t.sessionId === wants[0].sessionId && t.sectionId === wants[0].sectionId && t.row === wants[0].row) && [...wants].sort((a, b) => a.seat - b.seat).every((t, n, a) => n === 0 || t.seat === a[n - 1].seat + 1);
  const disabled = !!busy || wallet.isConnecting;
  const selectIntent = (hash: Hex) => { searchVersion.current++; setSolving(false); setSelected(s => s.includes(hash) ? s.filter(h => h !== hash) : [...s, hash]); setProposal(null); setEvidence(null); setSolverError(''); };

  return <div className="reshuffle-ui">
    <header className="site-header"><span className="wordmark">RESHUFFLE<span className="mark">↔</span></span><span className="header-network mono">ARC TESTNET / 5042002</span>
      {account && <div className="wallet-meta"><span className="mono">{truncateAddress(account)}</span><ArcWalletBalance account={account} walletChainId={chainId} compact />{chainId !== 5042002 && <button disabled={disabled} onClick={() => void action('Switch network', async () => {})}>Wrong network · switch</button>}</div>}
    </header>
    <main>
      <section className="hero"><div className="eyebrow">An outcome market for tickets</div><h1>You sign the outcome<br />you’ll accept,<br /><span>not the trade<br />you’re offered.</span></h1><div className="hero-bottom"><p>Today: sell first, then hope you can rebuy.<br />Here: everyone’s signed conditions are checked in one transaction, or nothing moves.</p><div className="hero-actions"><button className="primary" onClick={() => scrollTo(document.getElementById('events'))}>See it settle <span>↓</span></button><a className="secondary" href={`${EXPLORER}/address/${CONTRACTS.settlement}`} target="_blank" rel="noreferrer">Contracts on Arc ↗</a></div></div><div className="hero-foot mono">SIGN ONCE. LEAVE. EVERY SIGNED CONDITION CHECKED ON-CHAIN.</div></section>
      <section id="events" className="event-section"><div className="section-heading"><h2>Choose a night.<br />Keep your options.</h2><p>One live demo event.<br />An outcome pool, not a ticket shop.</p></div><div className="posters">
        <button className="poster poster-live" disabled={!market} aria-busy={!market && !readError} aria-describedby="event-preload-status" aria-expanded={opened} aria-controls="workspace" onClick={() => { setOpened(true); setTimeout(() => scrollTo(workspace.current), 40); }}><span className="poster-top mono">RESHUFFLE PRESENTS / EVENT 1</span><span className="poster-art" aria-hidden="true"><i /><i /><i /></span><span className="poster-title">AFTER<br />HOURS</span><span className="poster-sub">Demo concert · issuer-native tickets</span><span className="poster-dates mono">{sessions.length ? sessions.map(n => `SESSION ${n}`).join(' / ') : 'READING SESSIONS'}</span><span className="poster-status"><span className="mono">{market ? `${live.length} ${POOL_LABEL}` : 'Reading live intents…'}</span><span>Open workspace ↗</span></span></button>
        {['INTERLUDE', 'ENCORE'].map((name, n) => <div key={name} className="poster poster-inert" aria-disabled="true"><span className="poster-top mono">UPCOMING PROGRAMME / 0{n + 2}</span><span className="poster-art inert-art" aria-hidden="true"><i /><i /><i /></span><span className="poster-title">{name}</span><span className="poster-sub">Event details to be announced</span><span className="poster-dates mono">VENUE & DATES UNANNOUNCED</span><span className="poster-status">No live intents</span></div>)}
      </div><p id="event-preload-status" className="quiet" role="status" aria-live="polite">{market ? `Ticket positions and intent commitments loaded for all deployed events ? Arc block ${market.blockNumber}.` : readError ? 'Event data could not be loaded. Retry the public reads below.' : 'Preloading public ticket positions and intent commitments for all deployed events. The event opens as soon as its data is ready.'}</p><p className="quiet">Event names are demo presentation labels. Session IDs and ticket metadata come from the deployed contracts; no venue dates or prices are recorded on-chain.</p>{readError && <p role="alert" className="read-error">{readError} <button onClick={() => void refresh(true)}>Retry public reads</button></p>}</section>
      {market && <section id="workspace" hidden={!opened} ref={workspace} className="workspace-section"><div className="section-heading"><div><span className="eyebrow">The workspace / Event 1</span><h2>Keep the ticket.<br />Change the outcome.</h2></div><div><p className="mono">{market ? `ARC BLOCK ${market.blockNumber}` : 'READING ARC'}</p><button className="text-button" onClick={() => void refresh(true)}>Refresh public state ↻</button></div></div>
        <div className="network-note">USDC pays for both settlement and native gas on Arc. You don’t need a second token.</div>
        {(notice || busy) && <div className="activity" role="status"><strong>{busy || 'Activity'}</strong><p>{notice || 'Complete the request in your wallet. The original action continues automatically.'}</p>{txHash && <a className="hash" href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer">{txHash} ↗</a>}</div>}
        {!market ? <p>Reading public ticket positions and intent commitments…</p> : <div className="workspace-grid">
          <div className="workspace-column"><section className="workspace-panel"><div className="panel-heading"><h2>Your position</h2><span className="eyebrow">01 / Custody</span></div><p className="quiet">{account ? 'Tickets held by your wallet or deposited by you.' : 'Demo participants’ positions, read from chain. Connect to act as yourself when you deposit or withdraw.'}</p>
            {account && !approved && <button className="secondary" disabled={disabled} onClick={() => void action('Approve tickets', async address => { await track(await approveNFTsForEscrow(address)); setApproved(true); })}>Approve tickets</button>}
            <div className="position-list">{positions.map(t => { const escrowed = t.depositor !== zero; const committed = escrowed && live.some(i => equal(i.owner, holder(t)) && i.offered.includes(t.tokenId)); return <article key={t.tokenId} className="position"><div><label><input type="checkbox" disabled={disabled || t.status === 1 || !!account && !equal(holder(t), account)} checked={offered.includes(t.tokenId)} onChange={() => setOffered(ids => ids.includes(t.tokenId) ? ids.filter(id => id !== t.tokenId) : [...ids, t.tokenId])} /><span className="mono">#{t.tokenId} · SESSION {t.sessionId}</span></label><p className="mono">ROW {t.row} / SEAT {t.seat} / SECTION {t.sectionId}</p><p className="quiet mono">{truncateAddress(holder(t))}</p></div><div className="position-actions"><span className="badge">{t.status === 1 ? 'USED' : committed ? 'committed' : escrowed ? 'escrowed' : 'wallet'}</span>{t.status !== 1 && <button disabled={disabled} onClick={() => void custody(t, escrowed ? 'withdraw' : 'deposit')}>{escrowed ? 'Withdraw' : 'Deposit'}</button>}</div></article>; })}</div>{positions.length === 0 && <p>No tickets currently held by this wallet. You can still commit a receiving intent.</p>}<p className="quiet">{ESCROW_NOTE}. Withdrawals do not revoke intents; the contract checks custody again at execution. Tick the tickets you want to offer.</p></section>
          <section className="workspace-panel"><div className="panel-heading"><h2>Find your space</h2><span className="eyebrow">02 / Seat grid</span></div><div className="chips">{sessions.map(n => <button key={n} aria-pressed={n === (gridSession ?? sessions[0])} onClick={() => setGridSession(n)}>SESSION <span className="mono">{n}</span></button>)}</div><div className="chips">{sections.map(n => <button key={n} aria-pressed={n === (gridSection ?? sections[0])} onClick={() => setGridSection(n)}>SECTION <span className="mono">{n}</span></button>)}</div><div className="stage mono">STAGE / SECTION {gridSection ?? sections[0]}</div>
            <div className="seat-grid">{rows.map(row => <div className="seat-row" key={row}><span className="mono row-label">R{row}</span>{Array.from({ length: Math.max(12, ...visible.filter(t => t.row === row).map(t => t.seat)) }, (_, n) => n + 1).map(seat => { const at = visible.filter(t => t.row === row && t.seat === seat); return <div key={seat} className="seat-cell">{at.length ? at.map(t => <button key={t.tokenId} disabled={t.status === 1} className={`seat ${desired.includes(t.tokenId) ? 'selected' : equal(holder(t), account) ? 'yours' : t.depositor !== zero ? 'available' : 'other'}`} title={`Ticket #${t.tokenId} · ${holder(t)}`} aria-label={`Select ticket ${t.tokenId}, row ${row}, seat ${seat}`} aria-pressed={desired.includes(t.tokenId)} onClick={() => setDesired(ids => ids.includes(t.tokenId) ? ids.filter(id => id !== t.tokenId) : [...ids, t.tokenId])}>{seat}</button>) : <span className="seat unissued" title="No issued ticket at this position">·</span>}</div>; })}</div>)}</div>
            <div className="seat-legend"><span>□ Escrowed</span><span>▣ Held by you</span><span>▧ Other wallet</span><span>■ Selected</span><span>· Unissued</span></div><button className="text-button" onClick={() => setDesired([])}>Clear selection</button>{!adjacentSelection && <p className="selection-note">These seats are not adjacent; a proposal giving you these will revert if you sign an adjacency requirement. Signing remains available.</p>}<p className="quiet">{ADJACENCY_NOTE}</p></section></div>
          <div className="workspace-column"><IntentBuilder market={market} account={account} offered={offered} desired={wants} clearDesired={() => setDesired([])} busy={disabled} onSign={sign} />
          <section className="workspace-panel"><div className="panel-heading"><h2>The intent pool</h2><span className="mono">{live.length} {POOL_LABEL}</span></div><div className="pool-list">{live.map((i, index) => <article key={i.hash} className="pool-row"><label><input type="checkbox" checked={selected.includes(i.hash)} disabled={disabled} onChange={() => selectIntent(i.hash)} /><span>Participant <span className="mono">{index + 1} · {truncateAddress(i.owner)}</span></span></label><p>{condition(restoreIntent(i))}</p><div><a className="mono" href={`${EXPLORER}/tx/${i.commitTx}`} target="_blank" rel="noreferrer">Commit {i.commitTx.slice(0, 10)}… ↗</a>{equal(i.owner, account) && <button disabled={disabled} onClick={() => void action('Revoke intent', async address => { await track(await revokeIntent(address, i.hash)); await refresh(true); setProposal(null); setEvidence(null); })}>Revoke my intent</button>}</div></article>)}</div>{!live.length && <p>{EMPTY_RESULT}</p>}
            <div className="solver-actions"><button className="secondary" disabled={solving || disabled || selected.length < 2 || selected.length > 4} onClick={() => void runSolver(selected)}>{solving ? 'Reading and searching…' : 'Run solver'} <span className="mono">({selected.length}/4)</span></button>{resetEnabled && equal(account, operator) && <button className="text-button" disabled={disabled} onClick={() => void reset()}>Reset demo</button>}</div>
            {solverError && <p role="alert">{solverError}</p>}{evidence && !proposal && <div><p>{EMPTY_RESULT}</p>{evidence.candidatesExcluded.some(i => /capacity|allowance/i.test(i.reason)) && <p>Insufficient USDC balance or allowance for a candidate. Update spending capacity before settling.</p>}</div>}
            {proposal && <div className="candidate"><div className="panel-heading"><strong>{settlementShape(proposal)}</strong><span className="mono">{proposal.candidatesFound} candidates</span></div><p className="quiet">{RANKING_RULE}. Ties: fewer participants, then ordered intent hashes. Source block <span className="mono">{evidence?.source.blockNumber}</span>.</p><table className="net-table"><thead><tr><th>Participant</th><th>USDC net</th></tr></thead><tbody>{proposal.legs.map(l => <tr key={l.intentHash}><td className="mono">{truncateAddress(l.owner)}</td><td className="mono">{l.netPayment > 0n ? '−' : l.netPayment < 0n ? '+' : ''}{formatUSDC(l.netPayment < 0n ? -l.netPayment : l.netPayment)}</td></tr>)}</tbody><tfoot><tr><td>Σ</td><td className="mono">{formatUSDC(proposal.legs.reduce((n, l) => n - l.netPayment, 0n))}</td></tr></tfoot></table></div>}
            <button className="primary full" disabled={disabled || !proposal || !evidence?.simulationResult?.success} onClick={() => void settle()}>Propose and settle <span>↗</span></button><p className="quiet">Simulates, then submits immediately in this action. State can change between those RPC calls; the contract checks again at execution.</p>
            <details className="dishonest"><summary>Submit dishonest proposal ▾</summary><p>Intentionally submit a failing transaction. The proposer pays its gas in USDC. The adjacency case uses the separate live rejection-demo intents.</p><select value={attack} onChange={e => setAttack(e.target.value as Attack)}><option value="siphon">Siphon 20 USDC</option><option value="adjacency">Non-adjacent seats</option><option value="count">Wrong count</option></select><button className="secondary" disabled={disabled || !proposal} onClick={() => void settle(attack)}>Submit dishonest proposal</button></details>
          </section></div>
        </div>}
        {(status !== 'idle' || rejection) && <Validation key={`${status}:${txHash}`} status={status} hash={txHash} rejection={rejection} />}
        <section className="history"><div className="panel-heading"><h2>Past settlements</h2><span className="eyebrow">Public receipts</span></div><div className="history-list">{market?.settlements.map(r => <button key={r.hash} onClick={() => void openReceipt(r.hash).catch(e => setNotice(e.message))}><span className="mono">{r.hash.slice(0, 14)}…</span><span className="mono">{r.participants} participants / block {r.block}</span><span>Open receipt ↗</span></button>)}</div></section>
      </section>}
      {receipt && <section ref={receiptPanel} className="receipt-section"><div className="section-heading"><div><span className="eyebrow passed">Settlement confirmed</span><h2>Different tickets.<br />Every condition met.</h2></div><span className="receipt-stamp passed">✓</span></div><a className="hash" href={`${EXPLORER}/tx/${receipt.hash}`} target="_blank" rel="noreferrer">{receipt.hash} ↗</a><p className="receipt-count mono">{receipt.ticketTransfers} ticket transfers · {receipt.usdcTransfers} USDC transfers · 1 transaction</p><table className="receipt-table"><thead><tr><th>Participant</th><th>Before / offered</th><th>After / received</th><th>USDC net</th></tr></thead><tbody>{receipt.participants.map((p, n) => <tr key={`${p.owner}:${n}`}><td className="mono">{truncateAddress(p.owner)}</td><td className="mono">{p.offered.map(id => `#${id}`).join(', ') || '—'}</td><td className="mono">{p.receives.map(id => `#${id}`).join(', ') || '—'}</td><td className="mono">{BigInt(p.netPayment) > 0n ? '−' : BigInt(p.netPayment) < 0n ? '+' : ''}{formatUSDC(BigInt(p.netPayment) < 0n ? -BigInt(p.netPayment) : BigInt(p.netPayment))}</td></tr>)}</tbody><tfoot><tr><td colSpan={3}>Σ =</td><td className="mono passed">{formatUSDC(BigInt(receipt.netSum))}</td></tr></tfoot></table><p>{receipt.independent ? SOLVER_NOTE : 'Submitted by a participant wallet.'} <span className="mono">{truncateAddress(receipt.proposer)}</span></p><p className="quiet">Ticket recipients are checked against receipt logs. USDC transfer count excludes native gas. A different proposer address alone does not establish that participant browsers were offline.</p><div className="receipt-actions"><a className="secondary" href={`${EXPLORER}/tx/${receipt.hash}`} target="_blank" rel="noreferrer">View on Arc explorer ↗</a><button className="secondary" onClick={() => void navigator.clipboard.writeText(receipt.hash).then(() => setNotice('Hash copied.')).catch(() => setNotice('Clipboard unavailable. Select and copy the displayed hash.'))}>Copy hash</button></div><div className="redeem-list">{receipt.participants.filter(p => equal(p.owner, account)).flatMap(p => p.receives).map(id => { const t = tickets.find(t => t.tokenId === id); return <div key={id}><span className="mono">Ticket #{id}</span>{t?.status === 1 ? <span className="badge">USED</span> : <button disabled={disabled || !t || !equal(t.owner, account)} onClick={() => void action('Redeem', async address => { await track(await redeemTicket(address, BigInt(id))); await refresh(true); })}>Redeem</button>}</div>; })}</div><p className="quiet">Redeem marks your ticket used permanently. Only its current holder can redeem it.</p></section>}
    </main><footer className="site-footer"><span className="wordmark">RESHUFFLE ↔</span><p>Swap tickets without selling first.<br />Every condition you sign is checked on-chain.</p><span className="mono">ARC TESTNET / USDC</span></footer>
  </div>;
}
