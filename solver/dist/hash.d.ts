import type { Intent, Hex } from './types.js';
export declare const INTENT_TYPEHASH: Hex;
export declare function hashOffered(offered: bigint[]): Hex;
export declare function hashIntent(intent: Intent): Hex;
