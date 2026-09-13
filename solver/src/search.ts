import { hashIntent } from './hash.js';
import { validateSettlement } from './validate.js';
import type {
  Intent,
  Leg,
  ChainState,
  SearchConfig,
  Candidate,
  SearchResult,
  ExcludedCandidate,
  Hex,
  TicketMeta,
} from './types.js';

export const DEFAULT_CONFIG: SearchConfig = {
  maxParticipants: 8,
  maxCandidates: 1000,
  timeoutMs: 10_000,
};

export function search(
  intents: Intent[],
  state: ChainState,
  config: SearchConfig = DEFAULT_CONFIG
): SearchResult {
  const candidates: Candidate[] = [];
  const excluded: ExcludedCandidate[] = [];
  // Bound diagnostics for subsets discarded before allocation. Every reason is counted;
  // the first 2,000 subset exclusions and every fully constructed candidate rejection
  // remain inspectable with their intent hashes and failing condition.
  const exclusionCounts = new Map<string, number>();
  let exclusionsTotal = 0;
  let sampledSubsets = 0;
  let subsetsChecked = 0;
  const exclude = (intentHashes: Hex[], reason: string, candidate = false) => {
    exclusionsTotal++;
    exclusionCounts.set(reason, (exclusionCounts.get(reason) ?? 0) + 1);
    if (candidate || sampledSubsets < 2000) {
      excluded.push({ intentHashes, reason });
      if (!candidate) sampledSubsets++;
    }
  };
  const finish = (termination: SearchResult['termination']): SearchResult => ({
    candidates, excluded, termination,
    diagnostics: { subsetsChecked, exclusionsTotal, exclusionsOmitted: exclusionsTotal - excluded.length,
      exclusionsByReason: [...exclusionCounts].map(([reason, count]) => ({ reason, count })) },
  });
  const startTime = Date.now();
  // Hash each commitment once, rather than repeating EIP-712 work for every subset.
  const intentHashes = new Map(intents.map(intent => [intent, hashIntent(intent)]));
  const hashesFor = (subset: Intent[]) => subset.map(intent => intentHashes.get(intent)!);
  const allTickets = [...new Set(intents.flatMap(intent => intent.offered))];
  const eligibleTickets = new Map(intents.map(intent => [intent, new Set(allTickets.filter(id => {
    const meta = state.ticketMeta.get(id);
    return !!meta && meta.eventId === intent.eventId
      && (intent.sessionMask & (1n << BigInt(meta.sessionId))) !== 0n
      && (intent.sectionMask & (1n << BigInt(meta.sectionId))) !== 0n;
  }))]));
  // A request that cannot be satisfied by the entire remaining supply cannot take part
  // in any subset. Remove only these provably impossible requests, then propagate the
  // loss of their offered supply. This preserves buyers, sellers and multi-way chains.
  let searchable = intents;
  for (;;) {
    const remaining = searchable.filter(intent => {
      let reason: string | undefined;
      if (intent.offered.some(id => state.depositor.get(id)?.toLowerCase() !== intent.owner.toLowerCase())) reason = 'V2: Offered ticket is no longer escrowed by its owner';
      else if (intent.offered.some(id => state.ticketMeta.get(id)?.eventId !== intent.eventId)) reason = 'V2: Offered ticket belongs to a different event or has no metadata';
      else if (intent.offered.some(id => state.ticketMeta.get(id)?.status === 1)) reason = 'V3: Offered ticket has been redeemed';
      else if (eligibleTickets.get(intent)!.size < intent.exactCount) reason = 'V5: Not enough acceptable tickets in the remaining searchable pool';
      if (reason) exclude([intentHashes.get(intent)!], reason);
      return !reason;
    });
    if (remaining.length === searchable.length) break;
    searchable = remaining;
    const supply = new Set(searchable.flatMap(intent => intent.offered));
    for (const intent of searchable) for (const id of eligibleTickets.get(intent)!) {
      if (!supply.has(id)) eligibleTickets.get(intent)!.delete(id);
    }
  }
  const maxSize = Math.min(searchable.length, config.maxParticipants);

  // With mustInclude set, enumerate only subsets that contain that intent: hold it fixed and
  // combine the rest. Filtering after enumeration would still walk every subset of the pool,
  // which is what exhausts the time bound before the relevant ones are reached.
  const required = config.mustInclude
    ? searchable.find((i) => intentHashes.get(i)!.toLowerCase() === config.mustInclude!.toLowerCase())
    : undefined;
  if (config.mustInclude && !required) {
    return finish('complete');
  }
  const others = required ? searchable.filter((i) => i !== required) : searchable;
  const subsetsOfSize = (size: number): Iterable<Intent[]> =>
    required ? mapCombinations(others, size - 1, (rest) => [required, ...rest]) : combinations(searchable, size);

  for (let size = 2; size <= maxSize; size++) {
    for (const subset of subsetsOfSize(size)) {
      if (Date.now() - startTime > config.timeoutMs) return finish('timeout');
      if (candidates.length >= config.maxCandidates) return finish('candidate-limit');
      subsetsChecked++;

      if (config.requireOwnershipChange && new Set(subset.map(intent => intent.owner.toLowerCase())).size < 2) {
        exclude(hashesFor(subset), 'Search policy: tickets would remain with the same owner');
        continue;
      }

      const poolSize = subset.reduce((s, i) => s + i.offered.length, 0);
      const neededSize = subset.reduce((s, i) => s + i.exactCount, 0);
      if (poolSize !== neededSize) {
        exclude(hashesFor(subset), 'V4: Offered and received ticket counts differ');
        continue;
      }

      const pool = subset.flatMap((i) => i.offered);
      const hashes = hashesFor(subset);

      // Overlapping commitments cannot contribute the same NFT twice. Reject them before
      // assigning tickets; doing so only removes subsets V4 would reject unconditionally.
      if (new Set(pool).size !== pool.length) {
        exclude(hashes, 'V4: Duplicate offered ticket');
        continue;
      }

      const paymentResult = computeMinGrossPayment(subset);
      if (!paymentResult) {
        exclude(hashes, 'No feasible payment distribution');
        continue;
      }

      const offeredBy = new Map(subset.flatMap(intent => intent.offered.map(id => [id, intent.owner.toLowerCase()] as const)));
      const requiredOwner = required?.owner.toLowerCase();
      const changesOwnership = (assignment: bigint[][]) => assignment.some((ids, index) => ids.some(id => {
        const from = offeredBy.get(id), to = subset[index].owner.toLowerCase();
        return from !== to && (!requiredOwner || from === requiredOwner || to === requiredOwner);
      }));
      const assignments = findAssignments(subset, pool, state, 100, startTime + config.timeoutMs,
        config.requireOwnershipChange ? changesOwnership : undefined, eligibleTickets);
      if (assignments.length === 0) {
        if (Date.now() > startTime + config.timeoutMs) return finish('timeout');
        exclude(hashes, config.requireOwnershipChange ? 'No valid ticket assignment satisfying all predicates and changing ticket ownership for the requested swap' : 'No valid ticket assignment satisfying all predicates');
        continue;
      }

      for (const assignment of assignments) {
        if (Date.now() > startTime + config.timeoutMs) return finish('timeout');
        if (candidates.length >= config.maxCandidates) break;

        const { payments, gross } = paymentResult;
        const legs: Leg[] = subset.map((_, idx) => ({
          intentHash: hashes[idx],
          receives: assignment[idx],
          netPayment: payments[idx],
        }));

        const validationError = validateSettlement(subset, legs, state);
        if (validationError) {
          exclude(hashes, `${validationError.check}: ${validationError.error}`, true);
          continue;
        }

        candidates.push({
          intents: subset,
          legs,
          gross,
          participantCount: subset.length,
          intentHashSet: hashes,
        });
      }
    }
  }

  return finish(Date.now() > startTime + config.timeoutMs ? 'timeout' : candidates.length >= config.maxCandidates ? 'candidate-limit' : 'complete');
}

export function computeMinGrossPayment(
  intents: Intent[]
): { payments: bigint[]; gross: bigint } | null {
  const n = intents.length;
  const payments: bigint[] = new Array(n);

  for (let i = 0; i < n; i++) {
    payments[i] = intents[i].maxNetPay < 0n ? intents[i].maxNetPay : 0n;
  }

  let sum = 0n;
  for (let i = 0; i < n; i++) sum += payments[i];

  if (sum === 0n) {
    const gross = payments.reduce((a, p) => a + (p > 0n ? p : 0n), 0n);
    return { payments, gross };
  }

  if (sum > 0n) return null;

  let remaining = -sum;
  for (let i = 0; i < n && remaining > 0n; i++) {
    if (intents[i].maxNetPay > 0n) {
      const contribution = remaining < intents[i].maxNetPay ? remaining : intents[i].maxNetPay;
      payments[i] = contribution;
      remaining -= contribution;
    }
  }

  if (remaining > 0n) return null;

  const gross = payments.reduce((a, p) => a + (p > 0n ? p : 0n), 0n);
  return { payments, gross };
}

export function findAssignments(
  subset: Intent[],
  pool: bigint[],
  state: ChainState,
  limit: number,
  deadline = Number.POSITIVE_INFINITY,
  accept?: (assignment: bigint[][]) => boolean,
  eligibleTickets?: ReadonlyMap<Intent, ReadonlySet<bigint>>
): bigint[][][] {
  const results: bigint[][][] = [];
  const used = new Set<bigint>();
  const current: bigint[][] = Array.from({ length: subset.length }, () => []);
  const eligible = subset.map(intent => pool.filter(id => {
    if (eligibleTickets) return eligibleTickets.get(intent)?.has(id) ?? false;
    const meta = state.ticketMeta.get(id);
    return !!meta && meta.eventId === intent.eventId
      && (intent.sessionMask & (1n << BigInt(meta.sessionId))) !== 0n
      && (intent.sectionMask & (1n << BigInt(meta.sectionId))) !== 0n;
  }));
  // Check every recipient before exploring any assignment. An impossible last recipient
  // must not cause enumeration of all combinations for earlier, flexible recipients.
  if (subset.some((intent, idx) => eligible[idx].length < intent.exactCount)) return results;
  const choices = (idx: number) => {
    let count = 1;
    for (let k = 1; k <= subset[idx].exactCount; k++) count = count * (eligible[idx].length - k + 1) / k;
    return count;
  };
  const order = subset.map((_, idx) => idx).sort((a, b) => choices(a) - choices(b) || a - b);

  function backtrack(depth: number): void {
    if (results.length >= limit || Date.now() > deadline) return;

    if (depth === subset.length) {
      if (used.size === pool.length && (!accept || accept(current))) {
        results.push(current.map((a) => [...a]));
      }
      return;
    }

    const idx = order[depth];
    const intent = subset[idx];

    if (intent.exactCount === 0) {
      current[idx] = [];
      backtrack(depth + 1);
      return;
    }

    for (const combo of combinations(eligible[idx].filter(id => !used.has(id)), intent.exactCount)) {
      if (results.length >= limit || Date.now() > deadline) return;

      if (intent.mustShareSession) {
        const sessions = new Set(combo.map((id) => state.ticketMeta.get(id)!.sessionId));
        if (sessions.size > 1) continue;
      }

      if (intent.mustShareSection) {
        const sections = new Set(combo.map((id) => state.ticketMeta.get(id)!.sectionId));
        if (sections.size > 1) continue;
      }

      if (intent.mustBeAdjacent) {
        if (!checkAdjacentTickets(combo, state)) continue;
      }

      current[idx] = combo;
      for (const id of combo) used.add(id);
      backtrack(depth + 1);
      for (const id of combo) used.delete(id);
    }
  }

  backtrack(0);
  return results;
}

function checkAdjacentTickets(tickets: bigint[], state: ChainState): boolean {
  if (tickets.length < 2) return true;

  const metas: TicketMeta[] = [];
  for (const id of tickets) {
    const meta = state.ticketMeta.get(id);
    if (!meta) return false;
    metas.push(meta);
  }

  const ref = metas[0];
  for (let i = 1; i < metas.length; i++) {
    if (
      metas[i].sessionId !== ref.sessionId ||
      metas[i].sectionId !== ref.sectionId ||
      metas[i].row !== ref.row
    ) {
      return false;
    }
  }

  const seats = metas.map((m) => m.seat).sort((a, b) => a - b);
  for (let i = 1; i < seats.length; i++) {
    if (seats[i] !== seats[i - 1] + 1) return false;
  }

  return true;
}

function* mapCombinations<T, R>(arr: T[], k: number, wrap: (combo: T[]) => R): Generator<R> {
  for (const combo of combinations(arr, k)) yield wrap(combo);
}

export function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  if (k === 0) {
    yield [];
    return;
  }
  if (k > arr.length) return;
  for (let i = 0; i <= arr.length - k; i++) {
    for (const rest of combinations(arr.slice(i + 1), k - 1)) {
      yield [arr[i], ...rest];
    }
  }
}
