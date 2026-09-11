import { search, DEFAULT_CONFIG } from './search.js';
import { rankCandidates } from './rank.js';
import { buildEvidence } from './evidence.js';
import type {
  Intent,
  Leg,
  ChainState,
  SearchConfig,
  Candidate,
  Evidence,
} from './types.js';
import { INTENT_STATE } from './types.js';
import { hashIntent } from './hash.js';

export interface SolverOutput {
  chosen: { intents: Intent[]; legs: Leg[] } | null;
  evidence: Evidence;
}

export function solve(
  allIntents: Intent[],
  state: ChainState,
  config: SearchConfig = DEFAULT_CONFIG
): SolverOutput {
  const liveIntents = allIntents.filter((intent) => {
    const h = hashIntent(intent);
    const s = state.intentState.get(h);
    if (s !== INTENT_STATE.LIVE) return false;
    if (state.blockTimestamp > intent.deadline) return false;
    return true;
  });

  const { candidates, excluded, termination } = search(liveIntents, state, config);
  const ranked = rankCandidates(candidates);
  const chosen: Candidate | null = ranked.length > 0 ? ranked[0] : null;

  const evidence = buildEvidence(
    liveIntents.length,
    candidates,
    excluded,
    chosen
  );
  evidence.search = { termination };

  return {
    chosen: chosen
      ? { intents: chosen.intents, legs: chosen.legs }
      : null,
    evidence,
  };
}
