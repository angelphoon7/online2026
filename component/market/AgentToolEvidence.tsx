import type { CounterpartyIntent, DrawerEvidence, ToolResult, WhatIfResult, PoolOverview } from '@/lib/agent-evidence';
import { EXPLORER } from '@/lib/ui-copy';
import { AGENT_EVIDENCE_COPY as COPY } from '@/lib/agent-copy';

type Label = (owner: string) => string;

export function signedUsdc(units: string) {
  const value = BigInt(units);
  const absolute = value < 0n ? -value : value;
  const fraction = (absolute % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${value < 0n ? 'receives' : 'pays'} ${absolute / 1_000_000n}${fraction ? `.${fraction}` : ''} USDC`;
}

export function CommitmentLinks({ intents, label }: { intents: CounterpartyIntent[]; label: Label }) {
  return <div className="agent-parties">{intents.map(intent => (
    <a key={intent.intentHash} className="hash" href={`${EXPLORER}/tx/${intent.committedTx}`} target="_blank" rel="noreferrer"
      title={`Intent ${intent.intentHash} · owner ${intent.owner} · commit ${intent.committedTx}`}>
      {label(intent.owner)} · intent {intent.intentHash.slice(0, 12)} · commit {intent.committedTx.slice(0, 12)} open
    </a>
  ))}</div>;
}

function Source({ source }: { source: ToolResult<unknown>['source'] }) {
  return source ? <p className="quiet mono">{COPY.sources[source]}</p> : null;
}

function WhatIfEvidence({ result, label }: { result: ToolResult<WhatIfResult>; label: Label }) {
  const { output, index, source } = result;
  return <section className="agent-tool-result" aria-label={`What-if tool result ${index + 1}`}>
    <h4>{COPY.whatIfTitle(index + 1)}</h4>
    <p className="quiet mono">{COPY.intentBlock(output.block, output.intent)}</p>
    <Source source={source} />
    <table className="agent-table" aria-label={COPY.changes}><tbody>
      {Object.entries(output.changes).map(([field, value]) => <tr key={field}>
        <th scope="row">{COPY.changeLabels[field]}</th><td>{COPY.changedValue(field, value)}</td>
      </tr>)}
    </tbody></table>
    {!Object.keys(output.changes).length && <p className="quiet">{COPY.noChanges}</p>}
    {output.unavailable
      ? <p>{COPY.notEvaluated}</p>
      : output.found ? <>
        <p>{COPY.found}</p>
        <table className="agent-table" aria-label={COPY.candidate}><tbody>
          <tr><th scope="row">{COPY.participants}</th><td>{output.participantCount}</td></tr>
          <tr><th scope="row">{COPY.payment}</th><td>{signedUsdc(output.targetNetPay!)}</td></tr>
          <tr><th scope="row">{COPY.receives}</th><td>{output.receives.length ? COPY.tickets(output.receives) : COPY.noTickets}</td></tr>
        </tbody></table>
        <h4>{COPY.commitments}</h4>
        <CommitmentLinks intents={output.counterpartyIntents} label={label} />
        {!output.counterpartyIntents.length && <p className="quiet">{COPY.noCommitments}</p>}
      </> : <p>{COPY.notFound}</p>}
    <p className="quiet mono">{output.unavailable ? COPY.searchNotRun : COPY.bound}: {COPY.bounds(output.bounds.maxParticipants, output.bounds.maxCandidates, output.bounds.timeoutMs)}</p>
    <p className="quiet">{COPY.hypothetical}</p>
  </section>;
}

function OverviewEvidence({ result }: { result: ToolResult<PoolOverview> }) {
  const { output, index, source } = result;
  return <section className="agent-tool-result" aria-label={`Pool overview tool result ${index + 1}`}>
    <h4>{COPY.overviewTitle(index + 1)}</h4>
    <p className="quiet mono">{COPY.poolBlock(output.block)}</p>
    <Source source={source} />
    <table className="agent-table" aria-label={COPY.poolTotals}><tbody>
      <tr><th scope="row">{COPY.liveIntents}</th><td>{output.liveIntents}</td></tr>
      <tr><th scope="row">{COPY.escrowedTickets}</th><td>{output.escrowedTickets}</td></tr>
      <tr><th scope="row">{COPY.buyers}</th><td>{output.pureBuyers}</td></tr>
      <tr><th scope="row">{COPY.sellers}</th><td>{output.pureSellers}</td></tr>
    </tbody></table>
    <h4>{COPY.sessionHeading}</h4>
    {output.bySession.length ? <table className="agent-table" aria-label={COPY.sessions}><tbody>
      {output.bySession.map(row => <tr key={row.sessionId}><th scope="row">Session {row.sessionId}</th><td>{row.tickets}</td></tr>)}
    </tbody></table> : <p className="quiet">{COPY.noSessions}</p>}
    <h4>{COPY.sectionHeading}</h4>
    {output.bySection.length ? <table className="agent-table" aria-label={COPY.sections}><tbody>
      {output.bySection.map(row => <tr key={row.sectionId}><th scope="row">Section {row.sectionId}</th><td>{row.tickets}</td></tr>)}
    </tbody></table> : <p className="quiet">{COPY.noSections}</p>}
    <h4>{COPY.excluded}</h4>
    {Object.keys(output.excludedByReason).length ? <table className="agent-table" aria-label={COPY.exclusionReasons}><tbody>
      {Object.entries(output.excludedByReason).map(([reason, count]) => <tr key={reason}><th scope="row">{reason}</th><td>{count}</td></tr>)}
    </tbody></table> : <p className="quiet">{COPY.noExclusions}</p>}
    <p className="quiet">{COPY.poolNote}</p>
  </section>;
}

/** Evidence is independent of a baseline diagnosis: the model may only request a pool or what-if tool. */
export default function AgentToolEvidence({ view, label }: { view: DrawerEvidence; label: Label }) {
  return <>
    {view.hypotheticals.map(result => <WhatIfEvidence key={result.index} result={result} label={label} />)}
    {view.overviews.map(result => <OverviewEvidence key={result.index} result={result} />)}
    {view.failures.map(failure => <section className="agent-tool-result" key={failure.index}>
      <h4>{COPY.failed} · {failure.tool} · call {failure.index + 1}</h4>
      <p>{failure.code ? `${failure.code}: ` : ''}{failure.error}</p>
      <p className="quiet">{COPY.failureNote}</p>
    </section>)}
    {view.omitted > 0 && <p className="quiet">{COPY.omitted(view.omitted)}</p>}
    <details className="agent-raw">
      <summary>{COPY.raw}</summary>
      <p className="quiet">{COPY.rawNote}</p>
      <pre>{JSON.stringify(view.entries, null, 2)}</pre>
    </details>
  </>;
}
