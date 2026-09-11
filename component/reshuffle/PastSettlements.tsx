"use client";

import { useEffect, useState } from 'react';
import { getMarketSnapshot, getSettlements } from '@/lib/chain-reads';

export default function PastSettlements({ refreshKey }: { refreshKey?: string }) {
  const [rows, setRows] = useState<{ hash: string; block: string; count: string }[]>([]);
  const [status, setStatus] = useState('Reading settlement history…');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const snapshot = await getMarketSnapshot();
      if (!cancelled) {
        setRows(getSettlements(snapshot).map(row => ({ hash: row.hash, block: row.block, count: row.participants })));
        setStatus(`Settlement history at block ${snapshot.blockNumber}`);
      }
    })().catch(() => { if (!cancelled) setStatus('Settlement history is unavailable. Refresh to retry.'); });
    return () => { cancelled = true; };
  }, [refreshKey]);
  return <section className="rounded border border-white/15 p-4">
    <h2 className="text-lg font-medium">Past settlements</h2>
    <p className="mt-2 text-xs text-white/60">{status}</p>
    <ul className="mt-3 space-y-2">
      {rows.map(row => <li key={row.hash} className="text-sm">
        <a className="text-blue-300 underline" href={`https://testnet.arcscan.app/tx/${row.hash}`} target="_blank" rel="noreferrer">{row.hash.slice(0, 12)}…</a>
        {' · '}{row.count} participants · block {row.block}
      </li>)}
    </ul>
  </section>;
}
