"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import sarahPoster from '@/lib/sarah_concert_poster.jpg';
import maydayPoster from '@/lib/mayday_concert_poster.jpg';
import taylorPoster from '@/lib/taylor_concert_poster.png';
import logoImg from '@/public/logo.png';
import { type Address, type Hex } from 'viem';
import { useWallet } from '@/lib/hooks/useWallet';
import { validateNewIntentTiming, selectedClass } from '@/lib/event-schedule';
import { getChainTimestamp, getTicketHolder } from '@/lib/chain-reads';
import { requestTicketImports } from '@/lib/wallet-nfts';
import { FREE_TICKETS_LABEL, WALLET_IMPORT_NOTE } from '@/lib/ui-copy';
import { walletActionMessage } from '@/lib/wallet-errors';
import { settlementShape } from '@/lib/settlement-shape';
import { CONTRACTS } from '@/lib/config';
import { getWalletClient, approveNFTsForEscrow, depositTickets, withdrawTickets, signAndCommitIntent, revokeIntent, submitSettlement, approveUSDC, redeemTicket, type IntentParams } from '@/lib/contracts';
import { findSettlement, findPoolSettlement, type SettlementProposal, type SolveEvidence } from '@/lib/solve-api';
import { formatUSDC, truncateAddress } from '@/lib/format';
import { restoreIntent, type MarketSnapshot, type ChainReceipt, type ChainTicket } from '@/lib/market-types';
import { HERO_TITLE_LINES, HERO_SUBTITLE, EMPTY_RESULT, POOL_NOTE, condition, EXPLORER, POOL_LABEL, RANKING_RULE, SOLVER_NOTE } from '@/lib/ui-copy';
import { dishonestProposal, namedRejection, simulate, type Attack, type NamedRejection } from '@/lib/proposal-controls';
import ArcWalletBalance from '@/component/reshuffle/ArcWalletBalance';
import AnimatedTicketIcon from './AnimatedTicketIcon';
import IntentBuilder from './IntentBuilder';
import Validation from './Validation';
import MatchingStatus from './MatchingStatus';
import { automaticSelection, latestRequest } from '@/lib/matching-status';
import { getMarketSnapshot, getIntentPool, getTicketsFor, getSettlements, getTicketsApproved, getTicketDepositor, getUSDCAllowance, getUnusedNonce, getSettlementReceipt, waitForReceipt, waitForSuccess, ticketHolder as holder } from '@/lib/chain-reads';
import { nextRecordedNonce } from '@/lib/intent-draft';
import rejectionDemo from '@/deployments/act-three.json';

import ConnectWalletButton from '@/component/connectWallet/ConnectWalletButton';

const scrollTo = (element: HTMLElement | null) => element?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
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
  const [automatic, setAutomatic] = useState(true);
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
  const [nftClaim, setNftClaim] = useState<{ owner: Address; tokenIds: string[]; hashes: Hex[]; message: string } | null>(null);
  const [approved, setApproved] = useState(false);
  const [attack, setAttack] = useState<Attack>('siphon');
  const [resetEnabled, setResetEnabled] = useState(false);
  const [operator, setOperator] = useState('');
  const workspace = useRef<HTMLElement>(null);
  const receiptPanel = useRef<HTMLElement>(null);
  const activeAction = useRef(false);
  const searchVersion = useRef(0);
  const searchInFlight = useRef(false);

  const runSolver = useCallback(async (hashes: Hex[], wholePool = false) => {
    const version = ++searchVersion.current;
    searchInFlight.current = true;
    setSolving(true); setSolverError(''); setProposal(null); setEvidence(null);
    try {
      if (!wholePool && (hashes.length < 2 || hashes.length > 4)) throw new Error('Select 2–4 live intents for this bounded search.');
      const result = wholePool ? await findPoolSettlement() : await findSettlement(hashes.map(hash => ({ hash })));
      if (version !== searchVersion.current) return;
      setProposal(result.proposal); setEvidence(result.evidence);
    } catch (e) { if (version === searchVersion.current) setSolverError(e instanceof Error && /^(Select|Live pool exceeds)/.test(e.message) ? e.message : 'Solver unreachable. Public chain reads remain available. Retry the solver.'); }
    finally { if (version === searchVersion.current) { searchInFlight.current = false; setSolving(false); } }
  }, []);
  const refresh = useCallback(async (fresh = false) => {
    try {
      const data = await getMarketSnapshot(fresh);
      setMarket(data); setReadError('');
    } catch (e) { setReadError(e instanceof Error ? e.message : 'Chain reads unavailable'); }
  }, []);
  useEffect(() => { void Promise.resolve().then(() => refresh()); const timer = setInterval(() => void refresh(), 30000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => {
    if (!automatic || !market || busy) return;
    const timer = setTimeout(() => {
      if (searchInFlight.current) return;
      const hashes = automaticSelection(market);
      setSelected(hashes);
      if (hashes.length >= 2) void runSolver(hashes, true);
      else { searchVersion.current++; setSolving(false); setProposal(null); setEvidence(null); setSolverError(''); }
    }, 0);
    return () => clearTimeout(timer);
  }, [automatic, market, account, busy, runSolver]);
  useEffect(() => {
    void jsonFetch<{ enabled: boolean; operator?: string }>('/api/demo/reset').then(d => { setResetEnabled(d.enabled); setOperator(d.operator ?? ''); }).catch(() => {});
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (account) void getTicketsApproved(account).then(value => { if (!cancelled) setApproved(value); }).catch(() => { if (!cancelled) setApproved(false); });
    return () => { cancelled = true; };
  }, [account, market?.blockNumber]);
  const action = async (label: string, fn: (address: Address) => Promise<void>) => {
    if (activeAction.current) return;
    activeAction.current = true; setBusy(label); setNotice(''); setTxHash(undefined); setStatus('idle'); setRejection(null);
    try { await runWithWallet(fn); }
    catch (e) { setNotice(walletActionMessage(e)); }
    finally { setBusy(''); activeAction.current = false; }
  };
  const track = async (hash: Hex) => { setTxHash(hash); await waitForSuccess(hash); };
  const claimDemo = () => action(FREE_TICKETS_LABEL, async address => {
    const { message } = await jsonFetch<{ message: string }>(`/api/demo/tickets?address=${address}`);
    const signature = await getWalletClient().signMessage({ account: address, message });
    setNotice('Issuing your test tickets. Waiting for Arc Testnet confirmation…');
    const result = await jsonFetch<{ tokenIds: string[]; hashes: Hex[] }>('/api/demo/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, signature }) });
    setTxHash(result.hashes.at(-1));
    setNotice(`Tickets ${result.tokenIds.map(id => `#${id}`).join(', ')} are confirmed. Open MetaMask to add them to its NFTs tab.`);
    setNftClaim({ owner: address, ...result, message: 'Requesting NFT display in MetaMask...' });
    const refreshRequest = refresh(true);
    const messageResult = await requestTicketImports(address, result.tokenIds);
    setNftClaim({ owner: address, ...result, message: messageResult });
    await refreshRequest;
    setNotice(`Claim confirmed for tickets ${result.tokenIds.map(id => `#${id}`).join(', ')}. ${messageResult}`);
  });
  const retryNFTImport = () => action('Add to wallet', async address => {
    if (!nftClaim || !equal(address, nftClaim.owner)) throw new Error('Switch to the wallet that claimed these tickets.');
    const message = await requestTicketImports(address, nftClaim.tokenIds);
    setNftClaim({ ...nftClaim, message }); setNotice(message);
  });

  const custody = (t: ChainTicket, mode: 'deposit' | 'withdraw') => action(mode === 'deposit' ? 'Deposit' : 'Withdraw', async address => {
    if (!equal(holder(t), address)) throw new Error(`Ticket #${t.tokenId} belongs to another participant. Use its holder’s wallet.`);
    if (mode === 'deposit') {
      if (!await getTicketsApproved(address)) await track(await approveNFTsForEscrow(address));
      await track(await depositTickets(address, [BigInt(t.tokenId)]));
    } else await track(await withdrawTickets(address, [BigInt(t.tokenId)]));
    setNotice(`Ticket #${t.tokenId}: ${mode} confirmed.`); await refresh(true);
  });
  const depositSelected = (tokenIds: bigint[]) => action('Deposit selected tickets', async address => {
    const ids = [...new Set(tokenIds)];
    if (!ids.length) throw new Error('Select the tickets you want to deposit.');
    const pending: bigint[] = [];
    for (const id of ids) {
      const depositor = await getTicketDepositor(id);
      if (equal(depositor, address)) continue;
      if (depositor !== '0x0000000000000000000000000000000000000000' || !equal(await getTicketHolder(id), address)) {
        throw new Error(`Ticket #${id} is no longer held by this wallet. Refresh your tickets and select again.`);
      }
      pending.push(id);
    }
    if (!pending.length) {
      setNotice('Your selected tickets are already deposited.'); await refresh(true); return;
    }
    if (!await getTicketsApproved(address)) {
      setNotice('Approve ticket access in your wallet. The batch deposit will follow after approval confirms.');
      await track(await approveNFTsForEscrow(address)); setApproved(true);
    }
    setNotice(`Confirm one deposit transaction for ${pending.length} selected ticket${pending.length === 1 ? '' : 's'}.`);
    await track(await depositTickets(address, pending));
    setNotice(`Deposited ${pending.length} ticket${pending.length === 1 ? '' : 's'} together: ${pending.map(id => `#${id}`).join(', ')}.`);
    await refresh(true);
  });
  const sign = (draft: IntentParams, prepared: (intent: IntentParams) => void) => action('Sign and commit', async address => {
    if (!market) return;
    if (selectedClass(draft.sectionMask) === null) throw new Error('Choose exactly one section.');
    validateNewIntentTiming(draft.sessionMask, draft.deadline, await getChainTimestamp());
    for (const id of draft.offered) {
      const depositor = await getTicketDepositor(id);
      if (!equal(depositor, address)) throw new Error(`Deposit your offered ticket #${id} before committing.`);
    }
    const nonce = await getUnusedNonce(address, nextRecordedNonce(market, address));
    if (draft.maxNetPay > 0n) {
      const allowance = await getUSDCAllowance(address);
      if (allowance < draft.maxNetPay) await track(await approveUSDC(address, draft.maxNetPay));
    }
    const ready = { ...draft, owner: address, nonce };
    prepared(ready);
    await track(await signAndCommitIntent(address, ready));
    searchVersion.current++; searchInFlight.current = false; setSolving(false);
    setReceipt(null); setProposal(null); setEvidence(null); setAutomatic(true);
    setNotice('Intent committed. Matching will start automatically as soon as the refreshed pool includes your request.'); await refresh(true);
  });
  const openReceipt = async (hash: Hex) => {
    const result = await getSettlementReceipt(hash);
    if (result.status === 'success') { setReceipt(result); setTimeout(() => scrollTo(receiptPanel.current), 50); }
    return result;
  };
  const settle = (malicious?: Attack) => action(malicious ? 'Submit dishonest proposal' : 'Propose and settle', async address => {
    setStatus('preparing'); setRejection(null); setReceipt(null);
    let broadcast = false;
    try {
      let hashes = proposal?.legs.map(leg => leg.intentHash) ?? selected;
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
      const r = await waitForReceipt(hash);
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
      if (d.state === 'complete') { setAutomatic(true); await refresh(true); setNotice('Demo preparation complete. Current chain state loaded.'); return; }
    }
    setNotice('Preparation is still running. Refresh the chain state after the local script completes.');
  });

  const live = market ? getIntentPool(market) : [];
  const request = market ? latestRequest(market, account) : undefined;
  const tickets = market ? getTicketsFor(null, market) : [];
  const sessions = [...new Set(tickets.map(t => t.sessionId))].sort((a, b) => a - b);
  const disabled = !!busy || wallet.isConnecting;
  const selectIntent = (hash: Hex) => { setAutomatic(false); searchVersion.current++; searchInFlight.current = false; setSolving(false); setSelected(s => s.includes(hash) ? s.filter(h => h !== hash) : [...s, hash]); setProposal(null); setEvidence(null); setSolverError(''); };

  return <div className="reshuffle-ui">
    <header className="site-header">
      <div className="header-brand">
        <Image
          src={logoImg}
          alt="RESHUFFLE"
          height={48}
          priority
          className="header-logo"
        />
      </div>
      <nav className="two-line-nav" aria-label="Main navigation">
        <button
          type="button"
          className="two-line-nav-item"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          Home
        </button>
        <button
          type="button"
          className="two-line-nav-item"
          onClick={() => document.getElementById('events')?.scrollIntoView({ behavior: 'smooth' })}
        >
          Market
        </button>
      </nav>
      <div className="header-actions">
        <ConnectWalletButton />
      </div>
    </header>
    <main>
      <section className="hero">
        <div className="hero-grid">
          <div className="hero-text-block">
            <div className="eyebrow">An outcome market for tickets</div>
            <h1>{HERO_TITLE_LINES[0]}<br /><span>{HERO_TITLE_LINES[1]}</span></h1>
            <div className="hero-cta-wrap">
              <button
                type="button"
                className="select-event-btn"
                onClick={() => document.getElementById('events')?.scrollIntoView({ behavior: 'smooth' })}
              >
                <span>Select Event</span>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="btn-arrow" aria-hidden="true">
                  <path d="M8 3.5V12.5M8 12.5L12.5 8M8 12.5L3.5 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
          <div className="hero-visual">
            <div className="hero-icon-card">
              <AnimatedTicketIcon />
            </div>
          </div>
        </div>
      </section>
      <section id="events" className="event-section"><div className="section-heading"><h2>Choose a night.<br />Keep your options.</h2><p>One live demo event.<br />An outcome pool, not a ticket shop.</p></div><div className="posters">
        <button className="poster poster-live" disabled={!market} aria-busy={!market && !readError} aria-describedby="event-preload-status" aria-expanded={opened} aria-controls="workspace" onClick={() => { setOpened(true); setTimeout(() => scrollTo(workspace.current), 40); }}><span className="poster-top mono">RESHUFFLE PRESENTS / EVENT 1</span><span className="poster-photo"><Image src={maydayPoster} alt="Mayday concert poster" fill sizes="(max-width: 720px) 84vw, 28vw" /></span><span className="poster-title">AFTER<br />HOURS</span><span className="poster-sub">Demo concert · issuer-native tickets</span><span className="poster-dates mono">{sessions.length ? sessions.map(n => `SESSION ${n}`).join(' / ') : 'READING SESSIONS'}</span><span className="poster-status"><span className="mono">{market ? `${live.length} ${POOL_LABEL}` : 'Reading live intents…'}</span><span>Open workspace ↗</span></span></button>
        {[{ name: 'INTERLUDE', photo: sarahPoster, alt: 'Sarah Kang in Seoul concert poster' }, { name: 'ENCORE', photo: taylorPoster, alt: 'Taylor Swift The Eras Tour concert poster' }].map(({ name, photo, alt }, n) => <div key={name} className="poster poster-inert" aria-disabled="true"><span className="poster-top mono">UPCOMING PROGRAMME / 0{n + 2}</span><span className="poster-photo"><Image src={photo} alt={alt} fill sizes="(max-width: 720px) 84vw, 28vw" /></span><span className="poster-title">{name}</span><span className="poster-sub">Event details to be announced</span><span className="poster-dates mono">VENUE & DATES UNANNOUNCED</span><span className="poster-status">No live intents</span></div>)}
      </div><p id="event-preload-status" className="quiet" role="status" aria-live="polite">{market ? `Ticket positions and intent commitments loaded for all deployed events / Arc block ${market.blockNumber}.` : readError ? 'Event data could not be loaded. Retry the public reads below.' : 'Preloading public ticket positions and intent commitments for all deployed events. The event opens as soon as its data is ready.'}</p><p className="quiet">Event names are demo presentation labels. Session IDs and ticket metadata come from the deployed contracts; no venue dates or prices are recorded on-chain.</p>{readError && <p role="alert" className="read-error">{readError} <button onClick={() => void refresh(true)}>Retry public reads</button></p>}</section>
      {market && <section id="workspace" hidden={!opened} ref={workspace} className="workspace-section"><div className="section-heading"><div><span className="eyebrow">The workspace / Event 1</span><h2>Keep the ticket.<br />Change the outcome.</h2></div><div><p className="mono">{market ? `ARC BLOCK ${market.blockNumber}` : 'READING ARC'}</p><button className="text-button" onClick={() => void refresh(true)}>Refresh public state ↻</button></div></div>
        <div className="network-note">USDC pays for both settlement and native gas on Arc. You don’t need a second token.</div>
        {(notice || busy) && <div className="activity" role="status"><strong>{busy || 'Activity'}</strong><p>{notice || 'Complete the request in your wallet. The original action continues automatically.'}</p>{txHash && <a className="hash" href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer">{txHash} ↗</a>}</div>}
        {nftClaim && equal(nftClaim.owner, account) && <section className="wallet-nft-import"><h3>Your free tickets</h3><p role="status">{nftClaim.message}</p><p className="quiet">{WALLET_IMPORT_NOTE}</p><span className="mono hash">NFT contract: {CONTRACTS.ticketNFT}</span><ul>{nftClaim.tokenIds.map((id, n) => <li key={id} className="mono">Token ID: {id} / <a href={`${EXPLORER}/tx/${nftClaim.hashes[n]}`} target="_blank" rel="noreferrer">Mint receipt</a></li>)}</ul><button className="secondary" disabled={disabled} onClick={() => void retryNFTImport()}>Add to wallet</button></section>}
        <div className="workspace-stack">
          {request && <MatchingStatus request={request} selected={selected} solving={solving} error={readError || solverError} proposal={proposal} evidence={evidence} automatic={automatic} resume={() => setAutomatic(true)} busy={disabled} />}
          <IntentBuilder market={market} account={account} approved={approved} busy={disabled} onCustody={custody} onDepositSelected={depositSelected} onSign={sign} onDemo={claimDemo} onApprove={() => action('Approve tickets', async address => { await track(await approveNFTsForEscrow(address)); setApproved(true); })} />
          <section className="workspace-panel"><div className="panel-heading"><h2>The intent pool</h2><span className="mono">{live.length} {POOL_LABEL}</span></div><p className="quiet">{POOL_NOTE}</p><div className="pool-list">{live.map((i, index) => <article key={i.hash} className="pool-row"><label><input type="checkbox" checked={selected.includes(i.hash)} disabled={disabled} onChange={() => selectIntent(i.hash)} /><span>Participant <span className="mono">{index + 1} · {truncateAddress(i.owner)}</span></span></label><p>{condition(restoreIntent(i))}</p><div><a className="mono" href={`${EXPLORER}/tx/${i.commitTx}`} target="_blank" rel="noreferrer">Commit {i.commitTx.slice(0, 10)}… ↗</a>{equal(i.owner, account) && <button disabled={disabled} onClick={() => void action('Revoke intent', async address => { await track(await revokeIntent(address, i.hash)); await refresh(true); setProposal(null); setEvidence(null); })}>Revoke my intent</button>}</div></article>)}</div>{!live.length && <p>{EMPTY_RESULT}</p>}
            <div className="solver-actions"><button className="secondary" disabled={solving || disabled || (automatic ? live.length < 2 : selected.length < 2 || selected.length > 4)} onClick={() => void runSolver(selected, automatic)}>{solving ? 'Reading and searching…' : automatic ? 'Check all intents' : 'Run solver'} <span className="mono">({automatic ? `${live.length} in pool` : `${selected.length}/4`})</span></button>{resetEnabled && equal(account, operator) && <button className="text-button" disabled={disabled} onClick={() => void reset()}>Reset demo</button>}</div>
            <p className="quiet">{automatic ? 'Automatic matching searches all live event intents. You do not need to choose participants. Each candidate contains two to four participants; public-state refreshes retry the search while this page is open.' : 'Manual search is on. Choose 2–4 requests, then Run solver.'}</p>{!automatic && !request && <button className="text-button" disabled={disabled} onClick={() => setAutomatic(true)}>Resume automatic matching</button>}
            {evidence?.pool && <p className="quiet mono">{evidence.pool.liveIntents} live requests / {evidence.pool.searchableIntents} within ticket-count limits / {evidence.pool.excludedIntents} excluded with reasons. Maximum 4 participants per candidate, 100 candidates, 2-second search budget. <a href={`/api/evidence/${evidence.id}`} target="_blank" rel="noreferrer">View search evidence and exclusion reasons</a></p>}{evidence?.search && <p className="quiet">{evidence.search.termination === 'complete' ? 'Search completed within the configured bounds.' : 'Search budget reached. Further combinations may remain unchecked.'}</p>}{solverError && <p role="alert">{solverError}</p>}{evidence && !proposal && <div className="matching-empty" role="status"><h3>Waiting for a match</h3><p>{EMPTY_RESULT}. New requests may make a swap possible; you can wait or try another selection.</p>{evidence.candidatesExcluded.some(i => /capacity|allowance/i.test(i.reason)) && <p>Insufficient USDC balance or allowance for a candidate. Update spending capacity before settling.</p>}</div>}
            {proposal && <div className="candidate"><p className="eyebrow">{evidence?.simulationResult?.success ? 'Candidate found - awaiting settlement' : 'Candidate needs rechecking'}</p><p className="quiet">{evidence?.simulationResult?.success ? 'A candidate is not a completed swap. Propose and settle submits it for on-chain validation.' : 'This candidate has not passed simulation and cannot be submitted yet.'}</p><div className="panel-heading"><strong>{settlementShape(proposal)}</strong><span className="mono">{proposal.candidatesFound} candidates</span></div><p className="quiet">{RANKING_RULE}. Ties: fewer participants, then ordered intent hashes. Source block <span className="mono">{evidence?.source.blockNumber}</span>.</p><table className="net-table"><thead><tr><th>Participant</th><th>USDC net</th></tr></thead><tbody>{proposal.legs.map(l => <tr key={l.intentHash}><td className="mono">{truncateAddress(l.owner)}</td><td className="mono">{l.netPayment > 0n ? '−' : l.netPayment < 0n ? '+' : ''}{formatUSDC(l.netPayment < 0n ? -l.netPayment : l.netPayment)}</td></tr>)}</tbody><tfoot><tr><td>Σ</td><td className="mono">{formatUSDC(proposal.legs.reduce((n, l) => n - l.netPayment, 0n))}</td></tr></tfoot></table></div>}
            <button className="primary full" disabled={disabled || !proposal || !evidence?.simulationResult?.success} onClick={() => void settle()}>Propose and settle <span>↗</span></button><p className="quiet">Simulates, then submits immediately in this action. State can change between those RPC calls; the contract checks again at execution.</p>
            <details className="dishonest"><summary>Submit dishonest proposal ▾</summary><p>Intentionally submit a failing transaction. The proposer pays its gas in USDC. The adjacency case uses the separate live rejection-demo intents.</p><select value={attack} onChange={e => setAttack(e.target.value as Attack)}><option value="siphon">Siphon 20 USDC</option><option value="adjacency">Non-adjacent seats</option><option value="count">Wrong count</option></select><button className="secondary" disabled={disabled || !proposal} onClick={() => void settle(attack)}>Submit dishonest proposal</button></details>
          </section>
        </div>
        {(status !== 'idle' || rejection) && <Validation key={`${status}:${txHash}`} status={status} hash={txHash} rejection={rejection} />}
        <section className="history"><div className="panel-heading"><h2>Past settlements</h2><span className="eyebrow">Public receipts</span></div><div className="history-list">{getSettlements(market).map(r => <button key={r.hash} onClick={() => void openReceipt(r.hash).catch(e => setNotice(e.message))}><span className="mono">{r.hash.slice(0, 14)}…</span><span className="mono">{r.participants} participants / block {r.block}</span><span>Open receipt ↗</span></button>)}</div></section>
      </section>}
      {receipt && <section ref={receiptPanel} className="receipt-section"><div className="section-heading"><div><span className="eyebrow passed">Settlement confirmed</span><h2>Different tickets.<br />Every condition met.</h2></div><span className="receipt-stamp passed">✓</span></div><a className="hash" href={`${EXPLORER}/tx/${receipt.hash}`} target="_blank" rel="noreferrer">{receipt.hash} ↗</a><p className="receipt-count mono">{receipt.ticketTransfers} ticket transfers · {receipt.usdcTransfers} USDC transfers · 1 transaction</p><table className="receipt-table"><thead><tr><th>Participant</th><th>Before / offered</th><th>After / received</th><th>USDC net</th></tr></thead><tbody>{receipt.participants.map((p, n) => <tr key={`${p.owner}:${n}`}><td className="mono">{truncateAddress(p.owner)}</td><td className="mono">{p.offered.map(id => `#${id}`).join(', ') || '—'}</td><td className="mono">{p.receives.map(id => `#${id}`).join(', ') || '—'}</td><td className="mono">{BigInt(p.netPayment) > 0n ? '−' : BigInt(p.netPayment) < 0n ? '+' : ''}{formatUSDC(BigInt(p.netPayment) < 0n ? -BigInt(p.netPayment) : BigInt(p.netPayment))}</td></tr>)}</tbody><tfoot><tr><td colSpan={3}>Σ =</td><td className="mono passed">{formatUSDC(BigInt(receipt.netSum))}</td></tr></tfoot></table><p>{receipt.independent ? SOLVER_NOTE : 'Submitted by a participant wallet.'} <span className="mono">{truncateAddress(receipt.proposer)}</span></p><p className="quiet">Ticket recipients are checked against receipt logs. USDC transfer count excludes native gas. A different proposer address alone does not establish that participant browsers were offline.</p><div className="receipt-actions"><a className="secondary" href={`${EXPLORER}/tx/${receipt.hash}`} target="_blank" rel="noreferrer">View on Arc explorer ↗</a><button className="secondary" onClick={() => void navigator.clipboard.writeText(receipt.hash).then(() => setNotice('Hash copied.')).catch(() => setNotice('Clipboard unavailable. Select and copy the displayed hash.'))}>Copy hash</button></div><div className="redeem-list">{receipt.participants.filter(p => equal(p.owner, account)).flatMap(p => p.receives).map(id => { const t = tickets.find(t => t.tokenId === id); return <div key={id}><span className="mono">Ticket #{id}</span>{t?.status === 1 ? <span className="badge">USED</span> : <button disabled={disabled || !t || !equal(t.owner, account)} onClick={() => void action('Redeem', async address => { await track(await redeemTicket(address, BigInt(id))); await refresh(true); })}>Redeem</button>}</div>; })}</div><p className="quiet">Redeem marks your ticket used permanently. Only its current holder can redeem it.</p></section>}
    </main><footer className="site-footer"><span className="wordmark">RESHUFFLE ↔</span><p>Swap tickets without selling first.<br />Every condition you sign is checked on-chain.</p><span className="mono">ARC TESTNET / USDC</span></footer>
  </div>;
}
