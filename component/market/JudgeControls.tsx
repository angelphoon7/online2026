"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Address, Hex } from 'viem';
import { EXPLORER } from '@/lib/ui-copy';
import { MarketFreshness, requireSnapshotBlock } from '@/lib/market-freshness';

// Judge controls - plan 6-D, and beat 2 of the run of show.
//
// A judge changes a signed condition and the system responds: the change is a real transaction
// on Arc, the subgraph observes it, the pool the solver searches is genuinely different, and
// the answer changes. Nothing here edits local state to imitate that.
//
// A budget change cannot be an edit. maxNetPay is a signed field of the intent and the intent
// hash covers it, so the old intent is revoked and a new one is committed under a NEW hash.
// The selection below follows that new hash, because from here on it is a different intent.

export type JudgeIntent = {
  hash: Hex;
  owner: Address;
  maxNetPay: string;
  maxNetPayUsdc: number;
  exactCount: number;
  mustBeAdjacent: boolean;
};

export type BudgetChange = { revokeTx: Hex; commitTx: Hex; commitBlock: string; newHash: Hex; oldHash: Hex };
export type Revocation = { revokeTx: Hex; revokeBlock: string; intentHash: Hex };

type Props = {
  freshness: MarketFreshness;
  busy: boolean;
  /** Market's participant labelling, so "Wallet 2" means the same thing in both places. */
  label: (owner: string) => string;
  onBudget: (hash: Hex, usdc: number) => Promise<BudgetChange>;
  onRevoke: (hash: Hex) => Promise<Revocation>;
};

const signedLimit = (usdc: number) =>
  usdc > 0 ? `pays up to ${usdc} USDC` : usdc < 0 ? `must receive at least ${-usdc} USDC` : 'pays nothing';

export default function JudgeControls({ busy, label, onBudget, onRevoke, freshness }: Props) {
  const { floor, indexingBlock } = useSyncExternalStore(freshness.subscribe, freshness.getSnapshot, freshness.getServerSnapshot);
  const [pool, setPool] = useState<JudgeIntent[] | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [hash, setHash] = useState<Hex | ''>('');
  // The typed budget, tagged with the intent it was typed for. Derived rather than mirrored
  // into state by an effect: the field then shows the on-chain value automatically whenever the
  // selection moves, including onto the new hash a budget change just created.
  const [edited, setEdited] = useState<{ hash: string; value: string } | null>(null);
  const [change, setChange] = useState<BudgetChange | Revocation | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState('');

  const load = useCallback(async (select?: Hex) => {
    const ticket = freshness.getSnapshot();
    if (ticket.indexingBlock !== null) { if (select) setHash(select); return; }
    try {
      const response = await fetch(`/api/demo/budget?minBlock=${ticket.floor}`, { cache: 'no-store' });
      const data = await response.json();
      if (!freshness.current(ticket.revision)) return;
      if (!response.ok) throw new Error(data.error ?? 'Judge controls unavailable');
      if (data.enabled) requireSnapshotBlock(data.snapshotBlock, ticket.floor);
      setEnabled(!!data.enabled);
      setPool(data.intents ?? []);
      // Keep the current selection while it is still live; otherwise follow the hash a change
      // produced, and fall back to the first controllable intent.
      setHash(previous => {
        const next = select ?? previous;
        const live = (data.intents ?? []).some((i: JudgeIntent) => i.hash.toLowerCase() === String(next).toLowerCase());
        return live ? (next as Hex) : (data.intents?.[0]?.hash ?? '');
      });
    } catch (e) {
      if (!freshness.current(ticket.revision)) return;
      setEnabled(false);
      setPool([]);
      setError(e instanceof Error ? e.message : 'Judge controls unavailable');
    }
  }, [freshness]);

  useEffect(() => { if (indexingBlock === null) void Promise.resolve().then(() => load()); }, [load, floor, indexingBlock]);

  const selected = pool?.find(i => i.hash.toLowerCase() === String(hash).toLowerCase());
  const budget = edited && selected && edited.hash === selected.hash ? edited.value : String(selected?.maxNetPayUsdc ?? '');

  if (!enabled || !pool?.length) return null;
  const locked = busy || !!running;

  const run = async (
    name: string,
    call: () => Promise<BudgetChange | Revocation>,
    select?: (result: BudgetChange | Revocation) => Hex | undefined
  ) => {
    setRunning(name); setError(''); setChange(null);
    try {
      const result = await call();
      setChange(result);
      setEdited(null);
      await load(select?.(result));
    } catch (e) {
      setError(e instanceof Error ? e.message : `${name} failed`);
      // Reload either way: a budget change revokes before it commits, so a failure partway
      // through has still changed chain state and the list must show what is actually live.
      await load();
    } finally {
      setRunning('');
    }
  };

  const apply = () => {
    const usdc = Number(budget);
    if (!selected || budget.trim() === '' || !Number.isFinite(usdc)) { setError('Enter a signed USDC amount.'); return; }
    if (usdc === selected.maxNetPayUsdc) { setError('That is already this budget; nothing would change on-chain.'); return; }
    void run('Apply budget', () => onBudget(selected.hash, usdc), result => (result as BudgetChange).newHash);
  };

  return <details className="dishonest judge">
    <summary>Judge controls / change a signed condition</summary>
    <p>Real transactions, signed by the seeded demo participants whose keys this server holds. A budget change is a <span className="mono">revoke</span> followed by a <span className="mono">commit</span> under a new intent hash, because <span className="mono">maxNetPay</span> is a signed field and the hash covers it.</p>

    <label htmlFor="judge-intent">Participant intent</label>
    <select id="judge-intent" value={hash} disabled={locked} onChange={e => setHash(e.target.value as Hex)}>
      {pool.map(i => <option key={i.hash} value={i.hash}>
        {label(i.owner)} / wants {i.exactCount}{i.mustBeAdjacent ? ' adjacent' : ''} / {signedLimit(i.maxNetPayUsdc)}
      </option>)}
    </select>

    {selected && <>
      <div className="judge-row">
        <label htmlFor="judge-budget">New signed limit (USDC)</label>
        <input id="judge-budget" type="number" step="0.5" value={budget} disabled={locked} onChange={e => setEdited({ hash: selected.hash, value: e.target.value })} />
        <span className="quiet">positive pays, negative must be paid</span>
      </div>
      <div className="judge-actions">
        <button className="secondary" disabled={locked} onClick={apply}>{running === 'Apply budget' ? 'Applying on-chain...' : 'Apply budget'}</button>
        <button className="text-button" disabled={locked} onClick={() => void run('Revoke participant', () => onRevoke(selected.hash))}>
          {running === 'Revoke participant' ? 'Revoking on-chain...' : 'Revoke this participant'}
        </button>
      </div>
      <p className="quiet mono">On-chain now: {selected.maxNetPay} contract units / intent {selected.hash.slice(0, 10)}...</p>
    </>}

    {change && <div className="judge-result">
      {'commitTx' in change
        ? <>
            <p>Budget changed on-chain in block <span className="mono">{change.commitBlock}</span>. The intent has a new hash from here on.</p>
            <a className="hash" href={`${EXPLORER}/tx/${change.revokeTx}`} target="_blank" rel="noreferrer">Revoke {change.revokeTx.slice(0, 12)} open</a>
            <a className="hash" href={`${EXPLORER}/tx/${change.commitTx}`} target="_blank" rel="noreferrer">Commit {change.commitTx.slice(0, 12)} open</a>
            <p className="quiet mono">{change.oldHash.slice(0, 10)} to {change.newHash.slice(0, 10)}</p>
          </>
        : <>
            <p>Intent revoked on-chain in block <span className="mono">{change.revokeBlock}</span>. It is out of the pool.</p>
            <a className="hash" href={`${EXPLORER}/tx/${change.revokeTx}`} target="_blank" rel="noreferrer">Revoke {change.revokeTx.slice(0, 12)} open</a>
          </>}
    </div>}

    {error && <p role="alert">{error}</p>}
  </details>;
}
