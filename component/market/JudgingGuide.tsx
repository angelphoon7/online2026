"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Hex } from 'viem';
import { MarketFreshness, requireSnapshotBlock } from '@/lib/market-freshness';

type Status = { batch: string; snapshotBlock: string; lagSeconds: number; groups: { name: string; hashes: Hex[]; available: boolean; issues: { reason: string }[]; counts: (number | null)[]; expiresAt: string | null }[] };
export default function JudgingGuide({ freshness, busy, onSearch }: { freshness: MarketFreshness; busy: boolean; onSearch: (hashes: Hex[]) => void }) {
  const { floor, indexingBlock } = useSyncExternalStore(freshness.subscribe, freshness.getSnapshot, freshness.getServerSnapshot);
  const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState('');
  const load = useCallback(async () => {
    const ticket = freshness.getSnapshot();
    if (ticket.indexingBlock !== null) return;
    try {
      const response = await fetch(`/api/demo/scenarios?minBlock=${ticket.floor}`, { cache: 'no-store' });
      const data = await response.json();
      if (!freshness.current(ticket.revision)) return;
      if (!response.ok) throw new Error(data.error ?? 'Demo status unavailable');
      requireSnapshotBlock(data.snapshotBlock, ticket.floor);
      setStatus(data); setError('');
    } catch (e) {
      if (!freshness.current(ticket.revision)) return;
      setStatus(null); setError(e instanceof Error ? e.message : 'Demo status unavailable');
    }
  }, [freshness]);
  useEffect(() => { void Promise.resolve().then(load); const timer = setInterval(() => void load(), 30_000); return () => clearInterval(timer); }, [load, floor, indexingBlock]);
  const waiting = indexingBlock !== null;
  return <details className="dishonest judging-guide">
    <summary>Start here / judge the live demo</summary>
    <ol>
      <li>Explore requests, run matching and inspect evidence without a wallet.</li>
      <li>Choose a prepared group below. Check A+B, A+C and B+C, then all three. Each search uses the selected requests and current data.</li>
      <li>Use the judge access code to change a budget or revoke a request, then search that same group again.</li>
      <li>To settle, connect your own wallet, switch to Arc Testnet and obtain test USDC from the <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer">Circle faucet</a>. Select Arc Testnet and your wallet address. Test USDC pays the proposer&apos;s gas.</li>
    </ol>
    <p>No account registration or participant private keys are needed. Free tickets use a wallet message signature; depositing tickets, committing your own request and settling require gas.</p>
    <p>Settlement consumes live requests. Prepared groups may expire or be changed by other judges. The status below reports availability; the solver checks whether a match currently works. Other requests in the full market may allow direct swaps.</p>
    <button className="text-button" disabled={busy || waiting} onClick={() => void load()}>Refresh demo groups</button>
    {waiting ? <p role="status">Indexing block #{String(indexingBlock)} before showing updated groups.</p> : <>
      {error && <p role="alert">{error}</p>}
      {status && <p className="quiet mono">Batch {status.batch} / Graph block #{status.snapshotBlock} / index lag {status.lagSeconds}s</p>}
      {status?.groups.map(group => <div key={group.name} className="judge-result">
        <p><strong>{group.name.replaceAll('-', ' ')}</strong> — {group.available ? 'Available to check' : 'Needs another prepared round'}</p>
        {group.expiresAt && <p className="quiet">Earliest signed deadline: {new Date(Number(group.expiresAt) * 1000).toLocaleString()}</p>}
        {!group.available && <p className="quiet">{[...new Set(group.issues.map(i => i.reason))].join(', ')}</p>}
        <div className="judge-actions">
          {[[0, 1], [0, 2], [1, 2], [0, 1, 2]].map(indices => <button key={indices.join('')} className="secondary" disabled={busy || !group.available} onClick={() => onSearch(indices.map(i => group.hashes[i]))}>
            Check {indices.map(i => String.fromCharCode(65 + i)).join(' + ')}
          </button>)}
        <p className="quiet mono">{group.hashes.map((hash, i) => `${String.fromCharCode(65 + i)} ${hash.slice(0, 10)}…`).join(' / ')}</p>
        </div>
      </div>)}
    </>}
  </details>;
}
