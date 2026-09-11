"use client";

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatUSDC, truncateAddress } from '@/lib/format';
import EvidencePanel from './EvidencePanel';
import type { SolveEvidence } from '@/lib/solve-api';

interface Rejection { errorName: string; args: string[]; rawData: string; selector: string }
interface Simulation { success: boolean; blockNumber: string; rejection: Rejection | null }
interface Proposal {
  intents: { owner: string; exactCount: number; mustBeAdjacent: boolean }[];
  legs: { intentHash: string; receives: string[] }[];
}
interface RecordData {
  proof: {
    transactionHash: string; blockNumber: string; beforeBlock: string; proposer: string; settlement: string;
    rejection: Rejection; rejectionSource: string; ticketTransfers: number; settlementPayments: string;
    participants: { owner: string; beforeState: number; afterState: number; usdcBefore: string; usdcAfter: string; intentHash: string }[];
    tickets: { tokenId: string; row: number; seat: number; ownerBefore: string; ownerAfter: string }[];
  };
  control: SolveEvidence & { proposal: Proposal };
  malicious: Proposal;
}

export default function RejectedSettlement() {
  const [data, setData] = useState<RecordData | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState<(Simulation & { mode: string }) | null>(null);
  const started = useRef(false);
  const verify = useCallback(async () => {
    setBusy(true); setData(null); setResult(null); setError('');
    try {
      const response = await fetch('/api/demo/act-three', { cache: 'no-store' });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      setData(value);
    } catch (e) { setError(e instanceof Error ? e.message : 'Verification unavailable'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { if (!started.current) { started.current = true; void verify(); } }, [verify]);
  async function simulate(mode: 'malicious' | 'valid') {
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await fetch('/api/demo/act-three', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      setResult({ ...value, mode });
    } catch (e) { setError(e instanceof Error ? e.message : 'Simulation unavailable'); }
    finally { setBusy(false); }
  }
  const proof = data?.proof;
  const seats = (ids: string[]) => ids.map(id => proof?.tickets.find(t => t.tokenId === id)?.seat).join(', ');

  return <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-6 text-white">
    <header className="flex flex-wrap justify-between gap-3 border-b border-white/10 pb-5"><Link href="/" className="font-bold">RESHUFFLE</Link><Link href="/demo/act-two" className="text-sm text-blue-300">Act two: the open chain →</Link></header>
    <div><p className="mb-3 text-sm uppercase tracking-widest text-blue-300">Act three · Arc Testnet</p><h1 className="text-3xl font-bold sm:text-4xl">The solver proposes. The contract enforces.</h1>
      <p className="mt-4 max-w-3xl text-white/60">The same signed intents and payment amounts, with a malicious ticket allocation. A separate proposer submitted it directly to the deployed contract.</p></div>
    {busy && <p role="status" className="text-blue-300">Checking the contract on Arc…</p>}
    {error && <p role="alert" className="rounded border border-amber-400/30 p-4 text-amber-200">{error}</p>}
    {data && proof && <>
      <section className="rounded-xl border border-red-400/40 bg-red-400/5 p-6">
        <p className="text-sm font-medium text-red-300">Recorded attack · REVERTED at block {proof.blockNumber}</p>
        <h2 className="mt-4 break-all font-mono text-3xl font-bold text-red-300 sm:text-4xl">{proof.rejection.errorName}</h2>
        <p className="mt-3 text-sm text-white/60">Decoded selector <span className="font-mono text-white">{proof.rejection.selector}</span> · rejected intent:</p>
        <p className="mt-2 break-all font-mono text-xs text-white/70">{proof.rejection.args[0]}</p>
        <p className="mt-4 text-sm text-white/50">The receipt proves failure. The error bytes are checked by replaying the exact calldata against the preceding block, where the valid control succeeds.</p>
      </section>
      <section className="rounded-xl border border-white/15 p-5">
        <h2 className="text-xl font-semibold">Only the allocation changed.</h2>
        <p className="mt-2 text-sm text-white/60">Same event, session, section and row {proof.tickets[0]?.row}. The buyers signed for exactly two adjacent seats. All offered tickets still appear exactly once in the malicious proposal.</p>
        <div className="mt-5 grid gap-5 md:grid-cols-2">{data.malicious.intents.map((intent, i) => intent.exactCount === 2 && intent.mustBeAdjacent && <article key={intent.owner} className="rounded-lg border border-white/10 p-4">
          <p className="text-sm text-white/60" title={intent.owner}>Buyer {truncateAddress(intent.owner)}</p>
          <p className="mt-3 text-sm text-emerald-300">Valid control: seats {seats(data.control.proposal.legs[i].receives)}</p>
          <p className="mt-2 text-sm text-red-300">Malicious proposal: seats {seats(data.malicious.legs[i].receives)}</p>
          <div className="mt-4 grid grid-cols-4 gap-2">{[...proof.tickets].sort((a, b) => a.seat - b.seat).map(ticket => <div key={ticket.tokenId} className={`rounded border p-3 text-center ${data.malicious.legs[i].receives.includes(ticket.tokenId) ? 'border-red-400 bg-red-400/15 text-red-200' : 'border-white/10 text-white/30'}`}><span className="text-xs">Seat</span><p className="text-xl font-bold">{ticket.seat}</p><p className="text-[10px]">#{ticket.tokenId}</p></div>)}</div>
        </article>)}</div>
      </section>
      <section className="rounded-xl border border-blue-400/25 bg-blue-400/5 p-5">
        <h2 className="text-xl font-semibold">Try both allocations against current chain state.</h2>
        <p className="mt-2 text-sm text-white/60">These buttons call the deployed contract with eth_call. They do not broadcast or require a wallet. Expiry, withdrawal or settlement can change the result; the actual returned error is displayed.</p>
        <div className="mt-4 flex flex-wrap gap-3"><button disabled={busy} onClick={() => void simulate('malicious')} className="rounded bg-red-500/20 px-4 py-2 text-red-200 disabled:opacity-40">Run malicious proposal</button><button disabled={busy} onClick={() => void simulate('valid')} className="rounded bg-emerald-500/20 px-4 py-2 text-emerald-200 disabled:opacity-40">Check valid allocation</button></div>
        {result && <div className="mt-4 rounded border border-white/15 p-4" data-testid="live-result"><p className="text-xs text-white/50">Current {result.mode} call · block {result.blockNumber}</p><p className={`mt-2 break-all font-mono text-xl ${result.success ? 'text-emerald-300' : 'text-red-300'}`}>{result.success ? 'Simulation passed' : result.rejection?.errorName}</p>{result.rejection && <p className="mt-2 break-all font-mono text-xs text-white/50">{result.rejection.rawData}</p>}</div>}
      </section>
      <section className="rounded-xl border border-emerald-400/25 p-5"><h2 className="text-xl font-semibold">The participants kept their assets.</h2>
        <p className="mt-3 text-emerald-300">{proof.ticketTransfers} tickets moved · {formatUSDC(BigInt(proof.settlementPayments))} USDC settlement payments</p>
        <p className="mt-2 text-sm text-white/60">All {proof.tickets.length} tickets remained in escrow for their depositor. Intent states, participant balances and allowances were compared at blocks {proof.beforeBlock} and {proof.blockNumber}.</p>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-white/50"><tr><th className="pb-3 pr-3">Participant</th><th className="pb-3 pr-3">Intent</th><th className="pb-3">USDC before → after</th></tr></thead><tbody>{proof.participants.map(p => <tr key={p.owner} className="border-t border-white/10"><td className="py-3 pr-3" title={p.owner}>{truncateAddress(p.owner)}</td><td className="py-3 pr-3 text-emerald-300">{p.beforeState === 1 ? 'LIVE' : p.beforeState} → {p.afterState === 1 ? 'LIVE' : p.afterState}</td><td className="py-3">{formatUSDC(BigInt(p.usdcBefore))} → {formatUSDC(BigInt(p.usdcAfter))}</td></tr>)}</tbody></table></div>
        <p className="mt-4 text-xs text-white/50">Proposer {truncateAddress(proof.proposer)} is a separate wallet and pays the failed transaction&apos;s gas in USDC. Its gas expense is outside the participant balances above.</p>
      </section>
      <section className="rounded-xl border border-white/15 p-5"><h2 className="font-semibold">Real failed transaction and raw evidence</h2><a className="mt-3 block break-all font-mono text-sm text-blue-300 underline" href={`https://testnet.arcscan.app/tx/${proof.transactionHash}`} target="_blank" rel="noreferrer">{proof.transactionHash}</a><a className="mt-4 block text-sm text-blue-300 underline" href="/api/demo/act-three" target="_blank" rel="noreferrer">Inspect calldata, revert bytes and unchanged state</a><details className="mt-4 text-sm text-white/60"><summary className="cursor-pointer">Returned EVM error bytes</summary><p className="mt-3 break-all font-mono text-xs">{proof.rejection.rawData}</p><p className="mt-3 text-xs">{proof.rejectionSource}</p></details></section>
      <EvidencePanel evidence={data.control} />
    </>}
    <button disabled={busy} onClick={() => void verify()} className="self-start rounded border border-white/20 px-4 py-2 text-sm disabled:opacity-40">Verify recorded rejection again</button>
  </main>;
}
