import type { Intent, Leg, ChainState, SearchConfig, Candidate, Evidence } from './types.js';
export interface SolverOutput {
    candidates: Candidate[];
    chosen: {
        intents: Intent[];
        legs: Leg[];
    } | null;
    evidence: Evidence;
}
export declare function solve(allIntents: Intent[], state: ChainState, config?: SearchConfig): SolverOutput;
