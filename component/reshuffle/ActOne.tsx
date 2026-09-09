"use client";

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatUSDC, truncateAddress } from '@/lib/format';
import EvidencePanel from './EvidencePanel';
import type { SolveEvidence } from '@/lib/solve-api';

interface Proof {
  transactionHash: string; blockNumber: string; beforeBlock: string;
  participantCount: number; ticketTransferCount: number; settlementTransactionCount: number;
  checkedAt: string;
  participants: { owner: string; offered: string[]; received: string[]; netPayment: string; intentHash: string }[];
  tickets: { tokenId: string; previousParticipant: string; recipient: string; logIndex: number }[];
}

export default function ActOne() {
  const [proof, setProof] = useState<Proof | null>(null);
  const [evidence, setEvidence] = useState<SolveEvidence | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const started = useRef(false);
  const verify = useCallback(async () => {
    setBusy(true); setProof(null); setEvidence(null); setError('');
    try {
      const response = await fetch('/api/demo/act-one', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setProof(result.proof); setEvidence(result.evidence);
    } catch (e) { setError(e instanceof Error ? e.message : 'Receipt verification unavailable'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void verify();
  }, [verify]);
  const total = proof?.participants.reduce((n, p) => n - BigInt(p.netPayment), 0n);

  return <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-6 text-white">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-5">
      <Link href="/" className="font-bold">RESHUFFLE</Link>
      <Link href="/demo" className="text-sm text-blue-300">Try the pending demo →</Link>
    </header>
    <div>
      <p className="mb-3 text-sm font-medium uppercase tracking-widest text-blue-300">Act one · Arc Testnet</p>
      <h1 className="text-3xl font-bold sm:text-4xl">The whole replacement arrives together.</h1>
      <p className="mt-4 max-w-3xl text-white/60">A confirmed three-party reshuffle. This view verifies the recorded transaction against Arc, including its calldata, ticket transfers and registry states. It shows the completed settlement.</p>
    </div>
    {busy && <p role="status" className="rounded border border-blue-400/20 p-5 text-blue-300">Verifying the receipt and ticket holders before and after its block…</p>}
    {error && <p role="alert" className="rounded border border-red-400/30 p-5 text-red-300">{error}</p>}
    {proof && <>
      <div className="grid grid-cols-3 gap-3 rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-5 text-center">
        {[['Participants', proof.participantCount], ['Tickets moved', proof.ticketTransferCount], ['Settlement transaction', proof.settlementTransactionCount]].map(([label, value]) => <div key={label}>
          <p className="text-4xl font-bold text-emerald-300">{value}</p>
          <p className="mt-2 text-xs text-white/60 sm:text-sm">{label}</p>
        </div>)}
      </div>
      <section className="rounded-xl border border-white/15 bg-white/5 p-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">One transaction. Every participant receives their pair.</h2>
          <span className="text-sm text-emerald-300">Receipt verified · Block {proof.blockNumber}</span>
        </div>
        <p className="mb-5 text-sm text-white/50">Before settlement, escrow held the offered tickets for each participant. After settlement, the replacement tickets belong to that participant.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-white/50"><tr><th className="pb-3 pr-4">Participant</th><th className="pb-3 pr-4">Offered pair</th><th className="pb-3">Received pair</th></tr></thead>
            <tbody>{proof.participants.map((p, i) => <tr key={p.owner} className="border-t border-white/10">
              <td className="py-4 pr-4"><span className="block font-medium">Participant {i + 1}</span><span title={p.owner} className="mt-1 block font-mono text-xs text-white/50">{truncateAddress(p.owner)}</span></td>
              <td className="py-4 pr-4 text-white/60">{p.offered.map(id => `#${id}`).join(' · ')}</td>
              <td className="py-4 font-medium text-emerald-300">{p.received.map(id => `#${id}`).join(' · ')}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-white/60">All {proof.participantCount} intents became SETTLED in this receipt&apos;s block.</p>
      </section>
      <section className="rounded-xl border border-white/15 p-5">
        <h2 className="font-semibold">USDC net distribution in the same settlement</h2>
        <div className="mt-4 flex flex-wrap gap-5">{proof.participants.map((p, i) => {
          const net = -BigInt(p.netPayment);
          return <p key={p.owner} className="text-sm text-white/60">Participant {i + 1}: <span className={net < 0n ? 'text-red-300' : 'text-emerald-300'}>{net > 0n ? '+' : ''}{formatUSDC(net)} USDC</span></p>;
        })}</div>
        <p className="mt-4 text-lg font-semibold text-emerald-300">Σ = {formatUSDC(total ?? 0n)} USDC</p>
        <p className="mt-2 text-xs text-white/50">Network gas is paid separately in native USDC and excluded from these net payments.</p>
      </section>
      <section className="rounded-xl border border-blue-400/30 bg-blue-400/5 p-5">
        <h2 className="font-semibold">The real transaction</h2>
        <a className="mt-3 block break-all font-mono text-sm text-blue-300 underline" href={`https://testnet.arcscan.app/tx/${proof.transactionHash}`} target="_blank" rel="noreferrer">{proof.transactionHash}</a>
        <p className="mt-3 text-sm text-white/60">{proof.ticketTransferCount} distinct NFT Transfer events from escrow, with recipients checked against the submitted proposal. Ownership was read at blocks {proof.beforeBlock} and {proof.blockNumber}.</p>
        <a className="mt-4 inline-block text-sm text-blue-300 underline" href="/api/demo/act-one" target="_blank" rel="noreferrer">Inspect full transaction evidence</a>
      </section>
      <EvidencePanel evidence={evidence} />
      <p className="text-xs text-white/40">Minting, depositing and committing were separate preparation transactions. The six-ticket exchange itself used the single settlement above.</p>
    </>}
    <button disabled={busy} onClick={() => void verify()} className="self-start rounded border border-white/20 px-4 py-2 text-sm disabled:opacity-40">Verify receipt again</button>
  </main>;
}
