import type { Intent, Leg, ChainState, SearchConfig, Evidence } from './types.js';
export interface SolverOutput {
    chosen: {
        intents: Intent[];
        legs: Leg[];
    } | null;
    evidence: Evidence;
}
export declare function solve(allIntents: Intent[], state: ChainState, config?: SearchConfig): SolverOutput;
