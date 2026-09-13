import type { Hex } from 'viem';
import type { WireIntent } from '@/lib/market-types';
import type { SettlementProposal, SolveEvidence } from '@/lib/solve-api';
import { matchingStatus } from '@/lib/matching-status';
import { EXPLORER } from '@/lib/ui-copy';

export default function MatchingStatus({ request, selected, solving, error, proposal, evidence, wholePool }: {
  request: WireIntent; selected: Hex[]; solving: boolean; error: string;
  proposal: SettlementProposal | null; evidence: SolveEvidence | null;
  wholePool: boolean;
}) {
  const live = request.state === 1 && !request.expired;
  const status = live && wholePool && !solving && !error && !proposal && !evidence
    ? { title: 'Ready to check for a match', detail: 'Click Check all intents to search the current requests.' }
    : matchingStatus(request, wholePool ? [...selected, request.hash] : selected, solving, error, proposal, evidence);
  return <section className="workspace-panel matching-status" aria-label="Your swap request">
    <span className="eyebrow">Your latest swap request</span>
    <p className="mono">Your offered tickets: {request.offered.map(id => `#${id}`).join(', ') || 'None'}</p>
    <div role="status" aria-live="polite"><h2>{status.title}</h2><p>{status.detail}</p></div>
    <a className="mono hash" href={`${EXPLORER}/tx/${request.commitTx}`} target="_blank" rel="noreferrer">View your intent commitment ↗</a>
    {live && <><p className="quiet">Matching searches the pool for a swap that includes this request.</p>
      <p className="quiet">You can close the page: the intent stays on-chain and another proposer can settle it while it remains valid. This demo does not run a background settlement worker for you.</p></>}
  </section>;
}
