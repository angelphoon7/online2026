import type { Candidate } from './types.js';
/**
 * Among valid reshuffles found within the search budget, minimise gross cash
 * moved — sum of max(netPayment, 0) over all legs. Ties break toward fewer
 * participants, then the lexicographically smallest ordered set of intent hashes.
 */
export declare function rankCandidates(candidates: Candidate[]): Candidate[];
