import type { Intent, Leg, ChainState, ValidationError } from './types.js';
export declare function validateSettlement(intents: Intent[], legs: Leg[], state: ChainState): ValidationError | null;
/**
 * V5 for one candidate bundle, without a whole settlement.
 *
 * The agent's supply funnel needs to ask "would this intent accept these tickets?" - masks,
 * exactCount, cohesion and adjacency - about bundles that are not part of any proposal. It
 * calls THIS, the same predicate settlement validation uses, rather than carrying a second
 * implementation: two copies of the adjacency rule would eventually disagree, and a diagnosis
 * that contradicts the contract is worse than no diagnosis.
 */
export declare function checkReceivedBundle(intent: Intent, receives: bigint[], state: ChainState): ValidationError | null;
