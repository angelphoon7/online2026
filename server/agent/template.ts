import 'server-only';
import type { ExclusionReason } from '@/shared/graph';
import type { Evidence, Relaxation } from './diagnose';
import { smallestWorkingChange } from './diagnose';

// Deterministic narration - step 7-H of docs/RESHUFFLE_GRAPH_PLAN.md.
//
// Two jobs. It is the fallback when the guard rejects a model answer, and it is the answer
// when there is no Anthropic key at all - so /agent/diagnose remains useful to a judge who
// has only this repository. Nothing here is generated: every sentence is assembled from the
// evidence object, so the wording cannot drift from what was measured.
//
// The vocabulary constraints are the same ones the model is held to, for the same reason: no
// settlement found means none found within the published bound, never that none exists.

const USDC = 1_000_000n;

/** Contract units to a readable signed USDC amount. */
export function formatUsdc(units: string | bigint): string {
  const value = typeof units === 'bigint' ? units : BigInt(units);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / USDC;
  const fraction = absolute % USDC;
  const decimals = fraction === 0n ? '' : `.${fraction.toString().padStart(6, '0').replace(/0+$/, '')}`;
  return `${negative ? '-' : ''}${whole}${decimals} USDC`;
}

// One clause per reason. The snapshot's `detail` is already a readable phrase naming the
// offending ticket or deadline ("ticket 2 is not in escrow"), so it is appended whole rather
// than interpolated as an id - treating it as a bare number produced sentences like
// "ticket #ticket 2 is not in escrow is no longer escrowed by its owner".
const EXCLUSION_CLAUSE: Record<ExclusionReason, string> = {
  HASH_MISMATCH: 'the indexed fields do not hash to the id it was committed under, so it is not treated as signed',
  EXPIRED: 'its deadline had passed at this block',
  TICKET_UNKNOWN: 'one of its offered tickets has no indexed record',
  TICKET_NOT_IN_ESCROW: 'an offered ticket is not escrowed by its owner',
  TICKET_REDEEMED: 'an offered ticket has been redeemed',
  WRONG_EVENT: 'an offered ticket belongs to a different event',
};

const exclusionSentence = (reason: ExclusionReason, detail?: string) =>
  `${EXCLUSION_CLAUSE[reason]}${detail ? ` (${detail})` : ''}`;

const STAGE_SENTENCE: Record<string, string> = {
  offeredByOthers: 'no other participant is offering any ticket',
  eventId: 'no offered ticket belongs to this event',
  session: 'no offered ticket is in a session this intent accepts',
  section: 'no offered ticket is in a section this intent accepts',
  cohesiveGroup: 'the matching tickets cannot be grouped the way this intent requires',
};

/** "raise the limit to 100 USDC" - the change, phrased as an action the participant could take. */
export function describeChange(relaxation: Relaxation): string {
  const change = relaxation.change;
  if (change === 'maxNetPay->cap') return 'raise the signed payment limit';
  if (change === 'mustBeAdjacent=false') return 'drop the adjacent-seats requirement';
  if (change === 'mustShareSection=false') return 'allow the seats to be in different sections';
  if (change === 'mustShareSession=false') return 'allow the seats to be in different sessions';
  const section = change.match(/^addSection=(\d+)$/);
  if (section) return `also accept section ${section[1]}`;
  const session = change.match(/^addSession=(\d+)$/);
  if (session) return `also accept session ${session[1]}`;
  return change;
}

export function renderEvidence(evidence: Evidence): string {
  const at = `At Arc Testnet block #${evidence.block},`;

  if (evidence.status === 'EXCLUDED' && evidence.exclusion) {
    const reason = exclusionSentence(evidence.exclusion.reason, evidence.exclusion.detail);
    return `${at} this intent is not being matched: ${reason}. Settlement would reject it on the same check, so fix that first.`;
  }

  if (evidence.status === 'CLOSED' && evidence.closed) {
    const verb = evidence.closed.state === 'REVOKED' ? 'revoked' : 'settled';
    const where = evidence.closed.tx ? ` in transaction ${evidence.closed.tx}` : '';
    return `${at} this intent is no longer live: it was ${verb}${where}. Commit a new intent to rejoin the pool.`;
  }

  if (evidence.status === 'UNKNOWN') {
    return evidence.lookupFailed
      ? `${at} this intent is not in the live pool, and the indexer could not be reached to check whether it was revoked or settled. Retry shortly.`
      : `${at} no intent with this hash is live in the pool or recorded by the indexer. Check the hash, or commit the intent first.`;
  }

  if (evidence.status === 'SETTLEABLE' && evidence.settleable) {
    const { participantCount, targetNetPay, counterparties } = evidence.settleable;
    const money =
      BigInt(targetNetPay) === 0n
        ? 'with no payment either way'
        : BigInt(targetNetPay) > 0n
          ? `paying ${formatUsdc(targetNetPay)}`
          : `receiving ${formatUsdc(-BigInt(targetNetPay))}`;
    return `${at} a reshuffle including this intent was found, with ${participantCount} participants (${counterparties.length} counterpart${counterparties.length === 1 ? 'y' : 'ies'}), ${money}. Use Propose and settle to submit it; the contract re-checks every signed condition before it executes.`;
  }

  // NOT_FOUND_WITHIN_BOUND
  const lines = [`${at} no settlement was found within the search bound.`];

  if (evidence.demand && evidence.demand.unwanted.length && evidence.demand.unwanted.length === evidence.demand.perTicket.length) {
    lines.push(
      `No live intent currently accepts the ticket${evidence.demand.perTicket.length === 1 ? '' : 's'} this intent offers (${evidence.demand.unwanted.map((t) => `#${t}`).join(', ')}), so changing this intent's own conditions would not help.`
    );
  } else if (evidence.supply?.firstZero) {
    lines.push(`On the supply side, ${STAGE_SENTENCE[evidence.supply.firstZero]}.`);
  } else if (evidence.supply?.blockedAt === 'cohesiveGroup') {
    lines.push(
      `The largest group of acceptable tickets that meets this intent's grouping conditions is ${evidence.supply.largestGroup}, and it asks for exactly ${evidence.supply.need}.`
    );
  }

  const best = smallestWorkingChange(evidence);
  if (best) {
    const money =
      best.targetNetPay !== null && BigInt(best.targetNetPay) !== 0n
        ? BigInt(best.targetNetPay) > 0n
          ? `, paying ${formatUsdc(best.targetNetPay)}`
          : `, receiving ${formatUsdc(-BigInt(best.targetNetPay))}`
        : '';
    lines.push(
      `The smallest change among those tried: ${describeChange(best)} — that produced a ${best.participantCount}-participant reshuffle${money}. Signing a new intent is what would make it real; nothing moves until then.`
    );
  } else if (evidence.relaxations.length) {
    lines.push('None of the single changes tried produced a settlement. Combinations of changes were not tried.');
  }

  return lines.join(' ');
}
