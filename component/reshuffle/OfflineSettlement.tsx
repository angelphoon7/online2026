"use client";

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { truncateAddress, formatUSDC } from '@/lib/format';
import type { SolveEvidence } from '@/lib/solve-api';
import EvidencePanel from './EvidencePanel';

interface Record {
  proof: {
    transactionHash: string; blockNumber: string; readyBlock: string; proposer: string;
    participantCount: number; ticketTransferCount: number; settlementTransactionCount: number;
    settlementArguments: string[];
    authorizations: { owner: string; intentHash: string; commitTransactionHash: string; commitBlock: string; nonceAtClose: number; nonceAtSettlement: number; signatureRecovered: string }[];
    participants: { owner: string; offered: string[]; received: string[]; netPayment: string }[];
  };
  closure: { requestedAt: string; exitedAt: string; signingServerClosedAt: string; mode: string; exitCode: number };
  participantProcess: { exitedAt: string; exitCode: number };
  solverProcess: { startedAt: string; address: string };
  evidence: SolveEvidence;
}

const explorer = (hash: string) => `https://testnet.arcscan.app/tx/${hash}`;

export default function OfflineSettlement() {
  const [record, setRecord] = useState<Record | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const started = useRef(false);
  const verify = useCallback(async () => {
    setBusy(true); setRecord(null); setError('');
    try {
      const response = await fetch('/api/demo/offline', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setRecord(result);
    } catch (e) { setError(e instanceof Error ? e.message : 'Verification unavailable'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { if (!started.current) { started.current = true; void verify(); } }, [verify]);
  const proof = record?.proof;
  const additionalTransactions = proof?.authorizations.reduce((sum, p) => sum + p.nonceAtSettlement - p.nonceAtClose, 0);
  const total = proof?.participants.reduce((sum, p) => sum - BigInt(p.netPayment), 0n);

  return <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-5 text-white sm:p-8">
    <header className="flex flex-wrap justify-between gap-3 border-b border-white/10 pb-5">
      <Link href="/" className="font-bold">RESHUFFLE</Link>
      <Link href="/demo" className="text-blue-300">Back to the live demo</Link>
    </header>
    <div>
      <p className="mb-3 text-sm uppercase tracking-widest text-blue-300">Pre-authorization proof · Arc Testnet</p>
      <h1 className="text-3xl font-bold sm:text-5xl">Sign once. Close the page.</h1>
      <p className="mt-4 max-w-3xl text-white/65">A separate solver can finish the reshuffle after the participants leave. The contract checks the outcomes they already authorized, including adjacent seats and their USDC budgets.</p>
    </div>
    <button onClick={() => void verify()} disabled={busy} className="self-start rounded-lg border border-white/20 px-4 py-3 text-sm disabled:opacity-50">Verify offline settlement again</button>
    {busy && <p role="status" className="text-blue-200">Checking signatures, historical wallet nonces and the Arc receipt…</p>}
    {error && <p role="alert" className="rounded-xl border border-red-400/30 p-5 text-red-200">{error}</p>}
    {record && proof && <>
      <section data-testid="offline-proof" className="rounded-2xl border border-emerald-300/30 bg-emerald-300/5 p-5 sm:p-7">
        <p className="text-sm text-emerald-300">Confirmed on Arc · Block {proof.blockNumber}</p>
        <h2 className="mt-3 text-2xl font-semibold">The solver settled after the browser and signer exited.</h2>
        <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-4">
          {[[proof.participantCount, 'Signed participants'], [proof.ticketTransferCount, 'Tickets moved'], [proof.settlementTransactionCount, 'Settlement transaction'], [additionalTransactions, 'Later participant transactions']].map(([value, label]) => <div key={String(label)}><p className="text-4xl font-bold text-emerald-200">{value}</p><p className="mt-2 text-sm text-white/60">{label}</p></div>)}
        </div>
      </section>
      <ol className="space-y-4">
        <li className="rounded-xl border border-white/15 p-5"><h2 className="text-xl font-semibold">1. Authorize the outcome</h2><p className="mt-2 text-white/65">Each commit contains an EIP-712 signature that recovers to its participant. All intents were LIVE at the pre-close boundary, block {proof.readyBlock}.</p>
          <ul className="mt-3 space-y-2 text-sm">{proof.authorizations.map((p, i) => <li key={p.intentHash}><a className="text-blue-300 underline" href={explorer(p.commitTransactionHash)} target="_blank" rel="noreferrer">Participant {i + 1} · {truncateAddress(p.owner)} · commit block {p.commitBlock}</a></li>)}</ul>
        </li>
        <li className="rounded-xl border border-amber-300/25 p-5"><p className="text-xs uppercase tracking-wider text-amber-200">Local harness observation</p><h2 className="mt-2 text-xl font-semibold">2. Close the participant page and stop signing</h2>
          <p className="mt-2 text-white/65">The controlled test-wallet page closed with its isolated Chrome browser. Its local signing server and participant process then exited.</p>
          <dl className="mt-3 space-y-2 break-words text-sm text-white/70"><div><dt>Browser exited</dt><dd>{record.closure.exitedAt}</dd></div><div><dt>Participant process exited</dt><dd>{record.participantProcess.exitedAt}</dd></div></dl>
          <p className="mt-3 text-sm text-amber-100/70">Recorded by the local runner using headless Chrome. Browser closure is not a blockchain attestation or a claim about every device owned by a participant.</p>
        </li>
        <li className="rounded-xl border border-white/15 p-5"><h2 className="text-xl font-semibold">3. An independent solver starts and settles</h2><p className="mt-2 break-words text-sm text-white/65">Started {record.solverProcess.startedAt}<br />Proposer {proof.proposer}</p>
          <p className="mt-3 text-white/65">The solver process receives only its own wallet credential. It reads committed intents, searches, simulates, and sends the settlement. No participant signing callback remains available in that workflow.</p>
          <p className="mt-3 break-words font-mono text-sm text-emerald-200">settle({proof.settlementArguments.join(', ')})</p><p className="mt-1 text-sm text-white/60">The actual transaction has these two arguments. There is no new participant signature argument.</p>
          <a className="mt-4 block break-all text-sm text-blue-300 underline" href={explorer(proof.transactionHash)} target="_blank" rel="noreferrer">{proof.transactionHash}</a>
        </li>
      </ol>
      <section className="rounded-xl border border-white/15 p-5"><h2 className="text-xl font-semibold">Participant wallets stayed inactive</h2><p className="mt-2 text-sm text-white/60">Historical EOA transaction counts, from block {proof.readyBlock} through settlement block {proof.blockNumber}. An unchanged nonce proves no new transaction from that wallet in this interval; off-chain signatures alone do not change it.</p>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-white/50"><tr><th className="pb-3 pr-4">Participant</th><th className="pb-3 pr-4">Before closing</th><th className="pb-3 pr-4">After settlement</th><th className="pb-3">New transactions</th></tr></thead><tbody>{proof.authorizations.map((p, i) => <tr key={p.owner} className="border-t border-white/10"><td className="py-3 pr-4">{i + 1} · {truncateAddress(p.owner)}</td><td>{p.nonceAtClose}</td><td>{p.nonceAtSettlement}</td><td className="text-emerald-300">{p.nonceAtSettlement - p.nonceAtClose}</td></tr>)}</tbody></table></div>
      </section>
      <section className="rounded-xl border border-white/15 p-5"><h2 className="text-xl font-semibold">Replacement tickets and USDC arrived</h2><div className="mt-4 space-y-3">{proof.participants.map(p => <div key={p.owner} className="flex flex-wrap justify-between gap-3 border-b border-white/10 pb-3 text-sm"><span>{truncateAddress(p.owner)} · {p.offered.map(t => `#${t}`).join(', ')} → {p.received.map(t => `#${t}`).join(', ')}</span><span>{formatUSDC(-BigInt(p.netPayment))} USDC</span></div>)}</div><p className="mt-4 font-mono text-emerald-300">Σ = {formatUSDC(total ?? 0n)} USDC</p><p className="mt-3 text-sm text-white/60">USDC also pays Arc gas. The independent proposer pays the settlement transaction fee.</p></section>
      <EvidencePanel evidence={record.evidence} />
      <a href="/api/demo/offline" target="_blank" rel="noreferrer" className="text-sm text-blue-300 underline">Inspect the verified evidence JSON</a>
      <p className="text-sm text-white/50">The participant need not return. Settlement still requires LIVE, unexpired intents, escrowed tickets, and sufficient payment balance and allowance. Revoking an intent or withdrawing tickets can prevent settlement.</p>
    </>}
  </main>;
}
