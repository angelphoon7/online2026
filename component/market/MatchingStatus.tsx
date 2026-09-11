import type { Hex } from 'viem';
import type { WireIntent } from '@/lib/market-types';
import type { SettlementProposal, SolveEvidence } from '@/lib/solve-api';
import { matchingStatus } from '@/lib/matching-status';
import { EXPLORER } from '@/lib/ui-copy';

export default function MatchingStatus({ request, selected, solving, error, proposal, evidence, automatic, resume, busy }: {
  request: WireIntent; selected: Hex[]; solving: boolean; error: string;
  proposal: SettlementProposal | null; evidence: SolveEvidence | null;
  automatic: boolean; resume: () => void; busy: boolean;
}) {
  const status = matchingStatus(request, selected, solving, error, proposal, evidence);
  const live = request.state === 1 && !request.expired;
  return <section className="workspace-panel matching-status" aria-label="Your swap request">
    <span className="eyebrow">Your latest swap request</span>
    <div role="status" aria-live="polite"><h2>{status.title}</h2><p>{status.detail}</p></div>
    <a className="mono hash" href={`${EXPLORER}/tx/${request.commitTx}`} target="_blank" rel="noreferrer">View your intent commitment ↗</a>
    {live && <><p className="quiet">{automatic ? 'Automatically searches the live event pool and retries with public-state refreshes every 30 seconds while this page is open. Each candidate can include two to four participants; the search stops at its time or candidate limit.' : 'Manual search mode. Automatic retries are paused.'}</p>
      {!automatic && <button className="secondary" disabled={busy} onClick={resume}>Resume automatic matching</button>}
      <p className="quiet">You can close the page: the intent stays on-chain and another proposer can settle it while it remains valid. This demo does not run a background settlement worker for you.</p></>}
  </section>;
}
