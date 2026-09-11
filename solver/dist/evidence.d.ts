import type { Evidence, Candidate, ExcludedCandidate, Hex } from './types.js';
export declare function buildEvidence(intentsConsidered: number, candidates: Candidate[], excluded: ExcludedCandidate[], chosen: Candidate | null): Evidence;
export declare function addSimulationResult(evidence: Evidence, success: boolean, error?: string): Evidence;
export declare function addTransactionHash(evidence: Evidence, hash: Hex): Evidence;
