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
import { getChainTimestamp, getTicketHolder, getChainBlockNumber } from '@/lib/chain-reads';
import { requestTicketImports } from '@/lib/wallet-nfts';
import { FREE_TICKETS_LABEL, WALLET_IMPORT_NOTE } from '@/lib/ui-copy';
import { walletActionMessage } from '@/lib/wallet-errors';
import { settlementShape } from '@/lib/settlement-shape';
import { CONTRACTS } from '@/lib/config';
import { getWalletClient, approveNFTsForEscrow, depositTickets, withdrawTickets, signAndCommitIntent, revokeIntent, submitSettlement, approveUSDC, redeemTicket, type IntentParams } from '@/lib/contracts';
import { findSettlement, findPoolSettlement, type SettlementProposal, type SolveEvidence } from '@/lib/solve-api';
import { formatUSDC, truncateAddress } from '@/lib/format';
import { restoreIntent, type MarketSnapshot, type ChainReceipt, type ChainTicket } from '@/lib/market-types';
import { HERO_TITLE_LINES, EMPTY_RESULT, POOL_NOTE, condition, EXPLORER, POOL_LABEL, RANKING_RULE, SOLVER_NOTE } from '@/lib/ui-copy';
import { dishonestProposal, namedRejection, simulate, type Attack, type NamedRejection } from '@/lib/proposal-controls';
import AnimatedTicketIcon from './AnimatedTicketIcon';
import IntentBuilder from './IntentBuilder';
import Validation from './Validation';
import MatchingStatus from './MatchingStatus';
import PoolDialog from './PoolDialog';
import JudgeControls, { type BudgetChange, type Revocation } from './JudgeControls';
import AgentDrawer from './AgentDrawer';
import { automaticSelection, latestRequest } from '@/lib/matching-status';
import { waitForIndexed, SubgraphLagTimeout } from '@/shared/graph';
import { getMarketSnapshot, getIntentPool, getTicketsFor, getSettlements, getTicketsApproved, getTicketDepositor, getUSDCAllowance, getUnusedNonce, getSettlementReceipt, waitForReceipt, waitForSuccess, ticketHolder as holder } from '@/lib/chain-reads';
import { nextRecordedNonce } from '@/lib/intent-draft';
import rejectionDemo from '@/deployments/act-three.json';

import ConnectWalletButton from '@/component/connectWallet/ConnectWalletButton';
import SpecularButton from './SpecularButton';

const scrollTo = (element: HTMLElement | null) => element?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
const equal = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const receivedTickets = (receipt: ChainReceipt, address: Address) => receipt.status === 'success'
  ? [...new Set(receipt.participants.filter(p => equal(p.owner, address)).flatMap(p => p.receives))]
  : [];
async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? 'Service unavailable');
  return body;
}

export default function Market() {
  const wallet = useWallet();
  const { account, runWithWallet } = wallet;
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [readError, setReadError] = useState('');
  const [opened, setOpened] = useState(false);
  const [poolOpen, setPoolOpen] = useState(false);
  const [searchDetailsOpen, setSearchDetailsOpen] = useState(false);
  const [matchDetailsOpen, setMatchDetailsOpen] = useState(false);
  const [selected, setSelected] = useState<Hex[]>([]);
  const [automatic, setAutomatic] = useState(true);
  const [proposal, setProposal] = useState<SettlementProposal | null>(null);
  const [evidence, setEvidence] = useState<SolveEvidence | null>(null);
  const [solverError, setSolverError] = useState('');
  const [solving, setSolving] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [txHash, setTxHash] = useState<Hex>();
  // Non-null while waiting for the subgraph to reach a confirmed transaction's block.
  const [indexingBlock, setIndexingBlock] = useState<bigint | null>(null);
  const [status, setStatus] = useState('idle');
  const [rejection, setRejection] = useState<NamedRejection | null>(null);
  const [receipt, setReceipt] = useState<ChainReceipt | null>(null);
  const [swapImport, setSwapImport] = useState<{ hash: Hex; owner: Address; message: string } | null>(null);
  const [nftClaim, setNftClaim] = useState<{ owner: Address; tokenIds: string[]; hashes: Hex[]; message: string } | null>(null);
  const [approved, setApproved] = useState(false);
  const [attack, setAttack] = useState<Attack>('siphon');
  const [resetEnabled, setResetEnabled] = useState(false);
  const [operator, setOperator] = useState('');
  const [currentView, setCurrentView] = useState<'home' | 'events' | 'workspace'>('home');

  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash;
      if (hash === '#workspace') {
        setCurrentView('workspace');
      } else if (hash === '#events' || hash === '#market') {
        setCurrentView('events');
      } else if (hash === '#home' || hash === '') {
        setCurrentView('home');
      }
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    window.addEventListener('popstate', handleHash);
    return () => {
      window.removeEventListener('hashchange', handleHash);
      window.removeEventListener('popstate', handleHash);
    };
  }, []);

  const navigateTo = (view: 'home' | 'events' | 'workspace') => {
    setCurrentView(view);
    if (view === 'workspace') {
      window.history.pushState(null, '', '#workspace');
    } else if (view === 'events') {
      window.history.pushState(null, '', '#events');
    } else {
      window.history.pushState(null, '', '#home');
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const workspace = useRef<HTMLElement>(null);
  const receiptPanel = useRef<HTMLElement>(null);
  const activeAction = useRef(false);
  const searchVersion = useRef(0);
  const searchInFlight = useRef(false);
  // Highest block the subgraph was confirmed to have indexed after one of our writes.
  const floor = useRef(0n);
  // The intent the Agent drawer is answering about, and the chain head it is compared against.
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentHash, setAgentHash] = useState<Hex | null>(null);
  const [chainBlock, setChainBlock] = useState<string | null>(null);

  const runSolver = useCallback(async (hashes: Hex[], wholePool = false) => {
    const version = ++searchVersion.current;
    searchInFlight.current = true;
    setSolving(true); setSolverError('');
    try {
      if (!wholePool && (hashes.length < 2 || hashes.length > 4)) throw new Error('Select 2–4 live intents for this bounded search.');
      // The floor carries into the search: after one of our writes the pool must not be
      // searched at a block that predates it, or the solver reasons about a market in which
      // the user's own commit or revocation has not happened.
      const result = wholePool ? await findPoolSettlement(floor.current || undefined) : await findSettlement(hashes.map(hash => ({ hash })), floor.current || undefined);
      if (version !== searchVersion.current) return;
      setProposal(result.proposal); setEvidence(result.evidence);
    } catch (e) { if (version === searchVersion.current) { setProposal(null); setEvidence(null); setSolverError(e instanceof Error && /^(Select|Live pool exceeds)/.test(e.message) ? e.message : 'Solver unreachable. Public chain reads remain available. Retry the solver.'); } }
    finally { if (version === searchVersion.current) { searchInFlight.current = false; setSolving(false); } }
  }, []);
  const refresh = useCallback(async (fresh = false, minBlock?: bigint) => {
    try {
      const data = await getMarketSnapshot(fresh, minBlock);
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
  // The head comes from RPC while the pool comes from the indexer; showing both is how the
  // drawer can display lag instead of implying there is none.
  useEffect(() => {
    if (!agentOpen) return;
    let cancelled = false;
    const read = () => void getChainBlockNumber().then(value => { if (!cancelled) setChainBlock(value.toString()); }).catch(() => {});
    read();
    const timer = setInterval(read, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [agentOpen]);
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
  // Every write goes through indexed(), so the indexing wait lives here rather than at each
  // call site. Without it the refresh that follows can read a pool that predates the user's
  // own transaction, and their deposit, revocation or settlement appears not to have happened.
  //
  // waitForIndexed is given the RECEIPT's block, never getBlockNumber(): Arc's public RPC is
  // load balanced and its reported head can lag the subgraph (see docs/graph-acceptance.md).
  //
  // The block it reached becomes the freshness floor for the following read (trust rule 2).
  // It is only recorded when the wait succeeded: asking the server for a block the indexer
  // never reached would turn a confirmed transaction into a failed read.
  const indexed = async (receipt: { blockNumber: bigint }) => {
    setIndexingBlock(receipt.blockNumber);
    try {
      await waitForIndexed(receipt.blockNumber);
      floor.current = receipt.blockNumber;
    } catch (error) {
      // Indexing lag must not discard a confirmed transaction: it is already on-chain and the
      // receipt panel still shows it. Surface the delay and let the read proceed.
      setReadError(error instanceof SubgraphLagTimeout
        ? `The indexer is behind (${error.indexed} of ${error.target}). Chain state is confirmed; the pool view may lag.`
        : 'Indexer unavailable; the pool view may lag behind your transaction.');
    } finally {
      setIndexingBlock(null);
    }
    return receipt;
  };
  const track = async (hash: Hex) => {
    setTxHash(hash);
    return indexed(await waitForSuccess(hash));
  };
  // Judge controls need no wallet: the transactions are signed server-side with the seeded
  // participants' own keys, because revoke() is owner-only. Same busy gating as action(), so a
  // judge cannot start one while a wallet action is mid-flight.
  const operate = async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
    if (activeAction.current) throw new Error('Another action is already running.');
    activeAction.current = true; setBusy(label); setNotice(''); setTxHash(undefined);
    try { return await fn(); }
    finally { setBusy(''); activeAction.current = false; }
  };
  // Both judge controls end the same way: wait for the indexer to reach the block the change
  // landed in, then re-read the pool at that floor. Without the wait the judge changes a
  // condition and the pool still shows the old one, which reads as the control not working.
  const judged = async (block: string, notice: string) => {
    await indexed({ blockNumber: BigInt(block) });
    await refreshWritten();
    setProposal(null); setEvidence(null); setAutomatic(true);
    setNotice(notice);
  };
  const applyJudgeBudget = (hash: Hex, usdc: number) => operate('Apply budget', async () => {
    const change = await jsonFetch<BudgetChange>('/api/demo/budget', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intentHash: hash, maxNetPayUsdc: usdc }),
    });
    setTxHash(change.commitTx);
    // The budget lives in the hash, so the changed intent is a NEW intent. Any selection
    // naming the old hash has to follow it, or the next bounded search asks about an intent
    // that is now revoked.
    setSelected(current => current.map(h => (equal(h, change.oldHash) ? change.newHash : h)));
    // The Agent drawer must follow too: after this the old hash is revoked, and a diagnosis of
    // it would answer about an intent that no longer exists.
    setAgentHash(current => (equal(current, change.oldHash) ? change.newHash : current));
    await judged(change.commitBlock, `Budget changed on-chain. The intent is now ${change.newHash.slice(0, 10)}… with a signed limit of ${usdc} USDC.`);
    return change;
  });
  const revokeJudgeIntent = (hash: Hex) => operate('Revoke participant', async () => {
    const result = await jsonFetch<Revocation>('/api/demo/revoke', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intentHash: hash }),
    });
    setTxHash(result.revokeTx);
    setSelected(current => current.filter(h => !equal(h, result.intentHash)));
    setAgentHash(current => (equal(current, result.intentHash) ? null : current));
    await judged(result.revokeBlock, 'Intent revoked on-chain. It is out of the pool, and any reshuffle that needed it is no longer available.');
    return result;
  });
  // The read that follows a write. Separate from refresh() so the periodic poll and the retry
  // button stay unfloored — they are not reading back a transaction of ours.
  const refreshWritten = () => refresh(true, floor.current || undefined);
  const claimDemo = () => action(FREE_TICKETS_LABEL, async address => {
    const { message } = await jsonFetch<{ message: string }>(`/api/demo/tickets?address=${address}`);
    const signature = await getWalletClient().signMessage({ account: address, message });
    setNotice('Issuing your test tickets. Waiting for Arc Testnet confirmation…');
    const result = await jsonFetch<{ tokenIds: string[]; hashes: Hex[] }>('/api/demo/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, signature }) });
    const last = result.hashes.at(-1);
    setTxHash(last);
    setNotice(`Tickets ${result.tokenIds.map(id => `#${id}`).join(', ')} are confirmed. Open MetaMask to add them to its NFTs tab.`);
    // The mint was sent by the demo operator, not this wallet, but the pool read that follows
    // is still a read-back of it, so it waits for the indexer like any other write.
    if (last) await indexed(await waitForReceipt(last));
    setNftClaim({ owner: address, ...result, message: 'Requesting NFT display in MetaMask...' });
    const refreshRequest = refreshWritten();
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
    setNotice(`Ticket #${t.tokenId}: ${mode} confirmed.`); await refreshWritten();
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
      setNotice('Your selected tickets are already deposited.'); await refreshWritten(); return;
    }
    if (!await getTicketsApproved(address)) {
      setNotice('Approve ticket access in your wallet. The batch deposit will follow after approval confirms.');
      await track(await approveNFTsForEscrow(address)); setApproved(true);
    }
    setNotice(`Confirm one deposit transaction for ${pending.length} selected ticket${pending.length === 1 ? '' : 's'}.`);
    await track(await depositTickets(address, pending));
    setNotice(`Deposited ${pending.length} ticket${pending.length === 1 ? '' : 's'} together: ${pending.map(id => `#${id}`).join(', ')}.`);
    await refreshWritten();
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
    setNotice('Intent committed. Matching will start automatically as soon as the refreshed pool includes your request.'); await refreshWritten();
  });
  const openReceipt = async (hash: Hex) => {
    const result = await getSettlementReceipt(hash);
    if (result.status === 'success') { setReceipt(result); setTimeout(() => scrollTo(receiptPanel.current), 50); }
    return result;
  };
  const importReplacementTickets = async (confirmed: ChainReceipt, address: Address) => {
    const ids = receivedTickets(confirmed, address);
    if (!ids.length) return;
    setSwapImport({ hash: confirmed.hash, owner: address, message: 'Swap confirmed. Requesting NFT display in MetaMask...' });
    const message = await requestTicketImports(address, ids);
    setSwapImport({ hash: confirmed.hash, owner: address, message });
  };
  const settle = (malicious?: Attack) => action(malicious ? 'Submit dishonest proposal' : 'Propose and settle', async address => {
    setStatus('preparing'); setRejection(null); setReceipt(null); setSwapImport(null);
    let broadcast = false;
    try {
      let hashes = proposal?.legs.map(leg => leg.intentHash) ?? selected;
      if (malicious === 'adjacency') hashes = rejectionDemo.control.proposal.legs.map(l => l.intentHash as Hex);
      const fresh = await findSettlement(hashes.map(hash => ({ hash })), floor.current || undefined);
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
      setProposal(null); setEvidence(null);
      // A reverted proposal changed no state, so there is nothing for the indexer to catch up
      // to; a confirmed one settled intents and moved custody, and the pool must show that.
      if (r.status === 'success') await indexed(r);
      const refreshRequest = refreshWritten();
      if (r.status === 'success' && verified.status === 'success') await importReplacementTickets(verified, address);
      await refreshRequest;
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
  const participants = [...new Set(market?.intents.map(i => i.owner.toLowerCase()) ?? [])].sort();
  const walletLabel = (address: string) => equal(address, account) ? 'You' : participants.includes(address.toLowerCase()) ? `Wallet ${participants.indexOf(address.toLowerCase()) + 1}` : truncateAddress(address);
  const disabled = !!busy || wallet.isConnecting;
  const replacementIds = receipt && account ? receivedTickets(receipt, account) : [];
  const selectIntent = (hash: Hex) => { setAutomatic(false); searchVersion.current++; searchInFlight.current = false; setSolving(false); setSelected(s => s.includes(hash) ? s.filter(h => h !== hash) : [...s, hash]); setProposal(null); setEvidence(null); setSolverError(''); };

  return <div className={`reshuffle-ui ${currentView !== 'home' ? 'page-market' : 'page-home'}`}>
    <header className={`site-header ${currentView !== 'home' ? 'is-market' : ''}`}>
      <div className="header-brand">
        <Image
          src={logoImg}
          alt="RESHUFFLE"
          height={48}
          priority
          className="header-logo"
          onClick={() => navigateTo('home')}
          style={{ cursor: 'pointer' }}
        />
      </div>
      <nav className="two-line-nav" aria-label="Main navigation">
        <button
          type="button"
          className={`two-line-nav-item ${currentView === 'home' ? 'active' : ''}`}
          onClick={() => navigateTo('home')}
        >
          Home
        </button>
        <button
          type="button"
          className={`two-line-nav-item ${currentView !== 'home' ? 'active' : ''}`}
          onClick={() => navigateTo('events')}
        >
          Market
        </button>
      </nav>
      <div className="header-actions">
        <ConnectWalletButton />
      </div>
    </header>
    <main>
      {currentView === 'home' && (
        <section className="hero">
          <div className="hero-grid">
            <div className="hero-text-block">
              <div className="eyebrow">An outcome market for tickets</div>
              <h1>{HERO_TITLE_LINES[0]}<br /><span>{HERO_TITLE_LINES[1]}</span></h1>
              <div className="hero-cta-wrap">
                <SpecularButton
                  size="lg"
                  radius={18}
                  tint="#ffffff"
                  tintOpacity={1}
                  blur={0}
                  textColor="#08080a"
                  lineColor="#ea7833"
                  baseColor="#e66e4b"
                  intensity={1}
                  shineSize={10}
                  shineFade={40}
                  thickness={1.5}
                  speed={0.35}
                  followMouse
                  proximity={250}
                  autoAnimate={false}
                  onClick={() => navigateTo('events')}
                >
                  Explore Events
                </SpecularButton>
              </div>
            </div>
            <div className="hero-visual">
              <div className="hero-icon-card">
                <AnimatedTicketIcon />
              </div>
            </div>
          </div>
        </section>
      )}
      {currentView === 'events' && (
        <section id="events" className="event-section">
          <div className="section-heading">
            <div>
              <button
                type="button"
                className="back-nav-btn"
                onClick={() => navigateTo('home')}
              >
                ← Back to Home
              </button>
              <h2>Choose a night.<br />Keep your options.</h2>
            </div>
            <p><br /></p>
          </div>
          <div className="posters">
            <button
              className="poster poster-live"
              disabled={!market}
              aria-busy={!market && !readError}
              aria-describedby="event-preload-status"
              onClick={() => navigateTo('workspace')}
            >
              <span className="poster-top mono">RESHUFFLE PRESENTS / EVENT 1</span>
              <span className="poster-photo"><Image src={maydayPoster} alt="Mayday concert poster" fill sizes="(max-width: 720px) 84vw, 28vw" /></span>
              <span className="poster-title">AFTER<br />HOURS</span>
              <span className="poster-sub">Demo concert · issuer-native tickets</span>
              <span className="poster-dates mono">{sessions.length ? sessions.map(n => `SESSION ${n}`).join(' / ') : 'READING SESSIONS'}</span>
              <span className="poster-status"><span className="mono">{market ? `${live.length} ${POOL_LABEL}` : 'Reading live intents…'}</span><span>Open workspace ↗</span></span>
            </button>
            {[{ name: 'INTERLUDE', photo: sarahPoster, alt: 'Sarah Kang in Seoul concert poster' }, { name: 'ENCORE', photo: taylorPoster, alt: 'Taylor Swift The Eras Tour concert poster' }].map(({ name, photo, alt }, n) => <div key={name} className="poster poster-inert" aria-disabled="true"><span className="poster-top mono">UPCOMING PROGRAMME / 0{n + 2}</span><span className="poster-photo"><Image src={photo} alt={alt} fill sizes="(max-width: 720px) 84vw, 28vw" /></span><span className="poster-title">{name}</span><span className="poster-sub">Event details to be announced</span><span className="poster-dates mono">VENUE & DATES UNANNOUNCED</span><span className="poster-status">No live intents</span></div>)}
          </div>
          <p id="event-preload-status" className="quiet" role="status" aria-live="polite">{market ? `Ticket positions and intent commitments loaded for all deployed events / Arc block ${market.blockNumber}.` : readError ? 'Event data could not be loaded. Retry the public reads below.' : 'Preloading public ticket positions and intent commitments for all deployed events. The event opens as soon as its data is ready.'}</p>
          <p className="quiet">Event names are demo presentation labels. Session IDs and ticket metadata come from the deployed contracts; no venue dates or prices are recorded on-chain.</p>
          {readError && <p role="alert" className="read-error">{readError} <button onClick={() => void refresh(true)}>Retry public reads</button></p>}
        </section>
      )}
      {currentView === 'workspace' && (
        <>
          {market ? (
            <section id="workspace" ref={workspace} className="workspace-section">
              <div className="section-heading">
                <div>
                  <button
                    type="button"
                    className="back-nav-btn"
                    onClick={() => navigateTo('events')}
                  >
                    ← Back to Events
                  </button>
                  <span className="eyebrow">The workspace / Event 1</span>
                  <h2>Keep the ticket.<br />Change the outcome.</h2>
                </div>
                <div>
                  <p className="mono" role="status" aria-live="polite">{indexingBlock !== null ? `INDEXING BLOCK ${indexingBlock}…` : market ? `ARC BLOCK ${market.blockNumber} / ${market.source === 'graph' ? 'VIA THE GRAPH' : 'VIA DIRECT RPC READS'}` : 'READING ARC'}</p>
                  <button className="text-button" onClick={() => void refresh(true)}>Refresh public state ↻</button>
                </div>
              </div>
              <div className="network-note">USDC pays for both settlement and native gas on Arc. You don’t need a second token.</div>
              <div className="workspace-tools"><button className="secondary pool-toggle" aria-haspopup="dialog" aria-expanded={poolOpen} onClick={() => setPoolOpen(true)}>Intent pool ({live.length})</button><p className="quiet">See what others offer and want. Opening the list is optional; matching runs automatically.</p></div>
              <PoolDialog open={poolOpen} onClose={() => setPoolOpen(false)}>
                <p className="mono">{live.length} {POOL_LABEL}</p><p className="quiet">{POOL_NOTE}</p><div className="pool-list">{live.map((i, index) => <article key={i.hash} className="pool-row"><label><input type="checkbox" checked={selected.includes(i.hash)} disabled={disabled} onChange={() => selectIntent(i.hash)} /><span>{walletLabel(i.owner)} <span className="mono">/ Request {index + 1}</span></span></label><p>{condition(restoreIntent(i))}</p><details className="wallet-details"><summary>Wallet and transaction details</summary><a className="hash" href={`${EXPLORER}/address/${i.owner}`} target="_blank" rel="noreferrer">{i.owner}</a><a className="mono" href={`${EXPLORER}/tx/${i.commitTx}`} target="_blank" rel="noreferrer">Commit {i.commitTx.slice(0, 10)}… ↗</a></details><button className="text-button" onClick={() => { setAgentHash(i.hash); setAgentOpen(true); setPoolOpen(false); }}>Why no match?</button>{equal(i.owner, account) && <button disabled={disabled} onClick={() => void action('Revoke intent', async address => { await track(await revokeIntent(address, i.hash)); await refreshWritten(); setProposal(null); setEvidence(null); })}>Revoke my intent</button>}</article>)}</div>{!live.length && <p>No live requests yet. Submit an intent to join the pool.</p>}{!!market.hashMismatched.length && <p className="quiet" role="status">{market.hashMismatched.length} indexed {market.hashMismatched.length === 1 ? 'request is' : 'requests are'} excluded from this pool: the indexed fields do not re-hash to the id they were committed under, so they are not shown. <span className="mono">{market.hashMismatched.map(h => `${h.slice(0, 10)}…`).join(' ')}</span></p>}
                <div className="pool-dialog-actions">{!automatic && <><button className="secondary" disabled={disabled} onClick={() => { setAutomatic(true); setPoolOpen(false); }}>Resume automatic matching</button><button className="primary" disabled={disabled || solving || selected.length < 2 || selected.length > 4} onClick={() => { void runSolver(selected); setPoolOpen(false); }}>Search selected requests ({selected.length}/4)</button></>}</div>
              </PoolDialog>
              {(notice || busy) && <div className="activity" role="status"><strong>{busy || 'Activity'}</strong><p>{notice || 'Complete the request in your wallet. The original action continues automatically.'}</p>{txHash && <a className="hash" href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer">{txHash} ↗</a>}</div>}
              {nftClaim && equal(nftClaim.owner, account) && <section className="wallet-nft-import"><h3>Your free tickets</h3><p role="status">{nftClaim.message}</p><p className="quiet">{WALLET_IMPORT_NOTE}</p><span className="mono hash">NFT contract: {CONTRACTS.ticketNFT}</span><ul>{nftClaim.tokenIds.map((id, n) => <li key={id} className="mono">Token ID: {id} / <a href={`${EXPLORER}/tx/${nftClaim.hashes[n]}`} target="_blank" rel="noreferrer">Mint receipt</a></li>)}</ul><button className="secondary" disabled={disabled} onClick={() => void retryNFTImport()}>Add to wallet</button></section>}
              <div className="workspace-stack">
                {request && <MatchingStatus request={request} selected={selected} solving={solving} error={readError || solverError} proposal={proposal} evidence={evidence} automatic={automatic} resume={() => setAutomatic(true)} busy={disabled} />}
                <IntentBuilder onConnect={async () => { await wallet.connect(); await refresh(true); }} connectionError={wallet.error} market={market} account={account} approved={approved} busy={disabled} onCustody={custody} onDepositSelected={depositSelected} onSign={sign} onDemo={claimDemo} onApprove={() => action('Approve tickets', async address => { await track(await approveNFTsForEscrow(address)); setApproved(true); })} />
                <section className="workspace-panel matching-panel"><div className="panel-heading"><h2>Matching</h2><span className="eyebrow">{automatic ? 'Automatic search' : 'Manual search'}</span></div>
                  <div className="solver-actions"><button className="secondary" disabled={solving || disabled || (automatic ? live.length < 2 : selected.length < 2 || selected.length > 4)} onClick={() => void runSolver(selected, automatic)}>{solving ? 'Reading and searching…' : automatic ? 'Check all intents' : 'Run solver'} <span className="mono">({automatic ? `${live.length} in pool` : `${selected.length}/4`})</span></button><button className="text-button" onClick={() => { setAgentHash(current => current ?? request?.hash ?? live[0]?.hash ?? null); setAgentOpen(true); }}>Ask the agent</button>{resetEnabled && equal(account, operator) && <button className="text-button" disabled={disabled} onClick={() => void reset()}>Reset demo</button>}</div>
                  <p className="quiet">{automatic ? 'Automatic matching searches all live event intents. You do not need to choose participants. Each candidate contains two to four participants; public-state refreshes retry the search while this page is open.' : 'Manual search is on. Choose 2–4 requests, then Run solver.'}</p>{!automatic && !request && <button className="text-button" disabled={disabled} onClick={() => setAutomatic(true)}>Resume automatic matching</button>}
                  {solving && <p className="quiet" role="status">Checking current intents and ticket availability...</p>}{evidence?.pool && <details className="search-details" open={searchDetailsOpen} onToggle={event => setSearchDetailsOpen(event.currentTarget.open)}><summary>Search details and evidence</summary><p className="quiet mono">{evidence.pool.liveIntents} live requests / {evidence.pool.searchableIntents} within ticket-count limits / {evidence.pool.excludedIntents} excluded with reasons. Maximum 4 participants per candidate, 100 candidates, 2-second search budget. <a href={`/api/evidence/${evidence.id}`} target="_blank" rel="noreferrer">View search evidence and exclusion reasons</a></p></details>}{evidence?.search && !solving && <p className="quiet">{evidence.search.termination === 'complete' ? 'Search completed within the configured bounds.' : 'Search budget reached. Further combinations may remain unchecked.'}</p>}{solverError && <p role="alert">{solverError}</p>}{evidence && !proposal && !solving && <div className="matching-empty" role="status"><h3>Waiting for a match</h3><p>{EMPTY_RESULT}. New requests may make a swap possible; you can wait or try another selection.</p>{evidence.candidatesExcluded.some(i => /capacity|allowance/i.test(i.reason)) && <p>Insufficient USDC balance or allowance for a candidate. Update spending capacity before settling.</p>}</div>}
                  {proposal && <div className="candidate"><p className="eyebrow">{solving ? 'Rechecking previous match' : evidence?.simulationResult?.success ? 'Candidate found - awaiting settlement' : 'Candidate needs rechecking'}</p><p className="quiet">{solving ? 'The previous result stays visible while current conditions are checked. Settlement is unavailable until this search finishes.' : evidence?.simulationResult?.success ? 'A candidate is not a completed swap. Propose and settle submits it for on-chain validation.' : 'This candidate has not passed simulation and cannot be submitted yet.'}</p><div className="panel-heading"><strong>{settlementShape(proposal)}</strong><span className="mono">{proposal.candidatesFound} candidates</span></div><details className="search-details" open={matchDetailsOpen} onToggle={event => setMatchDetailsOpen(event.currentTarget.open)}><summary>Why this match?</summary><p className="quiet">{RANKING_RULE}. Ties: fewer participants, then ordered intent hashes. Source block <span className="mono">{evidence?.source.blockNumber}</span>.</p></details><table className="net-table"><thead><tr><th>Participant</th><th>USDC net</th></tr></thead><tbody>{proposal.legs.map(l => <tr key={l.intentHash}><td><a href={`${EXPLORER}/address/${l.owner}`} title={l.owner} target="_blank" rel="noreferrer">{walletLabel(l.owner)}</a></td><td className="mono">{l.netPayment > 0n ? '−' : l.netPayment < 0n ? '+' : ''}{formatUSDC(l.netPayment < 0n ? -l.netPayment : l.netPayment)}</td></tr>)}</tbody><tfoot><tr><td>Σ</td><td className="mono">{formatUSDC(proposal.legs.reduce((n, l) => n - l.netPayment, 0n))}</td></tr></tfoot></table></div>}
                  <button className="primary full" disabled={disabled || solving || !proposal || !evidence?.simulationResult?.success} onClick={() => void settle()}>Propose and settle <span>↗</span></button><p className="quiet">When a match is ready, click Propose and settle and confirm the transaction in your wallet. The proposer pays gas in USDC. Participants do not sign their intents again. Your swap is complete only after the receipt confirms success.</p>
                  <JudgeControls busy={disabled} label={walletLabel} onBudget={applyJudgeBudget} onRevoke={revokeJudgeIntent} />
                  <details className="dishonest"><summary>Submit dishonest proposal ▾</summary><p>Intentionally submit a failing transaction. The proposer pays its gas in USDC. The adjacency case uses the separate live rejection-demo intents.</p><select value={attack} onChange={e => setAttack(e.target.value as Attack)}><option value="siphon">Siphon 20 USDC</option><option value="adjacency">Non-adjacent seats</option><option value="count">Wrong count</option></select><button className="secondary" disabled={disabled || solving || !proposal} onClick={() => void settle(attack)}>Submit dishonest proposal</button></details>
                </section>
              </div>
              {(status !== 'idle' || rejection) && <Validation key={`${status}:${txHash}`} status={status} hash={txHash} rejection={rejection} />}
              <details className="history"><summary className="panel-heading"><span>Past settlements</span><span className="mono">{getSettlements(market).length} recorded swaps</span></summary><div className="history-list">{getSettlements(market).map((r, index) => <button key={r.hash} title={r.hash} onClick={() => void openReceipt(r.hash).catch(e => setNotice(e.message))}><span>Swap {getSettlements(market).length - index}</span><span>{r.participants} participants</span><span>Open receipt ↗</span></button>)}</div>{!getSettlements(market).length && <p className="quiet">No settlements recorded yet.</p>}</details>
            </section>
          ) : (
            <section className="workspace-section">
              <button type="button" className="back-nav-btn" onClick={() => navigateTo('events')}>← Back to Events</button>
              <p className="quiet">{readError || 'Loading event workspace…'}</p>
              {readError && <button onClick={() => void refresh(true)}>Retry public reads</button>}
            </section>
          )}
          {receipt && <section ref={receiptPanel} className="receipt-section"><div className="section-heading"><div><span className="eyebrow passed">Settlement confirmed</span><h2>Different tickets.<br />Every condition met.</h2></div><span className="receipt-stamp passed">✓</span></div><a className="hash" href={`${EXPLORER}/tx/${receipt.hash}`} target="_blank" rel="noreferrer">{receipt.hash} ↗</a><p className="receipt-count mono">{receipt.ticketTransfers} ticket transfers · {receipt.usdcTransfers} USDC transfers · 1 transaction</p><table className="receipt-table"><thead><tr><th>Participant</th><th>Before / offered</th><th>After / received</th><th>USDC net</th></tr></thead><tbody>{receipt.participants.map((p, n) => <tr key={`${p.owner}:${n}`}><td><a href={`${EXPLORER}/address/${p.owner}`} title={p.owner} target="_blank" rel="noreferrer">{walletLabel(p.owner)}</a></td><td className="mono">{p.offered.map(id => `#${id}`).join(', ') || '—'}</td><td className="mono">{p.receives.map(id => `#${id}`).join(', ') || '—'}</td><td className="mono">{BigInt(p.netPayment) > 0n ? '−' : BigInt(p.netPayment) < 0n ? '+' : ''}{formatUSDC(BigInt(p.netPayment) < 0n ? -BigInt(p.netPayment) : BigInt(p.netPayment))}</td></tr>)}</tbody><tfoot><tr><td colSpan={3}>Σ =</td><td className="mono passed">{formatUSDC(BigInt(receipt.netSum))}</td></tr></tfoot></table><p>{receipt.independent ? SOLVER_NOTE : 'Submitted by a participant wallet.'} <a href={`${EXPLORER}/address/${receipt.proposer}`} title={receipt.proposer} target="_blank" rel="noreferrer">{walletLabel(receipt.proposer)}</a></p><p className="quiet">Ticket recipients are checked against receipt logs. USDC transfer count excludes native gas. A different proposer address alone does not establish that participant browsers were offline.</p><div className="receipt-actions"><a className="secondary" href={`${EXPLORER}/tx/${receipt.hash}`} target="_blank" rel="noreferrer">View on Arc explorer ↗</a><button className="secondary" onClick={() => void navigator.clipboard.writeText(receipt.hash).then(() => setNotice('Hash copied.')).catch(() => setNotice('Clipboard unavailable. Select and copy the displayed hash.'))}>Copy hash</button></div>{replacementIds.length > 0 && <section className="wallet-nft-import swap-nft-import">
            <h3>Your replacement tickets</h3>
            <p>Settlement transferred these tickets directly to your wallet. No withdrawal is needed.</p>
            <p role="status">{swapImport?.hash === receipt.hash && equal(swapImport.owner, account) ? swapImport.message : 'Add your received tickets to the wallet NFT display.'}</p>
            <p className="quiet">{WALLET_IMPORT_NOTE}</p>
            <span className="mono hash">NFT contract: {CONTRACTS.ticketNFT}</span>
            <ul>{replacementIds.map(id => <li key={id} className="mono">Token ID: {id}</li>)}</ul>
            <button className="secondary" disabled={disabled} onClick={() => void action('Add replacement tickets to wallet', address => importReplacementTickets(receipt, address))}>Add to wallet</button>
          </section>}<div className="redeem-list">{receipt.participants.filter(p => equal(p.owner, account)).flatMap(p => p.receives).map(id => { const t = tickets.find(t => t.tokenId === id); return <div key={id}><span className="mono">Ticket #{id}</span>{t?.status === 1 ? <span className="badge">USED</span> : <button disabled={disabled || !t || !equal(t.owner, account)} onClick={() => void action('Redeem', async address => { await track(await redeemTicket(address, BigInt(id))); await refreshWritten(); })}>Redeem</button>}</div>; })}</div><p className="quiet">Redeem marks your ticket used permanently. Only its current holder can redeem it.</p></section>}
          <AgentDrawer open={agentOpen} onClose={() => setAgentOpen(false)} intentHash={agentHash} chainBlock={chainBlock} indexingBlock={indexingBlock} label={walletLabel} />
        </>
      )}
    </main><footer className="site-footer"><span className="wordmark">RESHUFFLE ↔</span><p>Swap tickets without selling first.<br />Every condition you sign is checked on-chain.</p><span className="mono">ARC TESTNET / USDC</span></footer>
  </div>;
}
