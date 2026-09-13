"use client";
import { useEffect, useRef, useState } from 'react';
import type { MarketSnapshot } from '@/lib/market-types';
import type { SolveEvidence } from '@/lib/solve-api';
import { DEPLOYMENT } from '@/lib/deployment';
import { EXPLORER } from '@/lib/ui-copy';
import { truncateAddress } from '@/lib/format';
import { graphManifestLink, readGraphDetails, subgraphStudioLink, type GraphDetail, type GraphSelection } from '@/lib/graph-details';
import styles from './GraphDetails.module.css';

export default function GraphDetails({ market, evidence, initialIntent, onClose }: {
  market: MarketSnapshot | null; evidence: SolveEvidence | null; initialIntent?: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const detailPanel = useRef<HTMLElement>(null);
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<'intent' | 'settlement'>('intent');
  const [selected, setSelected] = useState<GraphSelection | null>(() => initialIntent ? { kind: 'intent', hash: initialIntent, minBlock: market?.blockNumber ?? '0' } : null);
  const [data, setData] = useState<GraphDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!!initialIntent);
  const [copied, setCopied] = useState('');
  useEffect(() => {
    const node = dialog.current!;
    const overflow = document.body.style.overflow;
    node.showModal(); document.body.style.overflow = 'hidden';
    return () => { if (node.open) node.close(); document.body.style.overflow = overflow; };
  }, []);
  useEffect(() => {
    if (!selected) return;
    detailPanel.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const controller = new AbortController();
    void readGraphDetails(selected, AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]))
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Graph details are unavailable.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selected]);
  const inspect = (kind: GraphSelection['kind'], hash: string) => {
    setData(null); setError(''); setCopied(''); setLoading(true);
    setSelected({ kind, hash, minBlock: market?.blockNumber ?? '0' });
  };
  const copy = (value: string) => void navigator.clipboard.writeText(value).then(() => setCopied('Copied')).catch(() => setCopied('Select the hash to copy it.'));
  const needle = filter.trim().toLowerCase();
  const intents = (market?.intents ?? []).filter(row => `${row.hash} ${row.owner} ${row.commitTx}`.toLowerCase().includes(needle));
  const settlements = (market?.settlements ?? []).filter(row => row.hash.toLowerCase().includes(needle));
  const studio = subgraphStudioLink(DEPLOYMENT.subgraphUrl);
  const deployment = data?._meta.deployment ?? DEPLOYMENT.subgraphDeployment;
  const manifest = graphManifestLink(deployment);
  const commit = selected?.kind === 'intent' ? market?.intents.find(row => row.hash.toLowerCase() === selected.hash.toLowerCase())?.commitTx : selected?.hash;
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="graph-details-title" onClose={event => { if (!event.currentTarget.open) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) event.currentTarget.close(); } }}>
    <header className={styles.header}><div><span className="eyebrow">RESHUFFLE / DATA</span><h2 id="graph-details-title">The Graph</h2></div><button className="secondary" onClick={() => dialog.current?.close()} aria-label="Close Graph details">Close ×</button></header>
    <div className={styles.body}>
      <p className={styles.source}>{market?.source === 'graph' ? 'Market source: The Graph' : market ? 'Market source: Arc RPC fallback' : 'Market data is loading.'}
        {market && <> · <a href={`${EXPLORER}/block/${market.blockNumber}`} target="_blank" rel="noreferrer">Block {market.blockNumber} ↗</a></>}</p>
      <div className={styles.links}>
        {studio && <a href={studio} target="_blank" rel="noreferrer">Open Subgraph Studio ↗</a>}
        {DEPLOYMENT.subgraphUrl && <a href={DEPLOYMENT.subgraphUrl} target="_blank" rel="noreferrer">Project query endpoint ↗</a>}
        {evidence && <a href={`/api/evidence/${evidence.id}`} target="_blank" rel="noreferrer">Search evidence ↗</a>}
      </div>
      {deployment && <div className={styles.deployment}><span>{data ? 'Queried deployment' : 'Project deployment'} · </span>{manifest ? <a href={manifest} target="_blank" rel="noreferrer">{deployment} ↗</a> : <span>{deployment}</span>}</div>}
      <p className={styles.hint}>Select a hash to read its indexed record from The Graph. Transaction links open on Arc explorer.</p>
      {selected && <section ref={detailPanel} className={styles.detail} aria-label="Selected Graph record">
        <div className={styles.detailHeading}><h3>{selected.kind === 'intent' ? 'Intent details' : 'Settlement details'}</h3><button className="text-button" onClick={() => { setSelected(null); setData(null); setError(''); setLoading(false); }}>Back to hashes</button></div>
        <div className={styles.hash}>{selected.hash}</div>
        <div className={styles.links}><button className="text-button" onClick={() => copy(selected.hash)}>Copy hash</button>{commit && <a href={`${EXPLORER}/tx/${commit}`} target="_blank" rel="noreferrer">{selected.kind === 'intent' ? 'Commit transaction' : 'Settlement transaction'} ↗</a>}{copied && <span role="status">{copied}</span>}</div>
        {loading && <p role="status">Reading this record from The Graph…</p>}
        {error && <div role="alert"><p>{error}</p><button className="text-button" onClick={() => inspect(selected.kind, selected.hash)}>Retry Graph details</button></div>}
        {data && <><p className={styles.source}>Source: The Graph · <a href={`${EXPLORER}/block/${data._meta.block.number}`} target="_blank" rel="noreferrer">Indexed block {data._meta.block.number} ↗</a></p>
          <pre aria-label="Graph record JSON">{JSON.stringify(data, null, 2)}</pre></>}
      </section>}
      <div className={styles.tabs} role="group" aria-label="Hash type"><button aria-pressed={tab === 'intent'} onClick={() => setTab('intent')}>Intents ({market?.intents.length ?? 0})</button><button aria-pressed={tab === 'settlement'} onClick={() => setTab('settlement')}>Settlements ({market?.settlements.length ?? 0})</button></div>
      <input className={styles.filter} aria-label="Find hash or wallet" placeholder="Find hash or wallet" value={filter} onChange={event => setFilter(event.target.value)} />
      <ul className={styles.list} aria-label={tab === 'intent' ? 'Intent hashes' : 'Settlement hashes'}>
        {tab === 'intent' ? intents.map(row => <li key={row.hash}><div className={styles.rowMeta}><span>{row.expired && row.state === 1 ? 'Expired' : ({ 1: 'Live', 2: 'Revoked', 3: 'Settled' }[row.state] ?? 'Unknown')}</span><a href={`${EXPLORER}/address/${row.owner}`} title={row.owner} target="_blank" rel="noreferrer">{truncateAddress(row.owner)} ↗</a></div><button className={styles.hashButton} onClick={() => inspect('intent', row.hash)}>{row.hash}</button><a className={styles.commit} href={`${EXPLORER}/tx/${row.commitTx}`} target="_blank" rel="noreferrer">Commit {row.commitTx} ↗</a></li>)
          : settlements.map((row, index) => <li key={`${row.hash}:${index}`}><div className={styles.rowMeta}><span>{row.participants} participants</span><a href={`${EXPLORER}/block/${row.block}`} target="_blank" rel="noreferrer">Block {row.block} ↗</a></div><button className={styles.hashButton} onClick={() => inspect('settlement', row.hash)}>{row.hash}</button><a className={styles.commit} href={`${EXPLORER}/tx/${row.hash}`} target="_blank" rel="noreferrer">View transaction ↗</a></li>)}
      </ul>
      {!(tab === 'intent' ? intents : settlements).length && <p className={styles.hint}>{market ? 'No matching hashes.' : 'Hashes will appear when market data loads.'}</p>}
    </div>
  </dialog>;
}
