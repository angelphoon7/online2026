// The one definition of an intent's identity, shared by the frontend, the backend and the
// solver — step 5-A of docs/RESHUFFLE_GRAPH_PLAN.md.
//
// hashIntent() is NOT reimplemented here. It is re-exported from the solver, which is where
// the single implementation lives and where its fixture test runs. EIP-712 hashes
// positionally, so a second copy that drifted by one field would surface at commit time as
// "signature does not recover to owner" — which reads like a wallet bug and is very hard to
// trace back. One implementation, imported everywhere.
//
// The registry keys on the BARE STRUCT HASH, not the EIP-712 digest (IntentRegistry.sol:114).
// That is what makes trust rule 1 work: an intent read back from the subgraph re-hashes to
// exactly the id it was published under, which binds all twelve signed fields at once.
//
// Importing from solver/dist/hash.js rather than solver/dist/index.js keeps the search and
// validation code out of any bundle that only needs the hash.

export { hashIntent, hashOffered, INTENT_TYPEHASH } from '@/solver/dist/hash.js';
export type { Intent, TicketMeta, Hex, Address } from '@/solver/dist/types.js';

import type { Intent } from '@/solver/dist/types.js';

/**
 * An Intent exactly as the subgraph returns it: every numeric field is a string, and
 * addresses and bytes are lowercase hex.
 */
export type GraphIntent = {
  id: string;
  owner: string;
  eventId: number | string;
  offered: string[];
  sessionMask: string;
  sectionMask: string;
  exactCount: number | string;
  mustShareSession: boolean;
  mustShareSection: boolean;
  mustBeAdjacent: boolean;
  maxNetPay: string;
  deadline: string;
  nonce: string;
};

/**
 * Convert a subgraph intent into the struct the contract and solver use.
 *
 * Field order here is irrelevant — hashIntent() encodes positionally from named fields — but
 * the order of `offered` is not: it hashes as keccak256(abi.encodePacked(offered)), so
 * re-sorting it silently changes the hash and the intent would be discarded as unbindable.
 *
 * maxNetPay is signed. BigInt() parses a leading "-" correctly, which is the whole reason the
 * subgraph stores it as a string rather than a number.
 */
export function fromGraph(g: GraphIntent): Intent {
  return {
    owner: g.owner as `0x${string}`,
    offered: g.offered.map((id) => BigInt(id)),
    eventId: Number(g.eventId),
    sessionMask: BigInt(g.sessionMask),
    sectionMask: BigInt(g.sectionMask),
    exactCount: Number(g.exactCount),
    mustShareSession: g.mustShareSession,
    mustShareSection: g.mustShareSection,
    mustBeAdjacent: g.mustBeAdjacent,
    maxNetPay: BigInt(g.maxNetPay),
    deadline: BigInt(g.deadline),
    nonce: BigInt(g.nonce),
  };
}

/** Addresses arrive lowercase from the subgraph and checksummed from viem. */
export const sameAddress = (a?: string | null, b?: string | null): boolean =>
  (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
