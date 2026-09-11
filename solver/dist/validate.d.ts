import type { Intent, Leg, ChainState, ValidationError } from './types.js';
export declare function validateSettlement(intents: Intent[], legs: Leg[], state: ChainState): ValidationError | null;
