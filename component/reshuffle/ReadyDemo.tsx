"use client";
import { waitForSuccess } from '@/lib/chain-reads';
import { EMPTY_RESULT } from '@/lib/ui-copy';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Hex } from 'viem';
import type { useWallet } from '@/lib/hooks/useWallet';
import { submitSettlement } from '@/lib/contracts';
import { findSettlement, confirmSettlementEvidence, type SettlementProposal, type SolveEvidence } from '@/lib/solve-api';
import { formatUSDC, truncateAddress } from '@/lib/format';
import { CHAIN, sessionName, sectionName } from '@/lib/config';
import ArcGasNotice from './ArcGasNotice';
import SettlementView from './SettlementView';
import PastSettlements from './PastSettlements';
import EvidencePanel from './EvidencePanel';

interface DemoIntent {
  hash: Hex; owner: string; offered: string[]; exactCount: number;
  maxNetPay: string; deadline: string; state: number; expired: boolean;
  sessionMask: string; sectionMask: string; mustBeAdjacent: boolean;
}
type Status = 'pending' | 'simulated' | 'submitting' | 'settled' | 'failed';

function acceptedNames(mask: string, name: (id: number) => string) {
  return Array.from({ length: 256 }, (_, id) => id).filter(id => (BigInt(mask) & (1n << BigInt(id))) !== 0n).map(name).join(', ') || 'None';
}

export default function ReadyDemo({ wallet }: { wallet: ReturnType<typeof useWallet> }) {
  const { runWithWallet, isConnecting } = wallet;
  const [intents, setIntents] = useState<DemoIntent[]>([]);
  const [selected, setSelected] = useState<Hex[]>([]);
  const [proposal, setProposal] = useState<SettlementProposal | null>(null);
  const [evidence, setEvidence] = useState<SolveEvidence | null>(null);
  const [status, setStatus] = useState<Status>('pending');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState<Hex>();
  const [block, setBlock] = useState('');
  const started = useRef(false);

  const solve = useCallback(async (hashes: Hex[]) => {
    setBusy(true); setError(''); setProposal(null); setEvidence(null); setTxHash(undefined); setStatus('pending');
    try {
      const result = await findSettlement(hashes.map(hash => ({ hash })));
      setProposal(result.proposal); setEvidence(result.evidence);
      setStatus(result.evidence.simulationResult?.success ? 'simulated' : 'pending');
      if (result.proposal && !result.evidence.simulationResult?.success) setError('Latest simulation failed. Refresh chain state before submitting.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to solve'); }
    finally { setBusy(false); }
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true); setError(''); setProposal(null); setEvidence(null); setStatus('pending'); setTxHash(undefined);
    try {
      const response = await fetch('/api/demo', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setIntents(data.intents); setBlock(data.blockNumber);
      const hashes = (data.intents as DemoIntent[]).map(i => i.hash);
      setSelected(hashes);
      await solve(hashes);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to read demo'); setBusy(false); }
  }, [solve]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void refresh();
  }, [refresh]);

  async function submit() {
    if (!proposal || !evidence?.simulationResult?.success) return;
    setBusy(true); setStatus('submitting'); setError('');
    try {
      // Re-read and simulate just before asking the proposer to submit. Execution
      // still revalidates every condition; this does not reserve chain state.
      await runWithWallet(async address => {
        const fresh = await findSettlement(selected.map(hash => ({ hash })));
        if (!fresh.proposal || !fresh.evidence.simulationResult?.success) throw new Error('Demo state changed. Refresh to inspect the latest result.');
        setProposal(fresh.proposal); setEvidence(fresh.evidence);
        const hash = await submitSettlement(address, fresh.proposal.intents, fresh.proposal.legs);
        setTxHash(hash);
        await waitForSuccess(hash);
        const confirmed = await confirmSettlementEvidence(fresh.evidence.id, hash);
        setEvidence(confirmed);
        if (confirmed.receipt) setBlock(confirmed.receipt.blockNumber);
        setStatus('settled');
        const settled = new Set(fresh.proposal.legs.map(l => l.intentHash));
        setIntents(prev => prev.map(i => settled.has(i.hash) ? { ...i, state: 3 } : i));
      });
    } catch (e) {
      setStatus('failed'); setError(e instanceof Error ? e.message : 'Settlement failed');
    } finally { setBusy(false); }
  }

  return <section className="flex flex-col gap-6 text-white">
    <div>
      <h1 className="text-3xl font-bold">Live settlement demo</h1>
      <Link href="/demo/act-one" className="mt-3 inline-block text-sm text-blue-300 underline">Act one: six tickets exchanged in one confirmed transaction →</Link>
      <Link href="/demo/act-two" className="mt-3 block text-sm text-blue-300 underline">Act two: a buyer and seller complete an open chain →</Link>
      <Link href="/demo/act-three" className="mt-3 block text-sm text-blue-300 underline">Act three: the contract rejects a malicious solver →</Link>
      <Link href="/demo/offline" className="mt-3 block text-sm text-emerald-300 underline">Pre-authorization proof: close the page, the solver still settles →</Link>
      <p className="mt-3 max-w-3xl text-white/60">The participants have already signed their conditions and deposited their tickets. Explore the live intents and run the solver without connecting a wallet. A proposer only needs a funded Arc wallet to submit the settlement.</p>
    </div>
    <ArcGasNotice />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-white/60">{block ? `Intent status from Arc block ${block}` : 'Reading Arc Testnet…'}</p>
      <button disabled={busy} onClick={() => void refresh()} className="rounded border border-white/20 px-4 py-2 disabled:opacity-40">Refresh live state</button>
    </div>
    <div className="grid gap-4 md:grid-cols-3">
      {intents.map((intent, index) => <article key={intent.hash} className="rounded-lg border border-white/15 bg-white/5 p-4">
        <label className="flex items-center gap-3 font-medium">
          <input type="checkbox" checked={selected.includes(intent.hash)} disabled={busy} onChange={e => {
            setSelected(prev => e.target.checked ? [...prev, intent.hash] : prev.filter(h => h !== intent.hash));
            setProposal(null); setEvidence(null); setStatus('pending'); setTxHash(undefined); setError('');
          }} />
          Participant {index + 1}
        </label>
        <p className="mt-3 text-sm text-blue-300">{['Not committed', 'LIVE', 'REVOKED', 'SETTLED'][intent.state] ?? 'Unknown'}{intent.expired && intent.state === 1 ? ' · expired' : ''}</p>
        <p className="mt-2 text-sm text-white/60" title={intent.owner}>{truncateAddress(intent.owner)}</p>
        <p className="mt-3 text-sm">Offers tickets {intent.offered.map(id => `#${id}`).join(', ')}</p>
        <p className="mt-2 text-sm text-white/60">Wants exactly {intent.exactCount} {intent.mustBeAdjacent ? 'adjacent ' : ''}tickets</p>
        <p className="mt-2 text-sm text-white/60">{acceptedNames(intent.sessionMask, sessionName)} · {acceptedNames(intent.sectionMask, sectionName)}</p>
        <p className="mt-2 text-sm">{BigInt(intent.maxNetPay) >= 0n ? `Pay at most ${formatUSDC(BigInt(intent.maxNetPay))}` : `Receive at least ${formatUSDC(-BigInt(intent.maxNetPay))}`} USDC</p>
        <p className="mt-2 text-xs text-white/50">Expires {new Date(Number(intent.deadline) * 1000).toLocaleString()}</p>
        <a className="mt-3 block text-xs text-blue-300 underline" href={`https://testnet.arcscan.app/address/${intent.owner}`} target="_blank" rel="noreferrer">View participant on Arc</a>
      </article>)}
    </div>
    <div>
      <p className="mb-3 text-sm text-white/60">Try excluding a participant and search again. This changes the solver input; signed intents stay unchanged on-chain.</p>
      <button disabled={busy || selected.length < 2} onClick={() => void solve(selected)} className="rounded bg-white/10 px-4 py-2 disabled:opacity-40">Find settlement ({selected.length} selected)</button>
      {selected.length < 2 && intents.length > 0 && <p className="mt-2 text-sm text-white/60">Select at least two intents.</p>}
    </div>
    {busy && <p role="status" className="text-blue-300">{status === 'submitting' ? 'Waiting for submission and confirmed receipt…' : 'Checking chain state, searching and simulating…'}</p>}
    {error && <p role="alert" className="break-words rounded border border-red-400/30 p-4 text-red-300">{error}</p>}
    {!busy && evidence && !proposal && <div className="rounded border border-amber-400/30 p-4 text-amber-200">
      <p>{EMPTY_RESULT}</p>
      {intents.some(i => i.state !== 1 || i.expired) && <p className="mt-2 text-sm">This shared demo has changed or expired. The operator can prepare the next round; the evidence below shows the current result.</p>}
    </div>}
    {proposal && <>
      <SettlementView legs={proposal.legs} gross={proposal.gross} candidateCount={proposal.candidatesFound}
        status={status} txHash={txHash} evidence={evidence}
        onSubmit={!busy && !isConnecting && CHAIN.id === 5042002 ? () => void submit() : undefined} />
      {status === 'settled' && <p className="text-sm text-white/60">This round is complete. The operator can rerun demo:prepare for the next recording.</p>}
    </>}

    {isConnecting && <p role="status" className="text-sm text-white/60">Open MetaMask from your browser toolbar and approve the connection. Waiting for the wallet to respond…</p>}
    <EvidencePanel evidence={evidence} />
    <PastSettlements refreshKey={txHash} />
  </section>;
}
