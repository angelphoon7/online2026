import { describe, it, expect } from 'vitest';
import { search, computeMinGrossPayment, combinations } from '../src/search.js';
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
