import type { Intent, ChainState, SearchConfig, SearchResult } from './types.js';
export declare const DEFAULT_CONFIG: SearchConfig;
export declare function search(intents: Intent[], state: ChainState, config?: SearchConfig): SearchResult;
export declare function computeMinGrossPayment(intents: Intent[]): {
    payments: bigint[];
    gross: bigint;
} | null;
export declare function findAssignments(subset: Intent[], pool: bigint[], state: ChainState, limit: number, deadline?: number): bigint[][][];
export declare function combinations<T>(arr: T[], k: number): Generator<T[]>;
