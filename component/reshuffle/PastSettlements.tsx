"use client";

import { useEffect, useState } from 'react';
import { parseAbiItem } from 'viem';
import { getPublicClient } from '@/lib/contracts';
import { CONTRACTS } from '@/lib/config';

export default function PastSettlements({ refreshKey }: { refreshKey?: string }) {
  const [rows, setRows] = useState<{ hash: string; block: string; count: string }[]>([]);
  const [status, setStatus] = useState('Reading settlement history…');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const client = getPublicClient();
      const latest = await client.getBlockNumber();
      const deployment = BigInt(process.env.NEXT_PUBLIC_DEPLOYMENT_BLOCK ?? '0');
      const start = latest > deployment + 100000n ? latest - 99999n : deployment;
      const found: typeof rows = [];
      for (let from = start; from <= latest; from += 10000n) {
        if (cancelled) return;
        const logs = await client.getLogs({ address: CONTRACTS.settlement,
          event: parseAbiItem('event Settled(address indexed proposer,bytes32[] intentHashes,uint256 participantCount)'),
          fromBlock: from, toBlock: from + 9999n < latest ? from + 9999n : latest, strict: true });
        for (const log of logs) if (log.transactionHash && log.blockNumber !== null) found.push({ hash: log.transactionHash, block: log.blockNumber.toString(), count: log.args.participantCount.toString() });
      }
      if (!cancelled) {
        setRows(found.reverse());
        setStatus(`Confirmed events from blocks ${start}–${latest}${found.length ? '' : '. No settlements in this range.'}`);
      }
    })().catch(() => { if (!cancelled) setStatus('Settlement history is unavailable. Refresh to retry.'); });
    return () => { cancelled = true; };
  }, [refreshKey]);
  return <section className="rounded border border-white/15 p-4">
    <h2 className="text-lg font-medium">Past settlements</h2>
    <p className="mt-2 text-xs text-white/60">{status}</p>
    <ul className="mt-3 max-h-64 space-y-2 overflow-auto">
      {rows.map(row => <li key={row.hash} className="text-sm">
        <a className="text-blue-300 underline" href={`https://testnet.arcscan.app/tx/${row.hash}`} target="_blank" rel="noreferrer">{row.hash.slice(0, 12)}…</a>
        {' · '}{row.count} participants · block {row.block}
      </li>)}
    </ul>
  </section>;
}
