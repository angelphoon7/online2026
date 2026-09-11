import { log } from "@graphprotocol/graph-ts";
import {
  IntentCommitted,
  IntentRevoked,
} from "../generated/IntentRegistry/IntentRegistry";
import { Intent } from "../generated/schema";

export function handleIntentCommitted(event: IntentCommitted): void {
  // The key is the bare struct hash, not the EIP-712 digest — so this id is exactly what
  // hashIntent() recomputes off-chain to verify the indexer did not alter any field.
  const intent = new Intent(event.params.intentHash);

  intent.owner = event.params.owner;
  intent.eventId = event.params.eventId.toI32(); // uint32 -> BigInt in codegen

  // Signed order, preserved: hashOffered is keccak256(abi.encodePacked(offered)), so any
  // re-ordering here would break the hash check that binds this entity to its commitment.
  intent.offered = event.params.offered;

  const ids = new Array<string>();
  for (let i = 0; i < event.params.offered.length; i++) {
    ids.push(event.params.offered[i].toString());
  }
  intent.offeredTickets = ids;

  intent.sessionMask = event.params.sessionMask;
  intent.sectionMask = event.params.sectionMask;
  intent.exactCount = event.params.exactCount; // uint8 -> i32
  intent.mustShareSession = event.params.mustShareSession;
  intent.mustShareSection = event.params.mustShareSection;
  intent.mustBeAdjacent = event.params.mustBeAdjacent;
  intent.maxNetPay = event.params.maxNetPay; // int256, signed
  intent.deadline = event.params.deadline; // uint64 -> BigInt
  intent.nonce = event.params.nonce;

  intent.state = "LIVE";
  intent.committedAtBlock = event.block.number;
  intent.committedAtTimestamp = event.block.timestamp;
  intent.committedTx = event.transaction.hash;
  intent.save();
}

export function handleIntentRevoked(event: IntentRevoked): void {
  const intent = Intent.load(event.params.intentHash);
  if (intent == null) {
    // Only reachable if the registry's startBlock were set past the commit.
    log.warning("revoke for unknown intent {}", [
      event.params.intentHash.toHexString(),
    ]);
    return;
  }
  intent.state = "REVOKED";
  intent.closedAtBlock = event.block.number;
  intent.closedTx = event.transaction.hash;
  intent.save();
}
