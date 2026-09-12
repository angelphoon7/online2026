import { Bytes, log } from "@graphprotocol/graph-ts";
import { Settled } from "../generated/Settlement/Settlement";
import { Intent, Settlement } from "../generated/schema";

export function handleSettled(event: Settled): void {
  const id = event.transaction.hash.concatI32(event.logIndex.toI32());

  const settlement = new Settlement(id);
  settlement.proposer = event.params.proposer;
  settlement.txHash = event.transaction.hash;
  settlement.blockNumber = event.block.number;
  settlement.timestamp = event.block.timestamp;
  settlement.participantCount = event.params.participantCount;

  // Settled carries the intent hashes but no per-leg data, so received tickets and net
  // payments are not reconstructable here. Ticket movement still lands via Transfer.
  const hashes = event.params.intentHashes;
  const settled = new Array<Bytes>();
  for (let i = 0; i < hashes.length; i++) {
    settled.push(hashes[i]);

    const intent = Intent.load(hashes[i]);
    if (intent == null) {
      log.warning("settlement {} names unknown intent {}", [
        event.transaction.hash.toHexString(),
        hashes[i].toHexString(),
      ]);
      continue;
    }
    intent.state = "SETTLED";
    intent.closedAtBlock = event.block.number;
    intent.closedTx = event.transaction.hash;
    intent.settlement = id;
    intent.save();
  }

  // Settlement is immutable, so it is written once, after the loop.
  settlement.intents = settled;
  settlement.save();
}
