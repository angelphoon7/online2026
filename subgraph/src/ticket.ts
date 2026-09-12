import { Address, BigInt, log } from "@graphprotocol/graph-ts";
import {
  TicketMinted,
  Transfer,
  TicketRedeemedEvt,
} from "../generated/TicketNFT/TicketNFT";
import { Ticket } from "../generated/schema";
import { ESCROW } from "./config";

const ZERO = Address.zero();

/**
 * Load a ticket, or create a placeholder if a Transfer arrives before its mint is indexed.
 *
 * TicketMinted and the mint Transfer are emitted in the same transaction, and handler order
 * within a block follows log order, so the mint handler normally runs first. The placeholder
 * exists so a missing metadata event can never halt indexing — a Ticket with zeroed metadata
 * is visible and wrong in an obvious way, which is better than a stalled subgraph.
 */
function loadOrPlaceholder(tokenId: BigInt, block: BigInt): Ticket {
  let ticket = Ticket.load(tokenId.toString());
  if (ticket != null) return ticket;

  log.warning("ticket {} seen before TicketMinted; metadata left at zero", [
    tokenId.toString(),
  ]);
  ticket = new Ticket(tokenId.toString());
  ticket.tokenId = tokenId;
  ticket.eventId = 0;
  ticket.sessionId = 0;
  ticket.sectionId = 0;
  ticket.row = 0;
  ticket.seat = 0;
  ticket.owner = ZERO;
  ticket.escrowed = false;
  ticket.redeemed = false;
  ticket.mintedAtBlock = block;
  ticket.updatedAtBlock = block;
  return ticket;
}

export function handleTicketMinted(event: TicketMinted): void {
  const ticket = new Ticket(event.params.tokenId.toString());
  ticket.tokenId = event.params.tokenId;

  // eventId is uint32, which codegen maps to BigInt; the rest are uint16 -> i32.
  ticket.eventId = event.params.eventId.toI32();
  ticket.sessionId = event.params.sessionId;
  ticket.sectionId = event.params.sectionId;
  ticket.row = event.params.row;
  ticket.seat = event.params.seat;

  ticket.owner = event.params.to;
  ticket.escrowed = false;
  ticket.redeemed = false;
  ticket.mintedAtBlock = event.block.number;
  ticket.updatedAtBlock = event.block.number;
  ticket.save();
}

export function handleTransfer(event: Transfer): void {
  // The mint Transfer carries no information the mint handler has not already recorded.
  if (event.params.from.equals(ZERO)) return;

  const ticket = loadOrPlaceholder(event.params.tokenId, event.block.number);
  ticket.owner = event.params.to;

  if (event.params.to.equals(ESCROW)) {
    // Escrow.deposit() pulls the NFT in, so the sender is the depositor.
    ticket.escrowed = true;
    ticket.depositor = event.params.from;
  } else if (event.params.from.equals(ESCROW)) {
    // Either a depositor withdrawal or a settlement release — custody ends either way.
    ticket.escrowed = false;
    ticket.depositor = null;
  }

  ticket.updatedAtBlock = event.block.number;
  ticket.save();
}

export function handleTicketRedeemed(event: TicketRedeemedEvt): void {
  const ticket = loadOrPlaceholder(event.params.tokenId, event.block.number);
  ticket.redeemed = true;
  ticket.updatedAtBlock = event.block.number;
  ticket.save();
}
