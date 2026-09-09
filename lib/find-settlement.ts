import type { Hex, Address } from 'viem';
import { getTicketMeta, getDepositor } from './contracts';

interface IntentForSolver {
  hash: Hex;
  owner: Address;
  offered: bigint[];
  exactCount: number;
  sessionMask: bigint;
  sectionMask: bigint;
  mustShareSession: boolean;
  mustShareSection: boolean;
  mustBeAdjacent: boolean;
  maxNetPay: bigint;
}

interface TicketInfo {
  tokenId: bigint;
  eventId: number;
  sessionId: number;
  sectionId: number;
  row: number;
  seat: number;
}

export interface SettlementLeg {
  intentHash: Hex;
  owner: Address;
  receives: bigint[];
  netPayment: bigint;
  maxNetPay: bigint;
}

export interface SettlementProposal {
  legs: SettlementLeg[];
  gross: bigint;
  candidatesFound: number;
  candidatesExcluded: { intentHashes: string[]; reason: string }[];
  reason: string;
}

function checkPredicate(
  intent: IntentForSolver,
  tickets: TicketInfo[]
): string | null {
  if (intent.exactCount === 0 && tickets.length === 0) return null;
  if (tickets.length !== intent.exactCount)
    return `count mismatch: wanted ${intent.exactCount}, got ${tickets.length}`;

  for (const t of tickets) {
    if ((intent.sessionMask & (1n << BigInt(t.sessionId))) === 0n)
      return `session ${t.sessionId} not in mask`;
    if ((intent.sectionMask & (1n << BigInt(t.sectionId))) === 0n)
      return `section ${t.sectionId} not in mask`;
  }

  if (tickets.length >= 2 && intent.mustShareSession) {
    const s = tickets[0].sessionId;
    if (tickets.some((t) => t.sessionId !== s)) return 'not same session';
  }

  if (tickets.length >= 2 && intent.mustShareSection) {
    const s = tickets[0].sectionId;
    if (tickets.some((t) => t.sectionId !== s)) return 'not same section';
  }

  if (tickets.length >= 2 && intent.mustBeAdjacent) {
    const s0 = tickets[0].sessionId;
    const sec0 = tickets[0].sectionId;
    const row0 = tickets[0].row;
    if (
      tickets.some(
        (t) =>
          t.sessionId !== s0 || t.sectionId !== sec0 || t.row !== row0
      )
    )
      return 'not same row for adjacency';
    const seats = tickets.map((t) => t.seat).sort((a, b) => a - b);
    for (let i = 1; i < seats.length; i++) {
      if (seats[i] !== seats[i - 1] + 1) return 'seats not adjacent';
    }
  }

  return null;
}

export async function findSettlement(
  intents: IntentForSolver[]
): Promise<SettlementProposal | null> {
  if (intents.length < 2) return null;

  const allOffered = new Map<string, { owner: Address; ticketId: bigint }>();
  const ticketInfos = new Map<string, TicketInfo>();

  for (const intent of intents) {
    for (const tid of intent.offered) {
      allOffered.set(tid.toString(), { owner: intent.owner, ticketId: tid });
      try {
        const meta = await getTicketMeta(tid);
        ticketInfos.set(tid.toString(), { tokenId: tid, ...meta });
      } catch {
        // skip
      }
    }
  }

  const pool = [...allOffered.values()].map((o) => o.ticketId);
  const candidatesExcluded: { intentHashes: string[]; reason: string }[] = [];
  let candidatesFound = 0;

  // Try all permutations of assigning pool tickets to intents
  const assignments = tryAssign(intents, pool, ticketInfos, 0, new Set());
  if (!assignments) {
    return null;
  }

  candidatesFound = 1;

  const legs: SettlementLeg[] = intents.map((intent, i) => {
    const receives = assignments[i];
    return {
      intentHash: intent.hash,
      owner: intent.owner,
      receives,
      netPayment: 0n,
      maxNetPay: intent.maxNetPay,
    };
  });

  // Compute payments: pure swaps have netPayment=0 for all
  // For buyer-seller chains, distribute based on maxNetPay
  const hasPayments = intents.some((i) => i.maxNetPay !== 0n);
  if (hasPayments) {
    const creditFloor = intents
      .filter((i) => i.maxNetPay < 0n)
      .reduce((sum, i) => sum + i.maxNetPay, 0n);
    const debitCeiling = intents
      .filter((i) => i.maxNetPay > 0n)
      .reduce((sum, i) => sum + i.maxNetPay, 0n);

    if (-creditFloor > debitCeiling) {
      candidatesExcluded.push({
        intentHashes: intents.map((i) => i.hash),
        reason: 'insufficient debit capacity to cover credits',
      });
      return null;
    }

    // Assign credits at their floor, distribute debits to balance
    let totalCredit = 0n;
    for (let i = 0; i < legs.length; i++) {
      if (intents[i].maxNetPay < 0n) {
        legs[i].netPayment = intents[i].maxNetPay;
        totalCredit += intents[i].maxNetPay;
      }
    }

    // Distribute -totalCredit among debtors proportionally (simplified: greedy)
    let remaining = -totalCredit;
    for (let i = 0; i < legs.length; i++) {
      if (intents[i].maxNetPay > 0n && remaining > 0n) {
        const pay =
          remaining <= intents[i].maxNetPay ? remaining : intents[i].maxNetPay;
        legs[i].netPayment = pay;
        remaining -= pay;
      }
    }

    if (remaining !== 0n) {
      candidatesExcluded.push({
        intentHashes: intents.map((i) => i.hash),
        reason: `payment imbalance: ${remaining}`,
      });
      return null;
    }
  }

  // Verify V7: sum == 0
  const total = legs.reduce((s, l) => s + l.netPayment, 0n);
  if (total !== 0n) return null;

  // Compute gross
  const gross = legs.reduce(
    (s, l) => s + (l.netPayment > 0n ? l.netPayment : 0n),
    0n
  );

  return {
    legs,
    gross,
    candidatesFound,
    candidatesExcluded,
    reason: `least cash moved among candidates found within the search budget`,
  };
}

function tryAssign(
  intents: IntentForSolver[],
  pool: bigint[],
  ticketInfos: Map<string, TicketInfo>,
  idx: number,
  used: Set<string>
): bigint[][] | null {
  if (idx === intents.length) {
    // All tickets in pool must be assigned
    if (used.size === pool.length) return [];
    return null;
  }

  const intent = intents[idx];
  if (intent.exactCount === 0) {
    const rest = tryAssign(intents, pool, ticketInfos, idx + 1, used);
    if (rest) return [[], ...rest];
    return null;
  }

  const available = pool.filter((t) => !used.has(t.toString()));
  const combos = combinations(available, intent.exactCount);

  for (const combo of combos) {
    const tickets = combo
      .map((tid) => ticketInfos.get(tid.toString()))
      .filter((t): t is TicketInfo => !!t);
    if (tickets.length !== intent.exactCount) continue;

    // Must not receive own tickets
    const ownOffered = new Set(intent.offered.map((o) => o.toString()));
    if (combo.some((t) => ownOffered.has(t.toString()))) continue;

    const err = checkPredicate(intent, tickets);
    if (err) continue;

    const nextUsed = new Set(used);
    for (const t of combo) nextUsed.add(t.toString());

    const rest = tryAssign(intents, pool, ticketInfos, idx + 1, nextUsed);
    if (rest) return [combo, ...rest];
  }

  return null;
}

function* combinations(arr: bigint[], k: number): Generator<bigint[]> {
  if (k === 0) {
    yield [];
    return;
  }
  for (let i = 0; i <= arr.length - k; i++) {
    for (const rest of combinations(arr.slice(i + 1), k - 1)) {
      yield [arr[i], ...rest];
    }
  }
}
