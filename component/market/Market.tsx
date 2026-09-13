"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Image from 'next/image';
import sarahPoster from '@/lib/sarah_concert_poster.jpg';
import maydayPoster from '@/lib/mayday_concert_poster.jpg';
import taylorPoster from '@/lib/taylor_concert_poster.png';
import logoImg from '@/public/logo.png';
import { type Address, type Hex } from 'viem';
import { useWallet } from '@/lib/hooks/useWallet';
import { validateNewIntentTiming, selectedClass, sessionLabel } from '@/lib/event-schedule';
import { getChainTimestamp, getTicketHolder, getChainBlockNumber } from '@/lib/chain-reads';
import { requestTicketImports } from '@/lib/wallet-nfts';
import { FREE_TICKETS_LABEL, WALLET_IMPORT_NOTE } from '@/lib/ui-copy';
import { walletActionMessage } from '@/lib/wallet-errors';
import { settlementShape } from '@/lib/settlement-shape';
import { CONTRACTS, CHAIN } from '@/lib/config';
import { getWalletClient, approveNFTsForEscrow, depositTickets, withdrawTickets, signAndCommitIntent, revokeIntent, submitSettlement, approveUSDC, redeemTicket, type IntentParams } from '@/lib/contracts';
import { findSettlement, findPoolSettlement, type SettlementProposal, type SolveEvidence } from '@/lib/solve-api';
import { SolveRequestError, solverErrorMessage } from '@/lib/solve-errors';
import { formatUSDC, truncateAddress } from '@/lib/format';
import { restoreIntent, type ChainReceipt, type ChainTicket } from '@/lib/market-types';
import { HERO_TITLE_LINES, EMPTY_RESULT, POOL_NOTE, condition, EXPLORER, POOL_LABEL, RANKING_RULE, SOLVER_NOTE, maskClasses } from '@/lib/ui-copy';
import { dishonestProposal, namedRejection, isSimulationRejection, simulate, type Attack, type NamedRejection } from '@/lib/proposal-controls';
import AnimatedTicketIcon from './AnimatedTicketIcon';
import IntentBuilder from './IntentBuilder';
import Validation from './Validation';
import MatchingStatus from './MatchingStatus';
import PoolDialog from './PoolDialog';
import JudgeControls, { type BudgetChange, type Revocation } from './JudgeControls';
import AgentDrawer from './AgentDrawer';
import ActivityNotification from './ActivityNotification';
import EventLoadingDialog from './EventLoadingDialog';
import ClaimTickets from './ClaimTickets';
import { proposalForWallet, receiptOutcomes, receiptTitle, walletChangesTickets } from '@/lib/personal-swap';
import { automaticSelection, latestRequest } from '@/lib/matching-status';
import { matchUnavailable } from '@/lib/match-review';
import { waitForIndexed } from '@/shared/graph';
import { MarketFreshness } from '@/lib/market-freshness';
import { indexingMessage, INDEXING_PENDING } from '@/lib/ui-copy';
import { getMarketSnapshot, getIntentPool, getTicketsFor, getSettlements, getTicketsApproved, getTicketDepositor, getUSDCAllowance, getUnusedNonce, getSettlementReceipt, waitForReceipt, waitForSuccess, ticketHolder as holder } from '@/lib/chain-reads';
import { nextRecordedNonce } from '@/lib/intent-draft';
import { demoPriceQuote, DEMO_SECTION_PRICES } from '@/lib/demo-pricing';
import rejectionDemo from '@/deployments/act-three.json';

import ConnectWalletButton from '@/component/connectWallet/ConnectWalletButton';
import SpecularButton from './SpecularButton';

const scrollTo = (element: HTMLElement | null) => element?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
const equal = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init });
  const body = await r.json();
  if (!r.ok) throw Object.assign(new Error(body.error ?? 'Service unavailable'), { confirmed: body.confirmed });
  return body;
}

export default function Market() {
  const wallet = useWallet();
  const { account, runWithWallet } = wallet;
  const [freshness] = useState(() => new MarketFreshness(getMarketSnapshot, waitForIndexed));
  const { market, error: readError, indexingBlock } = useSyncExternalStore(freshness.subscribe, freshness.getSnapshot, freshness.getServerSnapshot);
  const refresh = freshness.refresh;
  const [opened, setOpened] = useState(false);
  const [poolOpen, setPoolOpen] = useState(false);
  const [seatMapOpen, setSeatMapOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [workflowView, setWorkflowView] = useState<'intent' | 'matching'>('intent');
  const [searchDetailsOpen, setSearchDetailsOpen] = useState(false);
  const [matchDetailsOpen, setMatchDetailsOpen] = useState(false);
  const [selected, setSelected] = useState<Hex[]>([]);
  const [wholePool, setWholePool] = useState(true);
  const [matchAfterCommit, setMatchAfterCommit] = useState(false);
  const [proposal, setProposal] = useState<SettlementProposal | null>(null);
  const [evidence, setEvidence] = useState<SolveEvidence | null>(null);
  const [solverError, setSolverError] = useState('');
  const [solving, setSolving] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [txHash, setTxHash] = useState<Hex>();
  const [confirmedWrite, setConfirmedWrite] = useState<{ block: string; hashes: Hex[] } | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [status, setStatus] = useState('idle');
  const [rejection, setRejection] = useState<NamedRejection | null>(null);
  const [receipt, setReceipt] = useState<ChainReceipt | null>(null);
  const [nftClaim, setNftClaim] = useState<{ owner: Address; tokenIds: string[]; hashes: Hex[]; message: string } | null>(null);
  const [approved, setApproved] = useState(false);
  const [attack, setAttack] = useState<Attack>('siphon');
  const [resetEnabled, setResetEnabled] = useState(false);
  const [operator, setOperator] = useState('');
  const [currentView, setCurrentView] = useState<'home' | 'events' | 'workspace' | 'tickets'>('home');

  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash;
      if (hash === '#workspace') {
        setCurrentView('workspace');
      } else if (hash === '#tickets') {
        setCurrentView('tickets');
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

  const navigateTo = (view: 'home' | 'events' | 'workspace' | 'tickets') => {
    setCurrentView(view);
    if (view === 'workspace') {
      if (window.location.hash !== '') {
        window.history.pushState(null, '', '#workspace');
      }
    } else if (view === 'tickets') {
      window.history.pushState(null, '', '#tickets');
    } else if (view === 'events') {
      window.history.pushState(null, '', '#events');
    } else {
      window.history.pushState(null, '', '#home');
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const workspace = useRef<HTMLElement>(null);
  const receiptPanel = useRef<HTMLElement>(null);
  const historyDialog = useRef<HTMLDialogElement>(null);
  const activeAction = useRef(false);
  const searchVersion = useRef(0);
  const searchInFlight = useRef(false);
  // The intent the Agent drawer is answering about, and the chain head it is compared against.
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentHash, setAgentHash] = useState<Hex | null>(null);
  const [chainBlock, setChainBlock] = useState<string | null>(null);
  const request = market ? latestRequest(market, account) : undefined;
  const requiredHash = request?.state === 1 && !request.expired ? request.hash : undefined;
  const unavailableMatch = matchUnavailable(proposal, evidence, market);
  const readyMatch = !!proposal && !!evidence?.simulationResult?.success && !unavailableMatch
    && (!account || (!!requiredHash && proposalForWallet(proposal, account, requiredHash)));

  const runSolver = useCallback(async (hashes: Hex[], wholePool = false) => {
    const snapshot = freshness.getSnapshot();
    if (snapshot.indexingBlock !== null || activeAction.current || searchInFlight.current) return;
    const version = ++searchVersion.current;
    searchInFlight.current = true;
    setSolving(true); setSolverError('');
    if (wholePool) setSelected(snapshot.market ? automaticSelection(snapshot.market) : []);
    try {
      if (!wholePool && (hashes.length < 2 || hashes.length > 4)) throw new Error('Select 2–4 live intents for this bounded search.');
      // The floor carries into the search: after one of our writes the pool must not be
      // searched at a block that predates it, or the solver reasons about a market in which
      // the user's own commit or revocation has not happened.
      const block = BigInt(snapshot.market?.blockNumber ?? 0);
      const floor = block > snapshot.floor ? block : snapshot.floor;
      const personal = account && snapshot.market ? latestRequest(snapshot.market, account) : undefined;
      if (account && (!personal || personal.state !== 1 || personal.expired)) throw new SolveRequestError('Create a live swap request before searching for your replacement tickets.', 409, 'PersonalMatchRequired');
      const target = personal?.hash;
      if (target && !wholePool && !hashes.includes(target)) throw new SolveRequestError('Include your own request in the selected intents.', 409, 'PersonalMatchRequired');
      const result = wholePool ? await findPoolSettlement(floor, target) : await findSettlement(hashes.map(hash => ({ hash })), floor, target);
      if (version !== searchVersion.current || !freshness.current(snapshot.revision)) return;
      if (result.proposal && account && !proposalForWallet(result.proposal, account, target)) {
        throw new SolveRequestError('This result does not swap your requested tickets. Search again for your own request.', 409, 'PersonalMatchRequired');
      }
      setProposal(result.proposal); setEvidence(result.evidence);
    } catch (e) { if (version === searchVersion.current) { setProposal(null); setEvidence(null); setSolverError(solverErrorMessage(e)); } }
    finally { if (version === searchVersion.current) { searchInFlight.current = false; setSolving(false); } }
  }, [freshness, account]);
  useEffect(() => {
    // A late search for the previous account must never become the new account's match.
    searchVersion.current++; searchInFlight.current = false;
    const timer = setTimeout(() => { setSolving(false); setProposal(null); setEvidence(null); setSolverError(''); }, 0);
    return () => clearTimeout(timer);
  }, [account]);
  useEffect(() => {
    // Persist only the public block floor, scoped to this chain and registry. Reloading or
    // reconnecting a wallet must not forget a confirmed write during indexer lag.
    if (CHAIN.id === 31337) return;
    const key = `reshuffle:read-floor:${CHAIN.id}:${CONTRACTS.intentRegistry}`;
    try { const saved = sessionStorage.getItem(key); if (saved && /^\d+$/.test(saved) && BigInt(saved) > freshness.getSnapshot().floor) freshness.requireBlock(BigInt(saved)); } catch {}
    return freshness.subscribe(() => { try { sessionStorage.setItem(key, freshness.getSnapshot().floor.toString()); } catch {} });
  }, [freshness]);
  useEffect(() => { void Promise.resolve().then(() => refresh()); }, [refresh]);
  useEffect(() => {
    if (!unavailableMatch || busy) return;
    const timer = setTimeout(() => {
      searchVersion.current++; searchInFlight.current = false;
      setSolving(false); setProposal(null); setEvidence(null);
      setSolverError('This match is no longer available. Check all intents to search again.');
    }, 0);
    return () => clearTimeout(timer);
  }, [unavailableMatch, busy]);
  useEffect(() => {
    // A confirmed commit queues one search. If its read-back is delayed, keep it queued
    // until the receipt's freshness floor is satisfied; other refreshes never queue work.
    if (!matchAfterCommit || !market || busy || indexingBlock !== null) return;
    const timer = setTimeout(() => {
      if (searchInFlight.current) return;
      setMatchAfterCommit(false);
      void runSolver([], true);
    }, 0);
    return () => clearTimeout(timer);
  }, [matchAfterCommit, market, busy, indexingBlock, runSolver]);
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
    const dialog = historyDialog.current;
    if (!historyOpen || !dialog) return;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [historyOpen]);
  useEffect(() => {
    let cancelled = false;
    if (account) void getTicketsApproved(account).then(value => { if (!cancelled) setApproved(value); }).catch(() => { if (!cancelled) setApproved(false); });
    return () => { cancelled = true; };
  }, [account, market?.blockNumber]);
  const action = async (label: string, fn: (address: Address) => Promise<void>) => {
    if (activeAction.current || freshness.getSnapshot().indexingBlock !== null) return;
    activeAction.current = true; setBusy(label); setNotice(''); setTxHash(undefined); setConfirmedWrite(null); setStatus('idle'); setRejection(null);
    searchVersion.current++; searchInFlight.current = false; setSolving(false);
    try { await runWithWallet(fn); }
    catch (e) { setNotice(walletActionMessage(e)); }
    finally { setBusy(''); activeAction.current = false; }
  };
  const noteReceipt = (block: bigint, hashes: Hex[] = []) => {
    freshness.requireBlock(block);
    searchVersion.current++; searchInFlight.current = false;
    setSolving(false); setProposal(null); setEvidence(null);
    if (hashes.length) setConfirmedWrite({ block: block.toString(), hashes });
  };
  const indexed = async (receipt: { blockNumber: bigint }, hashes: Hex[] = []) => {
    noteReceipt(receipt.blockNumber, hashes);
    await refresh(true); // failure retains the receipt, floor and indexing state for retry
    return receipt;
  };
  const track = async (hash: Hex) => {
    setTxHash(hash);
    return indexed(await waitForSuccess(hash), [hash]);
  };
  // Judge controls need no wallet: the transactions are signed server-side with the seeded
  // participants' own keys, because revoke() is owner-only. Same busy gating as action(), so a
  // judge cannot start one while a wallet action is mid-flight.
  const operate = async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
    if (activeAction.current || freshness.getSnapshot().indexingBlock !== null) throw new Error('Wait for the current action and its indexed state.');
    activeAction.current = true; setBusy(label); setNotice(''); setTxHash(undefined); setConfirmedWrite(null);
    searchVersion.current++; searchInFlight.current = false; setSolving(false);
    try { return await fn(); }
    catch (error) {
      const confirmed = (error as { confirmed?: { blockNumber: string; hashes: Hex[] } })?.confirmed;
      if (confirmed && /^\d+$/.test(confirmed.blockNumber) && confirmed.hashes.every(hash => /^0x[0-9a-fA-F]{64}$/.test(hash))) {
        noteReceipt(BigInt(confirmed.blockNumber), confirmed.hashes);
        setTxHash(confirmed.hashes.at(-1));
        setNotice(error instanceof Error ? error.message : 'A transaction confirmed before the action failed.');
        void refresh(true);
      }
      throw error;
    }
    finally { setBusy(''); activeAction.current = false; }
  };
  // Both judge controls end the same way: wait for the indexer to reach the block the change
  // landed in, then re-read the pool at that floor. Without the wait the judge changes a
  // condition and the pool still shows the old one, which reads as the control not working.
  const judged = (block: string, notice: string, hashes: Hex[]) => {
    noteReceipt(BigInt(block), hashes);
    void refresh(true);
    setProposal(null); setEvidence(null); setWholePool(true);
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
    judged(change.commitBlock, `Budget changed on-chain. The intent is now ${change.newHash.slice(0, 10)}… with a signed limit of ${usdc} USDC.`, [change.revokeTx, change.commitTx]);
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
    judged(result.revokeBlock, 'Intent revoked on-chain. Waiting for the updated pool.', [result.revokeTx]);
    return result;
  });
  // Manual, periodic, reconnect and post-write reads all carry the same persistent floor.
  const refreshWritten = () => refresh(true);
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
    if (last) await indexed(await waitForSuccess(last), result.hashes);
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
  const sign = (draft: IntentParams, prepared: (intent: IntentParams) => void, committed: (intent: IntentParams) => void) => action('Create intent', async address => {
    if (!market) return;
    if (selectedClass(draft.sectionMask) === null) throw new Error('Choose exactly one section.');
    const quote = demoPriceQuote(draft, market.tickets);
    if (!quote || draft.maxNetPay !== quote.paymentAmount) throw new Error('Review the payment amount for your selected tickets before creating an intent.');
    validateNewIntentTiming(draft.sessionMask, draft.deadline, await getChainTimestamp());
    for (const id of draft.offered) {
      const depositor = await getTicketDepositor(id);
      if (!equal(depositor, address)) throw new Error(`Deposit your offered ticket #${id} before committing.`);
    }
    const nonce = await getUnusedNonce(address, nextRecordedNonce(market, address));
    if (draft.maxNetPay > 0n) {
      const allowance = await getUSDCAllowance(address);
      if (allowance < draft.maxNetPay) {
        setNotice(`Approve ${formatUSDC(draft.maxNetPay)} USDC in your wallet. Payment is collected only when the swap succeeds.`);
        const approvalHash = await approveUSDC(address, draft.maxNetPay);
        setTxHash(approvalHash);
        // Approval needs a successful receipt, not indexed ticket/intent data. Retain its
        // floor immediately, then let the commit read-back catch up with both writes.
        const approval = await waitForSuccess(approvalHash);
        noteReceipt(approval.blockNumber, [approvalHash]);
      }
    }
    const ready = { ...draft, owner: address, nonce };
    prepared(ready);
    setNotice('Sign your intent, then confirm the transaction that submits it.');
    try { await track(await signAndCommitIntent(address, ready)); }
    catch (error) {
      // A cancelled signature must still read back any approval already confirmed.
      if (freshness.getSnapshot().indexingBlock !== null) void refresh(true);
      throw error;
    }
    committed(ready);
    searchVersion.current++; searchInFlight.current = false; setSolving(false);
    setReceipt(null); setProposal(null); setEvidence(null); setWholePool(true);
    setMatchAfterCommit(true);
    // track() already refreshed at the confirmed commit block. Reuse that read-back.
    setNotice('Intent committed. Matching will run once after your request is indexed.');
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
      let payload = proposal;
      if (malicious) {
        const hashes = malicious === 'adjacency' ? rejectionDemo.control.proposal.legs.map(l => l.intentHash as Hex) : proposal?.legs.map(leg => leg.intentHash) ?? selected;
        const fresh = await findSettlement(hashes.map(hash => ({ hash })), freshness.getSnapshot().floor);
        if (!fresh.proposal || !fresh.evidence.simulationResult?.success) throw new Error(fresh.evidence.simulationResult?.error ?? EMPTY_RESULT);
        payload = fresh.proposal;
        payload = dishonestProposal(payload, malicious, market?.tickets ?? []);
        let actual: NamedRejection | null = null;
        try { await simulate(payload, address); } catch (e) { actual = namedRejection(e); }
        const expected = { siphon: 'PaymentImbalance', count: 'CountMismatch', adjacency: 'SeatsNotAdjacent' }[malicious];
        if (actual?.name !== expected) throw new Error(`This state does not isolate ${expected}. ${actual?.name ?? 'Refresh the pool and try again.'}`);
      } else {
        if (!payload || !readyMatch || matchUnavailable(payload, evidence, freshness.getSnapshot().market)) throw new Error('This match is no longer available. Check all intents to search again.');
        const currentMarket = freshness.getSnapshot().market;
        const personal = currentMarket ? latestRequest(currentMarket, address) : undefined;
        if (!personal || personal.state !== 1 || personal.expired || !proposalForWallet(payload, address, personal.hash)) {
          throw new Error('This match does not swap your current request. Search again with your receiving wallet.');
        }
        // Validate exactly what was reviewed, without re-running a search that could
        // change its tickets or payments. Simulation does not reserve chain state.
        await simulate(payload, address);
      }
      setStatus('wallet approval');
      const hash = await submitSettlement(address, payload.intents, payload.legs);
      broadcast = true; setTxHash(hash); setStatus('pending receipt');
      const r = await waitForReceipt(hash);
      if (r.status === 'success') noteReceipt(r.blockNumber, [hash]);
      const refreshRequest = refreshWritten();
      const verified = await openReceipt(hash);
      setStatus(r.status === 'success' ? 'confirmed' : 'reverted'); setRejection(verified.rejection);
      setProposal(null); setEvidence(null);
      await refreshRequest;
    } catch (e) {
      if (!broadcast) {
        const named = namedRejection(e); setRejection(named); setStatus(named ? 'simulation rejected' : 'idle');
        if (!malicious && isSimulationRejection(e)) {
          setProposal(null); setEvidence(null);
          setSolverError('This match failed the latest check. Check all intents to search again.');
          void refresh();
        }
      }
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
      const d = await jsonFetch<{ state: string; verifiedBlock?: string }>('/api/demo/reset');
      if (d.state === 'failed') throw new Error('Demo preparation failed. Inspect the local operator script log.');
      if (d.state === 'complete') {
        if (!d.verifiedBlock) throw new Error('Demo verification block is unavailable. Inspect the operator report.');
        setWholePool(true); await indexed({ blockNumber: BigInt(d.verifiedBlock) });
        setNotice('Demo preparation confirmed. Public state refresh requested at its verification block.'); return;
      }
    }
    setNotice('Preparation is still running. Refresh the chain state after the local script completes.');
  });

  const live = market ? getIntentPool(market) : [];
  const tickets = market ? getTicketsFor(null, market) : [];
  const userTickets = market && account ? getTicketsFor(account, market) : [];
  const sessions = [...new Set(tickets.map(t => t.sessionId))].sort((a, b) => a - b);
  const participants = [...new Set(market?.intents.map(i => i.owner.toLowerCase()) ?? [])].sort();
  const walletLabel = (address: string) => equal(address, account) ? 'You' : participants.includes(address.toLowerCase()) ? `Wallet ${participants.indexOf(address.toLowerCase()) + 1}` : truncateAddress(address);
  const disabled = !!busy || wallet.isConnecting || indexingBlock !== null;
  const receiptRows = receipt ? receiptOutcomes(receipt) : [];
  const selectIntent = (hash: Hex) => { setWholePool(false); searchVersion.current++; searchInFlight.current = false; setSolving(false); setSelected(s => s.includes(hash) ? s.filter(h => h !== hash) : [...s, hash]); setProposal(null); setEvidence(null); setSolverError(''); };

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
          className={`two-line-nav-item ${currentView === 'events' ? 'active' : ''}`}
          onClick={() => navigateTo('events')}
        >
          Events
        </button>
        <button
          type="button"
          className={`two-line-nav-item ${currentView === 'tickets' ? 'active' : ''}`}
          onClick={() => navigateTo('tickets')}
        >
          Tickets {userTickets.length > 0 && <span className="nav-count-badge mono">{userTickets.length}</span>}
        </button>
      </nav>
      <div className="header-actions">
        <ConnectWalletButton />
      </div>
    </header>
    <main>
      {(currentView === 'home' || currentView === 'events') && (
        <>
          {currentView === 'home' && (
            <section className="hero">
              <div className="hero-grid">
                <div className="hero-text-block">
                  <div className="eyebrow">An outcome market for tickets</div>
                  <h1>
                    {HERO_TITLE_LINES[0]}
                    <br />
                    <span>{HERO_TITLE_LINES[1]}</span>
                  </h1>
                  <div className="hero-cta-wrap">
                    <SpecularButton
                      size="md"
                      radius={16}
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
          {currentView === 'events' && <section id="events" className="event-section">
            <div className="section-heading">
              <div>
                {currentView === 'events' ? (
                  <button
                    type="button"
                    className="back-nav-btn"
                    onClick={() => navigateTo('home')}
                  >
                    ← Back to Home
                  </button>
                ) : (
                  <div>
                    <span className="eyebrow">Upcoming & Live</span>
                    <h2>Event Programme</h2>
                  </div>
                )}
              </div>
              <p>{currentView === 'events' ? <br /> : 'Explore live outcome pools and exchange event tickets.'}</p>
            </div>
            <div className="posters">
              <button
                type="button"
                className="poster poster-live"
                onClick={() => navigateTo('workspace')}
              >
                <span className="poster-top mono">RESHUFFLE PRESENTS / EVENT 1</span>
                <span className="poster-photo"><Image src={maydayPoster} alt="Mayday concert poster" fill sizes="(max-width: 720px) 84vw, 28vw" /></span>
                <span className="poster-title">AFTER HOURS</span>
                <span className="poster-sub">Demo concert · issuer-native tickets</span>
                <span className="poster-dates mono">{sessions.length ? sessions.map(n => `SESSION ${n}`).join(' / ') : 'READING SESSIONS'}</span>
                <span className="poster-status"><span className="mono">{market ? `${live.length} ${POOL_LABEL}` : 'Reading live intents…'}</span><span>Open workspace ↗</span></span>
              </button>
              {[{ name: 'INTERLUDE', photo: sarahPoster, alt: 'Sarah Kang in Seoul concert poster' }, { name: 'ENCORE', photo: taylorPoster, alt: 'Taylor Swift The Eras Tour concert poster' }].map(({ name, photo, alt }, n) => <div key={name} className="poster poster-inert" aria-disabled="true"><span className="poster-top mono">UPCOMING PROGRAMME / 0{n + 2}</span><span className="poster-photo"><Image src={photo} alt={alt} fill sizes="(max-width: 720px) 84vw, 28vw" /></span><span className="poster-title">{name}</span><span className="poster-sub">Event details to be announced</span><span className="poster-dates mono">VENUE & DATES UNANNOUNCED</span><span className="poster-status">No live intents</span></div>)}
            </div>
            {readError && <p role="alert" className="read-error">{readError} <button onClick={() => void refresh(true)}>Retry public reads</button></p>}
          </section>}
        </>
      )}
      {currentView === 'workspace' && (
        <>
          {market ? (
            <section id="workspace" ref={workspace} className="workspace-section">
              <header className="workspace-header">
                <button
                  type="button"
                  className="back-nav-btn"
                  onClick={() => navigateTo('events')}
                >
                  ← Back to Events
                </button>
                <nav className="workspace-nav" aria-label="Workspace navigation">
                  <button
                    type="button"
                    className="workspace-tickets-nav-btn"
                    onClick={() => navigateTo('tickets')}
                  >
                    My Tickets {userTickets.length > 0 ? `(${userTickets.length})` : ''}
                  </button>
                  <button type="button" aria-haspopup="dialog" aria-expanded={poolOpen} onClick={() => setPoolOpen(true)}>{indexingBlock !== null ? 'Intent pool: indexing' : `Intent Pool (${live.length})`}</button>
                  <button type="button" aria-haspopup="dialog" aria-expanded={seatMapOpen} onClick={() => setSeatMapOpen(true)}>Seat Map</button>
                  <button type="button" aria-haspopup="dialog" aria-expanded={historyOpen} onClick={() => setHistoryOpen(true)}>Past Settlements <span className="mono">({getSettlements(market).length})</span></button>
                </nav>
              </header>
              <PoolDialog open={poolOpen} count={live.length} onClose={() => setPoolOpen(false)}>
                {indexingBlock !== null ? (
                  <div className="pool-body">
                    <p role="status">{indexingMessage(indexingBlock)} {INDEXING_PENDING}</p>
                  </div>
                ) : (
                  <>
                    <div className="pool-toolbar">
                      <div className="pool-toolbar-status">
                        {selected.length > 0 ? (
                          <>
                            <span className="pool-selection-pill mono">{selected.length} of 4 selected</span>
                            <button type="button" className="pool-clear-btn" onClick={() => setSelected([])}>Clear selection</button>
                          </>
                        ) : (
                          <span>Select 2 to 4 requests to test a specific counterparty match</span>
                        )}
                      </div>
                      <span className="mono pool-total-note quiet">{live.length} {POOL_LABEL}</span>
                    </div>

                    <div className="pool-body">
                      <div className="pool-list">
                        {live.map((i, index) => {
                          const isSelected = selected.includes(i.hash);
                          const isMine = equal(i.owner, account);
                          const intent = restoreIntent(i);
                          const wantsSessions = maskClasses(intent.sessionMask).map(sessionLabel);
                          const wantsSections = maskClasses(intent.sectionMask).map(s => `CAT ${s}`);

                          return (
                            <article
                              key={i.hash}
                              className={`pool-row ${isSelected ? 'is-selected' : ''}`}
                              data-selected={isSelected}
                            >
                              <div className="pool-row-top">
                                <label className="pool-row-select">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    disabled={disabled}
                                    onChange={() => selectIntent(i.hash)}
                                  />
                                  <span className="pool-owner-title">
                                    {walletLabel(i.owner)}
                                    <span className="pool-req-idx mono">/ Request {index + 1}</span>
                                  </span>
                                  {isMine && <span className="pool-your-intent-badge">Your Intent</span>}
                                </label>
                                <div className="pool-payment-badge mono">
                                  {intent.maxNetPay > 0n
                                    ? `Pay ≤ ${formatUSDC(intent.maxNetPay)} USDC`
                                    : intent.maxNetPay < 0n
                                    ? `Receive ≥ ${formatUSDC(-intent.maxNetPay)} USDC`
                                    : 'Zero Net'}
                                </div>
                              </div>

                              <div className="pool-spec-grid">
                                <div className="pool-spec-col">
                                  <span className="pool-spec-label">OFFERS</span>
                                  <span className="pool-spec-val mono">
                                    {i.offered.length > 0 ? i.offered.map(id => `#${id}`).join(', ') : 'None (Buyer)'}
                                  </span>
                                </div>
                                <div className="pool-spec-arrow" aria-hidden="true">→</div>
                                <div className="pool-spec-col">
                                  <span className="pool-spec-label">WANTS</span>
                                  <span className="pool-spec-val mono">
                                    {i.exactCount} ticket{i.exactCount === 1 ? '' : 's'} · {wantsSections.join(', ') || 'Any CAT'} · {wantsSessions.join(', ') || 'Any session'}
                                  </span>
                                </div>
                              </div>

                              <div className="pool-tags-row">
                                {i.mustBeAdjacent && <span className="pool-tag tag-adjacent">✓ Contiguous Seats</span>}
                                {i.mustShareSection && <span className="pool-tag">Same Section</span>}
                                {i.mustShareSession && <span className="pool-tag">Same Session</span>}
                              </div>

                              <p className="pool-condition-desc">{condition(intent)}</p>

                              <div className="pool-row-footer">
                                <details className="wallet-details">
                                  <summary className="wallet-summary">Wallet and transaction details</summary>
                                  <div className="wallet-details-expanded">
                                    <div className="wallet-detail-line">
                                      <span className="detail-key">Owner:</span>
                                      <a className="hash" href={`${EXPLORER}/address/${i.owner}`} target="_blank" rel="noreferrer">
                                        {i.owner}
                                      </a>
                                    </div>
                                    <div className="wallet-detail-line">
                                      <span className="detail-key">Commit:</span>
                                      <a className="mono" href={`${EXPLORER}/tx/${i.commitTx}`} target="_blank" rel="noreferrer">
                                        Commit {i.commitTx.slice(0, 10)}… ↗
                                      </a>
                                    </div>
                                  </div>
                                </details>

                                <div className="pool-row-actions">
                                  <button
                                    type="button"
                                    className="text-button pool-why-match-btn"
                                    onClick={() => { setAgentHash(i.hash); setAgentOpen(true); setPoolOpen(false); }}
                                  >
                                    Why no match?
                                  </button>
                                  {isMine && (
                                    <button
                                      type="button"
                                      className="pool-revoke-btn"
                                      disabled={disabled}
                                      onClick={() => void action('Revoke intent', async address => {
                                        await track(await revokeIntent(address, i.hash));
                                        await refreshWritten();
                                        setProposal(null);
                                        setEvidence(null);
                                      })}
                                    >
                                      Revoke my intent
                                    </button>
                                  )}
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>

                      {!live.length && <p className="quiet">No live requests yet. Submit an intent to join the pool.</p>}
                      {!!market.hashMismatched?.length && (
                        <p className="quiet" role="status">
                          {market.hashMismatched.length} indexed {market.hashMismatched.length === 1 ? 'request is' : 'requests are'} excluded from this pool: the indexed fields do not re-hash to the id they were committed under, so they are not shown.{' '}
                          <span className="mono">{market.hashMismatched.map(h => `${h.slice(0, 10)}…`).join(' ')}</span>
                        </p>
                      )}
                    </div>

                    <div className="pool-dialog-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={disabled || solving || matchAfterCommit}
                        onClick={() => { setWholePool(true); setWorkflowView('matching'); setPoolOpen(false); void runSolver([], true); }}
                      >
                        Check all intents
                      </button>
                      {!wholePool && (
                        <button
                          type="button"
                          className="primary"
                          disabled={disabled || solving || matchAfterCommit || selected.length < 2 || selected.length > 4}
                          onClick={() => { setWorkflowView('matching'); void runSolver(selected); setPoolOpen(false); }}
                        >
                          Search selected requests ({selected.length}/4)
                        </button>
                      )}
                    </div>
                  </>
                )}
              </PoolDialog>
              {indexingBlock !== null && <section className="activity" aria-live="polite">
                <strong>{indexingMessage(indexingBlock)}</strong><p>{INDEXING_PENDING}</p>
                {readError && <p role="alert">{readError}</p>}
                <button className="secondary" onClick={() => void refresh(true)}>Retry indexing</button>
              </section>}
              {nftClaim && equal(nftClaim.owner, account) && (
                <section className="wallet-nft-import">
                  <div className="wallet-nft-import-header">
                    <div className="wallet-nft-import-title-group">
                      <span className="badge badge-escrowed"><span className="badge-dot" />MINT CONFIRMED</span>
                      <h3>Your free tickets</h3>
                    </div>
                    <button type="button" className="wallet-nft-dismiss-btn" onClick={() => setNftClaim(null)} aria-label="Dismiss notification">✕</button>
                  </div>
                  <p role="status">{nftClaim.message}</p>
                  <p className="quiet">{WALLET_IMPORT_NOTE}</p>
                  <span className="mono hash">NFT contract: {CONTRACTS.ticketNFT}</span>
                  <ul>
                    {nftClaim.tokenIds.map((id, n) => (
                      <li key={id} className="mono">
                        Token ID: {id} / <a href={`${EXPLORER}/tx/${nftClaim.hashes[n]}`} target="_blank" rel="noreferrer">Mint receipt</a>
                      </li>
                    ))}
                  </ul>
                  <div className="wallet-nft-import-actions">
                    <button type="button" className="view-tickets-btn" onClick={() => navigateTo('tickets')}>
                      View in Tickets Interface →
                    </button>
                    <button className="secondary" disabled={disabled} onClick={() => void retryNFTImport()}>
                      Add to wallet
                    </button>
                  </div>
                </section>
              )}
              <div hidden={indexingBlock !== null}>
              <div className="workspace-stack">
                {workflowView === 'intent' ? <IntentBuilder onConnect={async () => { await wallet.connect(); await refresh(true); }} connectionError={wallet.error} market={market} account={account} approved={approved} busy={disabled} seatMapOpen={seatMapOpen} onSeatMapClose={() => setSeatMapOpen(false)} onComplete={() => setWorkflowView('matching')} onCustody={custody} onDepositSelected={depositSelected} onSign={sign} onDemo={claimDemo} onApprove={() => action('Approve tickets', async address => { await track(await approveNFTsForEscrow(address)); setApproved(true); })} /> : <>
                {request && <MatchingStatus request={request} selected={selected} solving={solving} error={readError || solverError} proposal={unavailableMatch ? null : proposal} evidence={evidence} wholePool={wholePool} />}
                <section className="workspace-panel matching-panel"><div className="panel-heading"><h2>Matching</h2><span className="eyebrow">{readyMatch && !solving ? 'Ready to settle' : wholePool ? 'All live requests' : 'Selected requests'}</span></div>
                  <div className="solver-actions"><button className="secondary" disabled={solving || disabled || matchAfterCommit || (!wholePool && (selected.length < 2 || selected.length > 4))} onClick={() => void runSolver(selected, wholePool)}>{solving ? 'Reading and searching…' : wholePool ? 'Check all intents' : 'Run solver'}{!wholePool && <span className="mono"> ({selected.length}/4)</span>}</button><button className="text-button" onClick={() => { setAgentHash(current => current ?? request?.hash ?? live[0]?.hash ?? null); setAgentOpen(true); }}>Ask the agent</button>{resetEnabled && equal(account, operator) && <button className="text-button" disabled={disabled} onClick={() => void reset()}>Reset demo</button>}</div>
                  <p className="quiet">{readyMatch && !solving ? 'Your match stays here while you review. Availability is checked again before settlement.' : wholePool ? 'Matching runs once after you create an intent. Click Check all intents whenever you want to search again.' : 'Choose 2–4 requests, then Run solver.'}</p>{!wholePool && <button className="text-button" disabled={disabled || solving || matchAfterCommit} onClick={() => { setWholePool(true); void runSolver([], true); }}>Check all intents</button>}
                  {solving && <p className="quiet" role="status">Checking current intents and ticket availability...</p>}{evidence?.pool && <details className="search-details" open={searchDetailsOpen} onToggle={event => setSearchDetailsOpen(event.currentTarget.open)}><summary>Search details and evidence</summary><p className="quiet mono">{evidence.pool.liveIntents} live requests / {evidence.pool.searchableIntents} within ticket-count limits / {evidence.pool.excludedIntents} excluded with reasons. Maximum 4 participants per candidate, 100 candidates, 2-second search budget. <a href={`/api/evidence/${evidence.id}`} target="_blank" rel="noreferrer">View search evidence and exclusion reasons</a></p></details>}{evidence?.search && !solving && <p className="quiet">{evidence.search.termination === 'complete' ? 'Search completed within the configured bounds.' : 'Search budget reached. Further combinations may remain unchecked.'}</p>}{solverError && <p role="alert">{solverError}</p>}{evidence && !proposal && !solving && <div className="matching-empty" role="status"><h3>Waiting for a match</h3><p>{EMPTY_RESULT}. New requests may make a swap possible; click Check all intents to search again.</p>{evidence.candidatesExcluded.some(i => /capacity|allowance/i.test(i.reason)) && <p>Insufficient USDC balance or allowance for a candidate. Update spending capacity before settling.</p>}</div>}
                  {proposal && <div className="candidate"><p className="eyebrow">{solving ? 'Rechecking previous match' : readyMatch ? 'Candidate found - awaiting settlement' : 'Candidate needs rechecking'}</p><p className="quiet">{solving ? 'The previous result stays visible while current conditions are checked. Settlement is unavailable until this search finishes.' : evidence?.simulationResult?.success ? 'A candidate is not a completed swap. Propose and settle submits it for on-chain validation.' : 'This candidate has not passed simulation and cannot be submitted yet.'}</p><div className="panel-heading"><strong>{settlementShape(proposal)}</strong><span className="mono">{proposal.candidatesFound} candidates</span></div><details className="search-details" open={matchDetailsOpen} onToggle={event => setMatchDetailsOpen(event.currentTarget.open)}><summary>Why this match?</summary><p className="quiet">{RANKING_RULE}. Ties: fewer participants, then ordered intent hashes. Source block <span className="mono">{evidence?.source.blockNumber}</span>.</p></details><table className="net-table"><thead><tr><th>Participant</th><th>Offered tickets</th><th>Receives</th><th>USDC net</th></tr></thead><tbody>{proposal.legs.map((l, index) => <tr key={l.intentHash}><td><a href={`${EXPLORER}/address/${l.owner}`} title={l.owner} target="_blank" rel="noreferrer">{walletLabel(l.owner)} · {truncateAddress(l.owner)}</a></td><td className="mono">{proposal.intents[index].offered.map(id => `#${id}`).join(', ') || '—'}</td><td className="mono">{l.receives.map(id => `#${id}`).join(', ') || '—'}</td><td className="mono">{l.netPayment > 0n ? '−' : l.netPayment < 0n ? '+' : ''}{formatUSDC(l.netPayment < 0n ? -l.netPayment : l.netPayment)}</td></tr>)}</tbody><tfoot><tr><td colSpan={3}>Σ</td><td className="mono">{formatUSDC(proposal.legs.reduce((n, l) => n - l.netPayment, 0n))}</td></tr></tfoot></table></div>}
                  <button className="primary full" disabled={disabled || solving || !readyMatch} onClick={() => void settle()}>Propose and settle <span>↗</span></button><p className="quiet">When a match is ready, click Propose and settle and confirm the transaction in your wallet. The proposer pays gas in USDC. Participants do not sign their intents again. Your swap is complete only after the receipt confirms success.</p>
                  <JudgeControls freshness={freshness} busy={disabled} label={walletLabel} onBudget={applyJudgeBudget} onRevoke={revokeJudgeIntent} />
                  <details className="dishonest"><summary>Submit dishonest proposal ▾</summary><p>Intentionally submit a failing transaction. The proposer pays its gas in USDC. The adjacency case uses the separate live rejection-demo intents.</p><select value={attack} onChange={e => setAttack(e.target.value as Attack)}><option value="siphon">Siphon 20 USDC</option><option value="adjacency">Non-adjacent seats</option><option value="count">Wrong count</option></select><button className="secondary" disabled={disabled || solving || !proposal} onClick={() => void settle(attack)}>Submit dishonest proposal</button></details>
                </section>
                </>}
              </div>
              </div>
              {(status !== 'idle' || rejection) && <Validation key={`${status}:${txHash}`} status={status} hash={txHash} rejection={rejection} />}
              <dialog ref={historyDialog} className="intent-pool-dialog history-dialog" aria-labelledby="history-title" onClose={() => setHistoryOpen(false)} onClick={event => {
                if (event.target !== event.currentTarget) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
              }}>
                <div className="panel-heading"><h2 id="history-title">Past Settlements</h2><button className="secondary" onClick={() => historyDialog.current?.close()} aria-label="Close past settlements">Close ×</button></div>
                <p className="quiet">{getSettlements(market).length} recorded swaps</p>
                <div className="history-list">{getSettlements(market).map((r, index) => <button key={r.hash} title={r.hash} onClick={() => { setHistoryOpen(false); void openReceipt(r.hash).catch(e => setNotice(e.message)); }}><span>Swap {getSettlements(market).length - index}</span><span>{r.participants} participants</span><span>Open receipt ↗</span></button>)}</div>
                {!getSettlements(market).length && <p className="quiet">No settlements recorded yet.</p>}
              </dialog>
            </section>
          ) : (
            <section className="workspace-section">
              <button type="button" className="back-nav-btn" onClick={() => navigateTo('events')}>← Back to Events</button>
              <EventLoadingDialog error={readError} onRetry={() => refresh(true)} onBack={() => navigateTo('events')} />
            </section>
          )}
          {receipt && <section ref={receiptPanel} className="receipt-section"><div className="section-heading"><div><span className="eyebrow passed">Settlement confirmed</span><h2>{receiptTitle(receipt, account)}</h2></div><span className="receipt-stamp passed">✓</span></div>
            <ClaimTickets key={receipt.hash} receipt={receipt} wallet={wallet} disabled={!!busy} />
            {receiptRows.every(row => !walletChangesTickets(receipt.participants, row.owner)) && <p className="quiet">This transaction returned tickets to their existing owner. Ticket ownership did not change.</p>}
            {account && !receiptRows.some(row => equal(row.owner, account)) && <div className="activity"><p>This settlement did not include your wallet or settle your request.</p><p>Your deposited tickets: {tickets.filter(ticket => equal(ticket.depositor, account) && equal(ticket.owner, CONTRACTS.escrow)).map(ticket => `#${ticket.tokenId}`).join(', ') || 'None in the loaded state'}</p><button className="secondary" disabled={disabled || solving || !requiredHash} onClick={() => { setWorkflowView('matching'); setWholePool(true); void runSolver([], true); scrollTo(workspace.current); }}>Find my match</button></div>}
            <a className="hash" href={`${EXPLORER}/tx/${receipt.hash}`} target="_blank" rel="noreferrer">{receipt.hash} ↗</a><p className="receipt-count mono">{receipt.ticketTransfers} ticket transfers · {receipt.usdcTransfers} USDC transfers · 1 transaction</p><table className="receipt-table"><thead><tr><th>Participant</th><th>Before / offered</th><th>After / received</th><th>USDC net</th></tr></thead><tbody>{receiptRows.map((p, n) => <tr key={`${p.owner}:${n}`}><td><a href={`${EXPLORER}/address/${p.owner}`} title={p.owner} target="_blank" rel="noreferrer">{walletLabel(p.owner)} · {truncateAddress(p.owner)}</a></td><td className="mono">{p.offered.map(id => `#${id}`).join(', ') || '—'}</td><td className="mono">{p.receives.map(id => `#${id}`).join(', ') || '—'}</td><td className="mono">{BigInt(p.netPayment) > 0n ? '−' : BigInt(p.netPayment) < 0n ? '+' : ''}{formatUSDC(BigInt(p.netPayment) < 0n ? -BigInt(p.netPayment) : BigInt(p.netPayment))}</td></tr>)}</tbody><tfoot><tr><td colSpan={3}>Σ =</td><td className="mono passed">{formatUSDC(BigInt(receipt.netSum))}</td></tr></tfoot></table><p>{receipt.independent ? SOLVER_NOTE : 'Submitted by a participant wallet.'} <a href={`${EXPLORER}/address/${receipt.proposer}`} title={receipt.proposer} target="_blank" rel="noreferrer">{walletLabel(receipt.proposer)}</a></p><p className="quiet">Ticket recipients are checked against receipt logs. USDC transfer count excludes native gas. A different proposer address alone does not establish that participant browsers were offline.</p><div className="receipt-actions"><a className="secondary" href={`${EXPLORER}/tx/${receipt.hash}`} target="_blank" rel="noreferrer">View on Arc explorer ↗</a><button className="secondary" onClick={() => void navigator.clipboard.writeText(receipt.hash).then(() => setNotice('Hash copied.')).catch(() => setNotice('Clipboard unavailable. Select and copy the displayed hash.'))}>Copy hash</button></div><div className="redeem-list">{receipt.participants.filter(p => equal(p.owner, account)).flatMap(p => p.receives).map(id => { const t = tickets.find(t => t.tokenId === id); return <div key={id}><span className="mono">Ticket #{id}</span>{t?.status === 1 ? <span className="badge">USED</span> : <button disabled={disabled || !t || !equal(t.owner, account)} onClick={() => void action('Redeem', async address => { await track(await redeemTicket(address, BigInt(id))); await refreshWritten(); })}>Redeem</button>}</div>; })}</div><p className="quiet">Redeem marks your ticket used permanently. Only its current holder can redeem it.</p></section>}
          <AgentDrawer open={agentOpen} onClose={() => setAgentOpen(false)} intentHash={agentHash} chainBlock={chainBlock} freshness={freshness} label={walletLabel} />
        </>
      )}
      {currentView === 'tickets' && (
        <section id="tickets-view" className="tickets-view-section">
          <div className="tickets-view-header">
            <div className="tickets-view-header-main">
              <div className="tickets-view-badge-row">
                <span className="tickets-event-tag">AFTER HOURS / EVENT 1</span>
                <span className="tickets-network-tag">ARC TESTNET</span>
              </div>
              <h1>My Tickets</h1>
            </div>
            <div className="tickets-view-actions">
              <button
                type="button"
                className="primary enter-market-btn"
                onClick={() => navigateTo('workspace')}
              >
                Enter Reshuffle Market ↗
              </button>
            </div>
          </div>

          {nftClaim && equal(nftClaim.owner, account) && (
            <section className="wallet-nft-import">
              <div className="wallet-nft-import-header">
                <div className="wallet-nft-import-title-group">
                  <span className="badge badge-escrowed"><span className="badge-dot" />MINT CONFIRMED</span>
                  <h3>Your free tickets</h3>
                </div>
                <button type="button" className="wallet-nft-dismiss-btn" onClick={() => setNftClaim(null)} aria-label="Dismiss notification">✕</button>
              </div>
              <p role="status">{nftClaim.message}</p>
              <p className="quiet">{WALLET_IMPORT_NOTE}</p>
              <span className="mono hash">NFT contract: {CONTRACTS.ticketNFT}</span>
              <ul>
                {nftClaim.tokenIds.map((id, n) => (
                  <li key={id} className="mono">
                    Token ID: {id} / <a href={`${EXPLORER}/tx/${nftClaim.hashes[n]}`} target="_blank" rel="noreferrer">Mint receipt</a>
                  </li>
                ))}
              </ul>
              <div className="wallet-nft-import-actions">
                <button className="secondary" disabled={disabled} onClick={() => void retryNFTImport()}>
                  Add to wallet
                </button>
              </div>
            </section>
          )}

          {!account ? (
            <div className="tickets-empty-card">
              <div className="tickets-empty-icon" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="20" height="14" x="2" y="5" rx="2" />
                  <line x1="2" x2="22" y1="10" y2="10" />
                </svg>
              </div>
              <h3>Wallet not connected</h3>
              <p>Connect your wallet to inspect your event tickets, custody status, and mint receipts.</p>
              <button type="button" className="primary" onClick={() => void wallet.connect()}>
                Connect Wallet
              </button>
            </div>
          ) : userTickets.length === 0 ? (
            <div className="tickets-empty-card">
              <div className="tickets-empty-icon" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
                  <path d="M13 5v2" />
                  <path d="M13 17v2" />
                  <path d="M13 11v2" />
                </svg>
              </div>
              <h3>No tickets in your wallet</h3>
              <p>
                You currently hold no tickets for Event 1 (After Hours). You can receive two free demo tickets on Arc Testnet to test swaps, custody, and settlements.
              </p>
              <div className="tickets-empty-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={disabled}
                  onClick={() => void claimDemo()}
                >
                  Get free tickets
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => navigateTo('events')}
                >
                  Browse Events
                </button>
              </div>
            </div>
          ) : (
            <div className="tickets-content">
              <div className="tickets-meta-bar">
                <div className="tickets-meta-counts">
                  <span className="tickets-count-pill mono">
                    <strong>{userTickets.length}</strong> Total Ticket{userTickets.length === 1 ? '' : 's'}
                  </span>
                  <span className="tickets-count-pill mono">
                    <strong>{userTickets.filter(t => t.depositor === '0x0000000000000000000000000000000000000000').length}</strong> In Wallet
                  </span>
                  <span className="tickets-count-pill mono">
                    <strong>{userTickets.filter(t => t.depositor !== '0x0000000000000000000000000000000000000000').length}</strong> In Escrow
                  </span>
                </div>
                <div className="tickets-contract-pill">
                  <span className="quiet">Contract:</span>
                  <a
                    href={`${EXPLORER}/address/${CONTRACTS.ticketNFT}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mono hash"
                  >
                    {truncateAddress(CONTRACTS.ticketNFT)} ↗
                  </a>
                </div>
              </div>

              <div className="tickets-grid">
                {userTickets.map(t => {
                  const escrowed = t.depositor !== '0x0000000000000000000000000000000000000000';
                  const committed = market?.intents.some(i => i.state === 1 && !i.expired && restoreIntent(i).offered.includes(BigInt(t.tokenId)));
                  return (
                    <div key={t.tokenId} className={`ticket-pass-card ${escrowed ? 'is-escrowed' : ''}`}>
                      <div className="ticket-pass-header">
                        <div className="ticket-pass-chips">
                          <span className="ticket-pass-token-chip mono">#{t.tokenId}</span>
                          <span className="ticket-pass-session-chip">{sessionLabel(t.sessionId)}</span>
                          <span className="ticket-pass-cat-chip">CAT {t.sectionId}</span>
                        </div>
                        <span className={`badge badge-${t.status === 1 ? 'used' : committed ? 'committed' : escrowed ? 'escrowed' : 'wallet'}`}>
                          <span className="badge-dot" aria-hidden="true" />
                          {t.status === 1 ? 'USED' : committed ? 'COMMITTED' : escrowed ? 'ESCROWED' : 'WALLET'}
                        </span>
                      </div>

                      <div className="ticket-pass-seat-display">
                        <div className="ticket-pass-seat-col">
                          <span className="seat-label">ROW</span>
                          <span className="seat-value mono">{t.row}</span>
                        </div>
                        <div className="ticket-pass-seat-divider" />
                        <div className="ticket-pass-seat-col">
                          <span className="seat-label">SEAT</span>
                          <span className="seat-value mono">{t.seat}</span>
                        </div>
                        <div className="ticket-pass-seat-divider" />
                        <div className="ticket-pass-seat-col">
                          <span className="seat-label">SECTION</span>
                          <span className="seat-value mono">CAT {t.sectionId}</span>
                        </div>
                      </div>

                      <div className="ticket-pass-footer">
                        <div className="ticket-pass-price-info">
                          <span className="quiet mono">
                            {DEMO_SECTION_PRICES[t.sectionId] !== undefined
                              ? `${formatUSDC(DEMO_SECTION_PRICES[t.sectionId])} USDC (Demo Ref)`
                              : 'Standard Admission'}
                          </span>
                        </div>
                        <div className="ticket-pass-actions">
                          {t.status !== 1 && (
                            <button
                              type="button"
                              className="position-custody-btn"
                              disabled={disabled}
                              onClick={() => void custody(t, escrowed ? 'withdraw' : 'deposit')}
                            >
                              {escrowed ? 'Withdraw' : 'Deposit'}
                            </button>
                          )}
                          <a
                            href={`${EXPLORER}/token/${CONTRACTS.ticketNFT}?a=${t.tokenId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="ticket-explorer-link mono"
                          >
                            Arcscan ↗
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}
    </main>
    <ActivityNotification busy={busy} notice={notice} hash={txHash} confirmation={confirmedWrite} open={activityOpen} onOpen={() => setActivityOpen(true)} onClose={() => setActivityOpen(false)} />
  </div>;
}
