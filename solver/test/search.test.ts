import { describe, it, expect } from 'vitest';
import { search, findAssignments, computeMinGrossPayment, combinations } from '../src/search.js';
import { validateSettlement } from '../src/validate.js';
import { rankCandidates } from '../src/rank.js';
import { hashIntent } from '../src/hash.js';
import type { Intent, ChainState, Address, SearchConfig } from '../src/types.js';
import { INTENT_STATE } from '../src/types.js';

const EVENT_ID = 1;
const alice: Address = '0x000000000000000000000000000000000000a11c';
const bob: Address = '0x000000000000000000000000000000000000b0b0';
const charlie: Address = '0x000000000000000000000000000000000000c0c0';

function buildState(intents: Intent[]): ChainState {
  const state: ChainState = {
    ticketMeta: new Map(),
    depositor: new Map(),
    intentState: new Map(),
    usdcBalance: new Map(),
    usdcAllowance: new Map(),
    blockTimestamp: 1000n,
  };
  for (const intent of intents) {
    const h = hashIntent(intent);
    state.intentState.set(h, INTENT_STATE.LIVE);
    state.usdcBalance.set(intent.owner, 1_000_000_000n);
    state.usdcAllowance.set(intent.owner, 1_000_000_000n);
    for (const tokenId of intent.offered) {
      state.depositor.set(tokenId, intent.owner);
    }
  }
  return state;
}

function addTicket(
  state: ChainState,
  tokenId: bigint,
  opts: {
    eventId?: number;
    sessionId?: number;
    sectionId?: number;
    row?: number;
    seat?: number;
  } = {}
): void {
  state.ticketMeta.set(tokenId, {
    eventId: opts.eventId ?? EVENT_ID,
    sessionId: opts.sessionId ?? 0,
    sectionId: opts.sectionId ?? 0,
    row: opts.row ?? 1,
    seat: opts.seat ?? 1,
    status: 0,
  });
}

const config: SearchConfig = {
  maxParticipants: 8,
  maxCandidates: 100,
  timeoutMs: 5000,
};

describe('combinations', () => {
  it('generates correct combinations', () => {
    const result = [...combinations([1, 2, 3], 2)];
    expect(result).toEqual([[1, 2], [1, 3], [2, 3]]);
  });

  it('returns empty for k > n', () => {
    const result = [...combinations([1], 2)];
    expect(result).toEqual([]);
  });

  it('returns single element for k = 0', () => {
    const result = [...combinations([1, 2], 0)];
    expect(result).toEqual([[]]);
  });
});

describe('computeMinGrossPayment', () => {
  it('pure swap — all maxNetPay >= 0 — gross is 0', () => {
    const intents: Intent[] = [
      makeIntent(alice, [1n], 1, 0n, 1n),
      makeIntent(bob, [2n], 1, 0n, 2n),
    ];
    const result = computeMinGrossPayment(intents);
    expect(result).not.toBeNull();
    expect(result!.gross).toBe(0n);
    expect(result!.payments).toEqual([0n, 0n]);
  });

  it('one seller one buyer — gross matches credit floor', () => {
    const intents: Intent[] = [
      makeIntent(alice, [1n], 1, 50_000_000n, 1n),
      makeIntent(bob, [2n], 1, -20_000_000n, 2n),
    ];
    const result = computeMinGrossPayment(intents);
    expect(result).not.toBeNull();
    expect(result!.gross).toBe(20_000_000n);
    expect(result!.payments[0]).toBe(20_000_000n);
    expect(result!.payments[1]).toBe(-20_000_000n);
  });

  it('returns null when debit capacity insufficient', () => {
    const intents: Intent[] = [
      makeIntent(alice, [1n], 1, 10_000_000n, 1n),
      makeIntent(bob, [2n], 1, -30_000_000n, 2n),
    ];
    const result = computeMinGrossPayment(intents);
    expect(result).toBeNull();
  });

  it('distributes debits across multiple payers', () => {
    const intents: Intent[] = [
      makeIntent(alice, [1n], 1, 20_000_000n, 1n),
      makeIntent(bob, [2n], 1, 15_000_000n, 2n),
      makeIntent(charlie, [3n], 1, -30_000_000n, 3n),
    ];
    const result = computeMinGrossPayment(intents);
    expect(result).not.toBeNull();
    expect(result!.gross).toBe(30_000_000n);
    const totalPositive = result!.payments.filter((p) => p > 0n).reduce((a, b) => a + b, 0n);
    expect(totalPositive).toBe(30_000_000n);
  });
});

describe('search', () => {
  it('reports candidate and time limits separately from a completed bounded search', () => {
    const intents = [makeIntent(alice, [1n], 1, 0n, 1n), makeIntent(bob, [2n], 1, 0n, 2n)];
    const state = buildState(intents);
    addTicket(state, 1n); addTicket(state, 2n);
    expect(search(intents, state, { ...config, maxCandidates: 0 }).termination).toBe('candidate-limit');
    expect(search(intents, state, { ...config, timeoutMs: -1 }).termination).toBe('timeout');
    expect(search(intents, state, config).termination).toBe('complete');
  });
  it('finds a valid two-way swap', () => {
    const intentA = makeIntent(alice, [1n], 1, 0n, 1n);
    const intentB = makeIntent(bob, [2n], 1, 0n, 2n);
    const state = buildState([intentA, intentB]);
    addTicket(state, 1n, { sessionId: 0, sectionId: 0 });
    addTicket(state, 2n, { sessionId: 0, sectionId: 0 });

    const result = search([intentA, intentB], state, config);
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    expect(result.candidates[0].gross).toBe(0n);
  });

  it('finds three-way reshuffle', () => {
    const intentA = makeIntent(alice, [1n], 1, 0n, 1n);
    const intentB = makeIntent(bob, [2n], 1, 0n, 2n);
    const intentC = makeIntent(charlie, [3n], 1, 0n, 3n);
    const state = buildState([intentA, intentB, intentC]);
    addTicket(state, 1n, { sessionId: 0, sectionId: 0 });
    addTicket(state, 2n, { sessionId: 0, sectionId: 0 });
    addTicket(state, 3n, { sessionId: 0, sectionId: 0 });

    const result = search([intentA, intentB, intentC], state, config);
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
  });

  it('buyer-seller chain — pure seller with exactCount 0', () => {
    const seller = makePureSeller(alice, [1n, 2n], -40_000_000n, 1n);
    const buyer = makePureBuyer(bob, 2, 50_000_000n, 2n);
    const state = buildState([seller, buyer]);
    addTicket(state, 1n, { sessionId: 0, sectionId: 0, seat: 1 });
    addTicket(state, 2n, { sessionId: 0, sectionId: 0, seat: 2 });

    const result = search([seller, buyer], state, config);
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    const bestLegs = result.candidates[0].legs;
    const sellerLeg = bestLegs.find((l) => l.receives.length === 0);
    expect(sellerLeg).toBeDefined();
  });

  it('respects adjacency constraint', () => {
    const intentA: Intent = {
      owner: alice,
      offered: [1n],
      eventId: EVENT_ID,
      sessionMask: 1n,
      sectionMask: 1n,
      exactCount: 2,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: true,
      maxNetPay: 50_000_000n,
      deadline: 2000n,
      nonce: 1n,
    };
    const seller: Intent = {
      owner: bob,
      offered: [10n, 11n],
      eventId: EVENT_ID,
      sessionMask: 1n,
      sectionMask: 1n,
      exactCount: 1,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: -20_000_000n,
      deadline: 2000n,
      nonce: 2n,
    };

    const state = buildState([intentA, seller]);
    addTicket(state, 1n, { sessionId: 0, sectionId: 0, row: 1, seat: 5 });
    addTicket(state, 10n, { sessionId: 0, sectionId: 0, row: 1, seat: 1 });
    addTicket(state, 11n, { sessionId: 0, sectionId: 0, row: 1, seat: 3 });

    const result = search([intentA, seller], state, config);
    expect(result.candidates.length).toBe(0);
  });

  it('adjacency succeeds with consecutive seats', () => {
    const intentA: Intent = {
      owner: alice,
      offered: [1n],
      eventId: EVENT_ID,
      sessionMask: 1n,
      sectionMask: 1n,
      exactCount: 2,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: true,
      maxNetPay: 50_000_000n,
      deadline: 2000n,
      nonce: 1n,
    };
    const seller: Intent = {
      owner: bob,
      offered: [10n, 11n],
      eventId: EVENT_ID,
      sessionMask: 1n,
      sectionMask: 1n,
      exactCount: 1,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: -20_000_000n,
      deadline: 2000n,
      nonce: 2n,
    };

    const state = buildState([intentA, seller]);
    addTicket(state, 1n, { sessionId: 0, sectionId: 0, row: 1, seat: 5 });
    addTicket(state, 10n, { sessionId: 0, sectionId: 0, row: 1, seat: 1 });
    addTicket(state, 11n, { sessionId: 0, sectionId: 0, row: 1, seat: 2 });

    const result = search([intentA, seller], state, config);
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
  });
});

describe('personal swaps and ownership changes', () => {
  const swapConfig = { ...config, maxParticipants: 4, requireOwnershipChange: true };

  it('excludes two requests that only return tickets to their one owner', () => {
    const intents = [makeIntent(alice, [1n], 1, 0n, 1n), makeIntent(alice, [2n], 1, 0n, 2n)];
    const state = buildState(intents); addTicket(state, 1n); addTicket(state, 2n);
    expect(search(intents, state, config).candidates.length).toBeGreaterThan(0);
    const result = search(intents, state, swapConfig);
    expect(result.candidates).toEqual([]);
    expect(result.excluded[0].reason).toContain('same owner');
  });

  it('does not spend the candidate cap on unchanged bundles from different wallets', () => {
    const intents = [makeIntent(alice, [1n], 1, 0n, 1n), makeIntent(bob, [2n], 1, 0n, 2n)];
    const state = buildState(intents); addTicket(state, 1n); addTicket(state, 2n);
    const result = search(intents, state, { ...swapConfig, maxCandidates: 1 });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].legs.map(leg => leg.receives)).toEqual([[2n], [1n]]);
  });

  it('keeps the requested intent in every candidate even when other pairs fill a global search', () => {
    const intents = Array.from({ length: 20 }, (_, n) => makeIntent(n % 2 ? alice : bob, [BigInt(n + 1)], 1, 0n, BigInt(n)));
    const requested = { ...makeIntent(charlie, [34n, 35n], 2, 0n, 21n), sessionMask: 2n };
    const partner = makeIntent(bob, [60n, 61n], 2, 0n, 22n);
    const pool = [...intents, partner, requested], state = buildState(pool);
    for (const id of pool.flatMap(intent => intent.offered)) addTicket(state, id);
    addTicket(state, 60n, { sessionId: 1 }); addTicket(state, 61n, { sessionId: 1 });
    const result = search(pool, state, { ...swapConfig, maxParticipants: 2, maxCandidates: 1, mustInclude: hashIntent(requested) });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].intentHashSet).toContain(hashIntent(requested));
    expect(result.candidates[0].legs[0].receives).toEqual([60n, 61n]);
  });

  it('cannot attach an unchanged requester to a swap between other wallets', () => {
    const requested = { ...makeIntent(alice, [1n], 1, 0n, 1n), sessionMask: 2n };
    const pool = [requested, ...[bob, charlie].map((owner, n) => ({ ...makeIntent(owner, [BigInt(n + 2)], 1, 0n, BigInt(n + 2)), sessionMask: 1n }))];
    const state = buildState(pool); addTicket(state, 1n, { sessionId: 1 }); addTicket(state, 2n); addTicket(state, 3n);
    expect(search(pool, state, swapConfig).candidates.length).toBeGreaterThan(0);
    expect(search(pool, state, { ...swapConfig, mustInclude: hashIntent(requested) }).candidates).toEqual([]);
  });

  it('returns no unrelated candidate if the required hash is absent', () => {
    const pool = [makeIntent(alice, [1n], 1, 0n, 1n), makeIntent(bob, [2n], 1, 0n, 2n)];
    const state = buildState(pool); addTicket(state, 1n); addTicket(state, 2n);
    expect(search(pool, state, { ...swapConfig, mustInclude: hashIntent({ ...pool[0], nonce: 99n }) }).candidates).toEqual([]);
  });

  it('still allows several requests from one wallet when ownership changes with another wallet', () => {
    const pool = [makeIntent(alice, [1n], 1, 0n, 1n), makeIntent(alice, [2n], 1, 0n, 2n), makeIntent(bob, [3n], 1, 0n, 3n)];
    const state = buildState(pool); for (const id of [1n, 2n, 3n]) addTicket(state, id);
    const result = search(pool, state, { ...swapConfig, mustInclude: hashIntent(pool[0]) });
    expect(result.candidates.some(candidate => candidate.intents.length === 3)).toBe(true);
  });

  it('keeps pure buyer and seller requests eligible', () => {
    const pool = [makePureSeller(alice, [1n], -20n, 1n), makePureBuyer(bob, 1, 20n, 2n)];
    const state = buildState(pool); addTicket(state, 1n);
    for (const requested of pool) expect(search(pool, state, { ...swapConfig, mustInclude: hashIntent(requested) }).candidates).toHaveLength(1);
  });
});

describe('large pool pruning', () => {
  it('reaches a four-way swap after 128 incompatible requests without dropping its participants', () => {
    const ring = [alice, bob, charlie, '0x000000000000000000000000000000000000d00d' as Address].map((owner, n) => ({
      ...makeIntent(owner, [BigInt(n + 1)], 1, 0n, 1n), sectionMask: 1n << BigInt((n + 1) % 4),
    }));
    const noise = Array.from({ length: 128 }, (_, n) => ({ ...makeIntent(bob, [BigInt(n + 10)], 1, 0n, BigInt(n + 10)), sectionMask: 1n << 31n }));
    const pool = [ring[0], ...noise, ...ring.slice(1)], state = buildState(pool);
    ring.forEach((intent, n) => addTicket(state, intent.offered[0], { sectionId: n }));
    noise.forEach(intent => addTicket(state, intent.offered[0], { sectionId: 7 }));
    const result = search(pool, state, { ...config, maxParticipants: 4, timeoutMs: 8000, mustInclude: hashIntent(ring[0]), requireOwnershipChange: true });
    expect(result.termination).toBe('complete');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].intentHashSet.sort()).toEqual(ring.map(hashIntent).sort());
    expect(validateSettlement(result.candidates[0].intents, result.candidates[0].legs, state)).toBeNull();
    expect(result.excluded.filter(entry => entry.reason.startsWith('V5:'))).toHaveLength(noise.length);
  });

  it('propagates unavailable supply while preserving an ordinary buyer-seller swap', () => {
    const buyer = { ...makePureBuyer(alice, 1, 20n, 1n), sectionMask: 2n };
    const blocked = { ...makeIntent(bob, [1n], 1, -20n, 2n), sectionMask: 4n };
    const state = buildState([buyer, blocked]); addTicket(state, 1n, { sectionId: 1 });
    const result = search([buyer, blocked], state, { ...config, mustInclude: hashIntent(buyer) });
    expect(result.termination).toBe('complete');
    expect(result.candidates).toEqual([]);
    expect(result.excluded.map(entry => entry.intentHashes[0])).toEqual([hashIntent(blocked), hashIntent(buyer)]);
    const seller = { ...blocked, exactCount: 0 };
    const validState = buildState([buyer, seller]); addTicket(validState, 1n, { sectionId: 1 });
    expect(search([buyer, seller], validState, config).candidates).toHaveLength(1);
  });

  it('keeps output legs in recipient order when the scarce recipient is assigned first', () => {
    const flexible = { ...makeIntent(alice, [1n, 2n, 3n], 3, 0n, 1n), mustBeAdjacent: true };
    const narrow = { ...makeIntent(bob, [4n], 1, 0n, 2n), sectionMask: 2n };
    const state = buildState([flexible, narrow]);
    for (const id of [1n, 2n, 3n]) addTicket(state, id, { seat: Number(id) });
    addTicket(state, 4n, { sectionId: 1 });
    expect(findAssignments([flexible, narrow], [1n, 2n, 3n, 4n], state, 100)).toEqual([[[1n, 2n, 3n], [4n]]]);
  });

  it('rejects overlapping commitments before attempting to allocate the same NFT twice', () => {
    const pool = [makeIntent(alice, [1n], 1, 0n, 1n), makeIntent(alice, [1n], 1, 0n, 2n)];
    const state = buildState(pool); addTicket(state, 1n);
    const result = search(pool, state, config);
    expect(result.candidates).toEqual([]);
    expect(result.excluded).toEqual([{ intentHashes: pool.map(hashIntent), reason: 'V4: Duplicate offered ticket' }]);
  });

  it('bounds detailed exclusion storage while reporting every omitted reason and count', () => {
    const pool = Array.from({ length: 70 }, (_, n) => makeIntent(alice, [BigInt(n + 1)], 1, 0n, BigInt(n)));
    const state = buildState(pool); pool.forEach(intent => addTicket(state, intent.offered[0]));
    const result = search(pool, state, { ...config, maxParticipants: 2, requireOwnershipChange: true });
    expect(result.termination).toBe('complete');
    expect(result.candidates).toEqual([]);
    expect(result.excluded).toHaveLength(2000);
    expect(result.diagnostics.exclusionsTotal).toBe(2415);
    expect(result.diagnostics.exclusionsOmitted).toBe(415);
    expect(result.diagnostics.exclusionsByReason).toEqual([{ reason: 'Search policy: tickets would remain with the same owner', count: 2415 }]);
  });

  it('retains a constructed candidate rejection after the subset diagnostic sample fills', () => {
    const noise = Array.from({ length: 70 }, (_, n) => makeIntent(alice, [BigInt(n + 1)], 1, 0n, BigInt(n)));
    const buyer = makePureBuyer(bob, 1, 20n, 1n), seller = makePureSeller(charlie, [71n], -20n, 1n);
    const pool = [...noise, buyer, seller], state = buildState(pool);
    for (const intent of pool) for (const id of intent.offered) addTicket(state, id);
    state.usdcBalance.set(bob, 0n);
    const result = search(pool, state, { ...config, maxParticipants: 2, requireOwnershipChange: true });
    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.exclusionsOmitted).toBeGreaterThan(0);
    expect(result.excluded).toHaveLength(2001);
    expect(result.excluded.at(-1)).toEqual({ intentHashes: [hashIntent(buyer), hashIntent(seller)], reason: 'V8: InsufficientPaymentCapacity' });
  });
});

describe('rankCandidates', () => {
  it('ranks by gross cash moved first', () => {
    const candidates = [
      makeCandidateStub(30n, 2, ['0xaaa']),
      makeCandidateStub(10n, 3, ['0xbbb']),
      makeCandidateStub(20n, 2, ['0xccc']),
    ];
    const ranked = rankCandidates(candidates);
    expect(ranked[0].gross).toBe(10n);
    expect(ranked[1].gross).toBe(20n);
    expect(ranked[2].gross).toBe(30n);
  });

  it('breaks ties by participant count', () => {
    const candidates = [
      makeCandidateStub(10n, 3, ['0xaaa']),
      makeCandidateStub(10n, 2, ['0xbbb']),
    ];
    const ranked = rankCandidates(candidates);
    expect(ranked[0].participantCount).toBe(2);
  });

  it('breaks ties by lexicographic intent hashes', () => {
    const candidates = [
      makeCandidateStub(10n, 2, ['0xbbb']),
      makeCandidateStub(10n, 2, ['0xaaa']),
    ];
    const ranked = rankCandidates(candidates);
    expect(ranked[0].intentHashSet).toEqual(['0xaaa']);
  });
});

// ── helpers ──

function makeIntent(
  owner: Address,
  offered: bigint[],
  exactCount: number,
  maxNetPay: bigint,
  nonce: bigint
): Intent {
  return {
    owner,
    offered,
    eventId: EVENT_ID,
    sessionMask: 0xffn,
    sectionMask: 0xffn,
    exactCount,
    mustShareSession: false,
    mustShareSection: false,
    mustBeAdjacent: false,
    maxNetPay,
    deadline: 2000n,
    nonce,
  };
}

function makePureSeller(
  owner: Address,
  offered: bigint[],
  maxNetPay: bigint,
  nonce: bigint
): Intent {
  return {
    owner,
    offered,
    eventId: EVENT_ID,
    sessionMask: 0xffn,
    sectionMask: 0xffn,
    exactCount: 0,
    mustShareSession: false,
    mustShareSection: false,
    mustBeAdjacent: false,
    maxNetPay,
    deadline: 2000n,
    nonce,
  };
}

function makePureBuyer(
  owner: Address,
  exactCount: number,
  maxNetPay: bigint,
  nonce: bigint
): Intent {
  return {
    owner,
    offered: [],
    eventId: EVENT_ID,
    sessionMask: 0xffn,
    sectionMask: 0xffn,
    exactCount,
    mustShareSession: false,
    mustShareSection: false,
    mustBeAdjacent: false,
    maxNetPay,
    deadline: 2000n,
    nonce,
  };
}

function makeCandidateStub(
  gross: bigint,
  participantCount: number,
  intentHashSet: string[]
) {
  return {
    intents: [],
    legs: [],
    gross,
    participantCount,
    intentHashSet: intentHashSet as `0x${string}`[],
  };
}
