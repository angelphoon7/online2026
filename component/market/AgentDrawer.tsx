"use client";

import { useCallback, useEffect, useState } from 'react';
import type { Hex } from 'viem';
import { EXPLORER } from '@/lib/ui-copy';

// The Agent drawer - step 8 of docs/RESHUFFLE_GRAPH_PLAN.md.
//
// The judge-facing surface of the AI use case. Three things have to be visible at once, or the
// answer is not checkable:
//
//   1. The block every claim refers to, next to the chain head, so indexer lag is shown rather
//      than hidden. A drawer that quietly answers from an old pool is the failure this whole
//      design is built to avoid.
//   2. The answer.
//   3. The evidence it came from - the supply funnel with a count per stage, each relaxation
//      with whether it worked, and the counterparties linked to the transaction that committed
//      their intent. "How do you know that?" is answerable by expanding this.
//
// The agent is read-only. It can say a change would produce a reshuffle; it cannot sign one,
// and the copy says so wherever a hypothetical appears.

type Relaxation = {
  change: string;
  found: boolean;
  counterparties: string[];
  participantCount: number | null;
  targetNetPay: string | null;
};

type Evidence = {
  block: string;
  intent: string;
  status: 'SETTLEABLE' | 'NOT_FOUND_WITHIN_BOUND' | 'EXCLUDED' | 'CLOSED' | 'UNKNOWN';
  exclusion?: { reason: string; detail?: string };
  closed?: { state: string; tx: string | null };
  settleable?: { counterparties: string[]; participantCount: number; targetNetPay: string };
  supply?: {
    stages: { stage: string; remaining: number }[];
    firstZero: string | null;
    blockedAt: string | null;
    largestGroup: number;
    need: number;
    truncated: boolean;
  };
  demand?: { perTicket: { ticket: string; acceptingIntents: number }[]; unwanted: string[] };
  relaxations: Relaxation[];
  bounds: { maxParticipants: number; maxCandidates: number; timeoutMs: number; budgetCapUsdc: number };
  counterpartyTx: Record<string, string>;
  runtimeMs: number;
};

type AskResponse = {
  answer: string;
  guardFallback: boolean;
  guardReason?: string;
  evidence: { tool: string; input: unknown; output: unknown }[];
  block: string;
  model: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  /** The intent in question. Follows the new hash after a judge changes a budget. */
  intentHash: Hex | null;
  /** Chain head from RPC, so lag is displayed rather than inferred. */
  chainBlock: string | null;
  /** Non-null while a transaction is being indexed; asking is disabled until it clears. */
  indexingBlock: bigint | null;
  label: (owner: string) => string;
};

const SUGGESTIONS = [
  "Why can't this intent settle?",
  'What if I drop the adjacency requirement?',
  'What if I accept another section?',
];

const STAGE_LABEL: Record<string, string> = {
  offeredByOthers: 'Offered by others',
  eventId: 'Same event',
  session: 'Session accepted',
  section: 'Section accepted',
  cohesiveGroup: 'Largest group that fits the conditions',
};

const USDC = 1_000_000n;
const signedUsdc = (units: string) => {
  const value = BigInt(units);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / USDC;
  const fraction = (absolute % USDC).toString().padStart(6, '0').replace(/0+$/, '');
  return `${negative ? 'receives ' : 'pays '}${whole}${fraction ? `.${fraction}` : ''} USDC`;
};

const CHANGE_LABEL: Record<string, string> = {
  'maxNetPay->cap': 'Raise the payment limit',
  'mustBeAdjacent=false': 'Drop adjacent seats',
  'mustShareSection=false': 'Allow different sections',
  'mustShareSession=false': 'Allow different sessions',
};
const changeLabel = (change: string) =>
  CHANGE_LABEL[change] ??
  change.replace(/^addSection=(\d+)$/, 'Also accept section $1').replace(/^addSession=(\d+)$/, 'Also accept session $1');

export default function AgentDrawer({ open, onClose, intentHash, chainBlock, indexingBlock, label }: Props) {
  const [question, setQuestion] = useState('');
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  // Everything the drawer shows is tagged with the intent it describes and rendered only when
  // the tag still matches. A judge changing a budget produces a NEW hash, and an answer about
  // the revoked one must disappear the moment the drawer moves - deriving that from the tag
  // is what guarantees it, rather than remembering to clear three pieces of state.
  const [answer, setAnswer] = useState<{ hash: Hex; data: AskResponse } | null>(null);
  const [held, setHeld] = useState<{ hash: Hex; data: Evidence } | null>(null);
  const [phase, setPhase] = useState<{ hash: Hex; value: 'asking' | 'answered' | 'error'; error?: string } | null>(null);

  const forThis = <T,>(tagged: { hash: Hex; data: T } | null) =>
    tagged && intentHash && tagged.hash.toLowerCase() === intentHash.toLowerCase() ? tagged.data : null;
  const shown = forThis(answer);
  const evidence = forThis(held);
  const current = phase && intentHash && phase.hash.toLowerCase() === intentHash.toLowerCase() ? phase : null;
  const state = current?.value ?? 'idle';
  const error = current?.error ?? '';

  // The evidence is fetched without the model, from the same endpoint a judge can call
  // directly, so the block in the header is real before any question is asked.
  const loadEvidence = useCallback(async (hash: Hex) => {
    try {
      const response = await fetch(`/api/agent/diagnose/${hash}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Diagnosis unavailable');
      setHeld({ hash, data: body as Evidence });
    } catch (e) {
      setPhase({ hash, value: 'error', error: e instanceof Error ? e.message : 'Diagnosis unavailable' });
    }
  }, []);

  useEffect(() => {
    if (!open || !intentHash) return;
    void Promise.resolve().then(() => loadEvidence(intentHash));
  }, [open, intentHash, loadEvidence]);

  if (!open) return null;

  const indexing = indexingBlock !== null;
  const block = evidence?.block ?? shown?.block ?? null;
  const lag = block && chainBlock ? Number(BigInt(chainBlock) - BigInt(block)) : null;

  const ask = async (text: string) => {
    if (!intentHash || !text.trim()) return;
    const hash = intentHash;
    setPhase({ hash, value: 'asking' }); setAnswer(null);
    try {
      const response = await fetch('/api/agent/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intentHash, question: text.trim() }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          response.status === 409
            ? `The indexer has not caught up yet${body.indexedBlock ? ` (at block ${body.indexedBlock})` : ''}. Wait a moment and ask again.`
            : (body.error ?? 'The agent could not answer')
        );
      }
      setAnswer({ hash, data: body as AskResponse });
      setPhase({ hash, value: 'answered' });
      // The answer's own tool results are the authoritative evidence for it; prefer them over
      // the diagnosis fetched before the question was asked.
      const diagnosis = (body as AskResponse).evidence.find((entry) => entry.tool === 'diagnose_intent');
      if (diagnosis) setHeld({ hash, data: diagnosis.output as Evidence });
    } catch (e) {
      setPhase({ hash, value: 'error', error: e instanceof Error ? e.message : 'The agent could not answer' });
    }
  };

  return <aside className="agent-drawer" role="dialog" aria-modal="false" aria-label="Settlement agent">
    <header>
      <div>
        <p className="mono agent-live">
          {indexing
            ? `INDEXING BLOCK ${indexingBlock}…`
            : block
              ? `LIVE · ARC TESTNET BLOCK #${block} · VIA THE GRAPH`
              : 'READING THE POOL'}
        </p>
        {/* Lag is published, not hidden: the answer is about the indexed block, not the head. */}
        {chainBlock && block && <p className="quiet mono">chain head #{chainBlock} · lag {lag}</p>}
      </div>
      <button className="text-button" onClick={onClose} aria-label="Close agent">Close</button>
    </header>

    {!intentHash && <p className="quiet">Select an intent to ask about it.</p>}

    {intentHash && <>
      <p className="quiet mono">Intent {intentHash.slice(0, 10)}…{evidence ? ` · ${evidence.status.replace(/_/g, ' ').toLowerCase()}` : ''}</p>

      <div className="agent-suggestions">
        {SUGGESTIONS.map(suggestion => (
          <button key={suggestion} className="secondary" disabled={indexing || state === 'asking'} onClick={() => { setQuestion(suggestion); void ask(suggestion); }}>
            {suggestion}
          </button>
        ))}
      </div>

      <form className="agent-ask" onSubmit={event => { event.preventDefault(); void ask(question); }}>
        <label htmlFor="agent-question">Ask about this intent</label>
        <input
          id="agent-question"
          value={question}
          maxLength={500}
          disabled={indexing || state === 'asking'}
          placeholder="Why can't this intent settle?"
          onChange={event => setQuestion(event.target.value)}
        />
        <button className="primary" type="submit" disabled={indexing || state === 'asking' || !question.trim()}>
          {state === 'asking' ? 'Checking the pool…' : 'Ask'}
        </button>
      </form>

      {indexing && <p className="quiet" role="status">Waiting for the indexer to reach block {String(indexingBlock)} before answering, so the answer is not about an older pool.</p>}
      {error && <p role="alert">{error}</p>}

      {shown && <div className="agent-answer"><p>{shown.answer}</p>
        <p className="quiet mono">
          {shown.model ? `narrated by ${shown.model}` : 'deterministic answer · no model configured'} · read-only · the agent holds no key
        </p>
      </div>}

      {evidence && <details className="agent-evidence" open={evidenceOpen} onToggle={event => setEvidenceOpen(event.currentTarget.open)}>
        <summary>Evidence</summary>

        {evidence.exclusion && <p className="quiet">Excluded from matching: <span className="mono">{evidence.exclusion.reason}</span>{evidence.exclusion.detail ? ` (ticket #${evidence.exclusion.detail})` : ''}. Settlement rejects it on the same check.</p>}

        {evidence.closed && <p className="quiet">No longer live: <span className="mono">{evidence.closed.state}</span>{evidence.closed.tx && <> · <a className="hash" href={`${EXPLORER}/tx/${evidence.closed.tx}`} target="_blank" rel="noreferrer">{evidence.closed.tx.slice(0, 12)} open</a></>}</p>}

        {evidence.settleable && <p className="quiet">A reshuffle exists now: {evidence.settleable.participantCount} participants, this intent {signedUsdc(evidence.settleable.targetNetPay)}.</p>}

        {evidence.supply && <>
          <h4>Do the tickets it wants exist?</h4>
          <table className="agent-table"><tbody>
            {evidence.supply.stages.map(stage => (
              <tr key={stage.stage} className={evidence.supply!.blockedAt === stage.stage ? 'agent-blocked' : undefined}>
                <th scope="row">{STAGE_LABEL[stage.stage] ?? stage.stage}</th>
                <td className="mono">{stage.remaining}</td>
              </tr>
            ))}
          </tbody></table>
          <p className="quiet">Asks for exactly {evidence.supply.need}. This is a necessary condition only: tickets existing does not mean a whole reshuffle exists.{evidence.supply.truncated ? ' The candidate set was capped before the group search.' : ''}</p>
        </>}

        {evidence.demand && !!evidence.demand.perTicket.length && <>
          <h4>Does anyone accept what it offers?</h4>
          <table className="agent-table"><tbody>
            {evidence.demand.perTicket.map(ticket => (
              <tr key={ticket.ticket} className={ticket.acceptingIntents === 0 ? 'agent-blocked' : undefined}>
                <th scope="row">Ticket #{ticket.ticket}</th>
                <td className="mono">{ticket.acceptingIntents} accepting</td>
              </tr>
            ))}
          </tbody></table>
        </>}

        {!!evidence.relaxations.length && <>
          <h4>Single changes tried</h4>
          <table className="agent-table"><tbody>
            {evidence.relaxations.map(relaxation => (
              <tr key={relaxation.change}>
                <th scope="row">{changeLabel(relaxation.change)}</th>
                <td className="mono">{relaxation.found ? 'settles' : 'no settlement found'}</td>
                <td className="mono">
                  {relaxation.found && relaxation.targetNetPay !== null
                    ? `${relaxation.participantCount} participants · ${signedUsdc(relaxation.targetNetPay)}`
                    : ''}
                </td>
              </tr>
            ))}
          </tbody></table>
          <p className="quiet">Hypothetical. Each was re-run through the solver at this block; acting on one means signing a new intent, and nothing moves until then. Only single changes were tried.</p>
        </>}

        {!!Object.keys(evidence.counterpartyTx).length && <>
          <h4>Counterparties in the pool</h4>
          <div className="agent-parties">
            {Object.entries(evidence.counterpartyTx).map(([address, tx]) => (
              <a key={address} className="hash" href={`${EXPLORER}/tx/${tx}`} target="_blank" rel="noreferrer">
                {label(address)} · commit {tx.slice(0, 12)} open
              </a>
            ))}
          </div>
        </>}

        <p className="quiet mono">
          Search bound: {evidence.bounds.maxParticipants} participants, {evidence.bounds.maxCandidates} candidates,
          {' '}{evidence.bounds.timeoutMs}ms, budget relaxation ceiling {evidence.bounds.budgetCapUsdc} USDC.
          Diagnosis ran in {Math.round(evidence.runtimeMs)}ms.
        </p>
        <p className="quiet">No settlement found means none was found within that bound.</p>
      </details>}
    </>}
  </aside>;
}
