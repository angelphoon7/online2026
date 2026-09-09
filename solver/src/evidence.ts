import type { Evidence, Candidate, ExcludedCandidate, Hex } from './types.js';

export function buildEvidence(
  intentsConsidered: number,
  candidates: Candidate[],
  excluded: ExcludedCandidate[],
  chosen: Candidate | null
): Evidence {
  return {
    timestamp: new Date().toISOString(),
    intentsConsidered,
    candidatesFound: candidates.length,
    candidatesExcluded: excluded,
    chosen: chosen
      ? {
          intentHashes: chosen.intentHashSet,
          gross: chosen.gross.toString(),
          reason: describeChoice(chosen, candidates.length),
        }
      : null,
  };
}

function describeChoice(chosen: Candidate, totalCandidates: number): string {
  return (
    `Least cash moved among ${totalCandidates} candidate${totalCandidates === 1 ? '' : 's'} ` +
    `found within the search budget: ${chosen.gross.toString()} gross, ` +
    `${chosen.participantCount} participant${chosen.participantCount === 1 ? '' : 's'}`
  );
}

export function addSimulationResult(
  evidence: Evidence,
  success: boolean,
  error?: string
): Evidence {
  return { ...evidence, simulationResult: { success, error } };
}

export function addTransactionHash(evidence: Evidence, hash: Hex): Evidence {
  return { ...evidence, transactionHash: hash };
}
