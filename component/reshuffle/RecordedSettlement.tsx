"use client";
import { EMPTY_RESULT } from '@/lib/ui-copy';

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

export default function RecordedSettlement({ scene = 'one' }: { scene?: 'one' | 'two' }) {
  const openChain = scene === 'two';
  const endpoint = `/api/demo/act-${scene}`;
  const [proof, setProof] = useState<Proof | null>(null);
  const [evidence, setEvidence] = useState<SolveEvidence | null>(null);
  const [broken, setBroken] = useState<{ label: string; evidence: SolveEvidence }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const started = useRef(false);
  const verify = useCallback(async () => {
    setBusy(true); setProof(null); setEvidence(null); setBroken([]); setError('');
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setProof(result.proof); setEvidence(result.evidence);
      setBroken(result.broken ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Receipt verification unavailable'); }
    finally { setBusy(false); }
  }, [endpoint]);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void verify();
  }, [verify]);
  const total = proof?.participants.reduce((n, p) => n - BigInt(p.netPayment), 0n);
  let participants = proof?.participants ?? [];
  if (openChain && proof) {
    const ordered: Proof['participants'] = [];
    let cursor = participants.find(p => p.offered.length === 0);
    while (cursor && ordered.length < participants.length) {
      ordered.push(cursor);
      const owner = cursor.owner.toLowerCase();
      const previous = proof.tickets.find(t => t.recipient.toLowerCase() === owner)?.previousParticipant;
      cursor = participants.find(p => p.owner.toLowerCase() === previous?.toLowerCase());
    }
    participants = ordered;
  }
  const role = (p: Proof['participants'][number], i: number) => !openChain ? `Participant ${i + 1}`
    : p.offered.length === 0 ? 'Pure buyer' : p.received.length === 0 ? 'Pure seller' : `Swapper ${i}`;

  return <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-6 text-white">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-5">
      <Link href="/" className="font-bold">RESHUFFLE</Link>
      <Link href="/demo" className="text-sm text-blue-300">Try the pending demo →</Link>
    </header>
    <div>
      <p className="mb-3 text-sm font-medium uppercase tracking-widest text-blue-300">Act {scene} · Arc Testnet</p>
      <h1 className="text-3xl font-bold sm:text-4xl">{openChain ? 'No cycle required.' : 'The whole replacement arrives together.'}</h1>
      <p className="mt-4 max-w-3xl text-white/60">{openChain ? 'A buyer takes tickets at one end; a seller receives cash at the other. Two participants replace their pairs between them. The same settlement contract checks every signed condition in this confirmed four-party exchange.' : 'A confirmed three-party reshuffle. This view verifies the recorded transaction against Arc, including its calldata, ticket transfers and registry states. It shows the completed settlement.'}</p>
      {openChain && <Link className="mt-3 inline-block text-sm text-blue-300 underline" href="/demo/act-one">Compare with act one: the three-party cycle →</Link>}
    </div>
    {busy && <p role="status" className="rounded border border-blue-400/20 p-5 text-blue-300">Verifying the receipt and ticket holders before and after its block…</p>}
    {error && <p role="alert" className="rounded border border-red-400/30 p-5 text-red-300">{error}</p>}
    {proof && <>
      {openChain && broken.length > 0 && <section className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-5">
        <h2 className="text-xl font-semibold">First, remove an endpoint.</h2>
        <p className="mt-2 text-sm text-white/60">These backend searches were recorded before the settlement, while the intents were LIVE. Each omits one endpoint from the search; it does not revoke the signed intent.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">{broken.map(item => <div key={item.label} className="flex flex-col gap-3">
          <h3 className="font-medium text-amber-200">{item.label === 'without-buyer' ? 'Without the buyer' : 'Without the seller'}</h3>
          <p className="text-sm text-white/60">{item.evidence.intentsConsidered} intents considered · {item.evidence.candidatesFound} candidates found · block {item.evidence.source.blockNumber}</p>
          <p className="text-sm text-amber-200">{item.evidence.chosen ? 'Candidate found' : EMPTY_RESULT}</p>
          <EvidencePanel evidence={item.evidence} />
        </div>)}</div>
        <h3 className="mt-5 font-semibold text-emerald-300">With both endpoints, the open chain settled below.</h3>
      </section>}
      <div className="grid grid-cols-3 gap-3 rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-5 text-center">
        {[['Participants', proof.participantCount], ['Tickets moved', proof.ticketTransferCount], ['Settlement transaction', proof.settlementTransactionCount]].map(([label, value]) => <div key={label}>
          <p className="text-4xl font-bold text-emerald-300">{value}</p>
          <p className="mt-2 text-xs text-white/60 sm:text-sm">{label}</p>
        </div>)}
      </div>
      <section className="rounded-xl border border-white/15 bg-white/5 p-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">{openChain ? 'One transaction. Tickets flow from seller to buyer.' : 'One transaction. Every participant receives their pair.'}</h2>
          <span className="text-sm text-emerald-300">Receipt verified · Block {proof.blockNumber}</span>
        </div>
        <p className="mb-5 text-sm text-white/50">{openChain ? 'Escrow held the offered pairs before settlement. The buyer and swappers received their requested tickets; the seller received USDC and no tickets.' : 'Before settlement, escrow held the offered tickets for each participant. After settlement, the replacement tickets belong to that participant.'}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-white/50"><tr><th className="pb-3 pr-4">Participant</th><th className="pb-3 pr-4">Offered pair</th><th className="pb-3">Received pair</th></tr></thead>
            <tbody>{participants.map((p, i) => <tr key={p.owner} className="border-t border-white/10">
              <td className="py-4 pr-4"><span className="block font-medium">{role(p, i)}</span><span title={p.owner} className="mt-1 block font-mono text-xs text-white/50">{truncateAddress(p.owner)}</span></td>
              <td className="py-4 pr-4 text-white/60">{p.offered.map(id => `#${id}`).join(' · ') || 'None — pays USDC'}</td>
              <td className="py-4 font-medium text-emerald-300">{p.received.map(id => `#${id}`).join(' · ') || 'None — receives USDC'}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-white/60">All {proof.participantCount} intents became SETTLED in this receipt&apos;s block.</p>
      </section>
      <section className="rounded-xl border border-white/15 p-5">
        <h2 className="font-semibold">USDC net distribution in the same settlement</h2>
        <div className="mt-4 flex flex-wrap gap-5">{participants.map((p, i) => {
          const net = -BigInt(p.netPayment);
          return <p key={p.owner} className="text-sm text-white/60">{role(p, i)}: <span className={net < 0n ? 'text-red-300' : 'text-emerald-300'}>{net > 0n ? '+' : ''}{formatUSDC(net)} USDC</span></p>;
        })}</div>
        <p className="mt-4 text-lg font-semibold text-emerald-300">Σ = {formatUSDC(total ?? 0n)} USDC</p>
        <p className="mt-2 text-xs text-white/50">Network gas is paid separately in native USDC and excluded from these net payments.</p>
      </section>
      <section className="rounded-xl border border-blue-400/30 bg-blue-400/5 p-5">
        <h2 className="font-semibold">The real transaction</h2>
        <a className="mt-3 block break-all font-mono text-sm text-blue-300 underline" href={`https://testnet.arcscan.app/tx/${proof.transactionHash}`} target="_blank" rel="noreferrer">{proof.transactionHash}</a>
        <p className="mt-3 text-sm text-white/60">{proof.ticketTransferCount} distinct NFT Transfer events from escrow, with recipients checked against the submitted proposal. Ownership was read at blocks {proof.beforeBlock} and {proof.blockNumber}.</p>
        <a className="mt-4 inline-block text-sm text-blue-300 underline" href={endpoint} target="_blank" rel="noreferrer">Inspect full transaction evidence</a>
      </section>
      <EvidencePanel evidence={evidence} />
      <p className="text-xs text-white/40">Minting, depositing and committing were separate preparation transactions. The six-ticket exchange itself used the single settlement above.</p>
    </>}
    <button disabled={busy} onClick={() => void verify()} className="self-start rounded border border-white/20 px-4 py-2 text-sm disabled:opacity-40">Verify receipt again</button>
  </main>;
}
