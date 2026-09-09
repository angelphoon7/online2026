import { describe, it, expect } from 'vitest';
import { validateSettlement } from '../src/validate.js';
import { hashIntent } from '../src/hash.js';
import type { Intent, Leg, ChainState, Address } from '../src/types.js';
import { INTENT_STATE } from '../src/types.js';

const EVENT_ID = 1;
const alice: Address = '0x000000000000000000000000000000000000a11c';
const bob: Address = '0x000000000000000000000000000000000000b0b0';
const charlie: Address = '0x000000000000000000000000000000000000c0c0';

function makeState(
  intents: Intent[],
  overrides: Partial<ChainState> = {}
): ChainState {
  const state: ChainState = {
    ticketMeta: new Map(),
    depositor: new Map(),
    intentState: new Map(),
    usdcBalance: new Map(),
    usdcAllowance: new Map(),
    blockTimestamp: 1000n,
    ...overrides,
  };
  for (const intent of intents) {
    const h = hashIntent(intent);
    state.intentState.set(h, INTENT_STATE.LIVE);
    state.usdcBalance.set(intent.owner, 1000_000_000n);
    state.usdcAllowance.set(intent.owner, 1000_000_000n);
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
    status?: number;
  } = {}
): void {
  state.ticketMeta.set(tokenId, {
    eventId: opts.eventId ?? EVENT_ID,
    sessionId: opts.sessionId ?? 0,
    sectionId: opts.sectionId ?? 0,
    row: opts.row ?? 1,
    seat: opts.seat ?? 1,
    status: opts.status ?? 0,
  });
}

describe('validateSettlement', () => {
  it('accepts a valid two-way swap', () => {
    const intentA: Intent = {
      owner: alice,
      offered: [1n],
      eventId: EVENT_ID,
      sessionMask: 3n,
      sectionMask: 3n,
      exactCount: 1,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: 0n,
      deadline: 2000n,
      nonce: 1n,
    };
    const intentB: Intent = {
      owner: bob,
      offered: [2n],
      eventId: EVENT_ID,
      sessionMask: 3n,
      sectionMask: 3n,
      exactCount: 1,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: 0n,
      deadline: 2000n,
      nonce: 1n,
    };

    const state = makeState([intentA, intentB]);
    addTicket(state, 1n, { sessionId: 0, sectionId: 0 });
    addTicket(state, 2n, { sessionId: 1, sectionId: 1 });

    const hA = hashIntent(intentA);
    const hB = hashIntent(intentB);

    const legs: Leg[] = [
      { intentHash: hA, receives: [2n], netPayment: 0n },
      { intentHash: hB, receives: [1n], netPayment: 0n },
    ];

    expect(validateSettlement([intentA, intentB], legs, state)).toBeNull();
  });

  it('rejects expired intent', () => {
    const intent: Intent = {
      owner: alice,
      offered: [1n],
      eventId: EVENT_ID,
      sessionMask: 1n,
      sectionMask: 1n,
      exactCount: 1,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: 0n,
      deadline: 500n,
      nonce: 1n,
    };
    const intentB: Intent = {
      owner: bob,
      offered: [2n],
      eventId: EVENT_ID,
      sessionMask: 1n,
      sectionMask: 1n,
      exactCount: 1,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: 0n,
      deadline: 2000n,
      nonce: 1n,
    };

    const state = makeState([intent, intentB]);
    addTicket(state, 1n);
    addTicket(state, 2n);

    const hA = hashIntent(intent);
    const hB = hashIntent(intentB);
    const legs: Leg[] = [
      { intentHash: hA, receives: [2n], netPayment: 0n },
      { intentHash: hB, receives: [1n], netPayment: 0n },
    ];

    const err = validateSettlement([intent, intentB], legs, state);
    expect(err).not.toBeNull();
    expect(err!.check).toBe('V1');
    expect(err!.error).toBe('IntentExpired');
  });

  it('rejects revoked intent', () => {
    const intent: Intent = {
      owner: alice,
      offered: [1n],
      eventId: EVENT_ID,
      sessionMask: 1n,
      sectionMask: 1n,
      exactCount: 1,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: 0n,
      deadline: 2000n,
      nonce: 1n,
    };
    const intentB: Intent = {
      owner: bob,
      offered: [2n],
      eventId: EVENT_ID,
      sessionMask: 1n,
      sectionMask: 1n,
      exactCount: 1,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: 0n,
      deadline: 2000n,
      nonce: 1n,
    };

    const state = makeState([intent, intentB]);
    addTicket(state, 1n);
    addTicket(state, 2n);
    state.intentState.set(hashIntent(intent), INTENT_STATE.REVOKED);

    const legs: Leg[] = [
      { intentHash: hashIntent(intent), receives: [2n], netPayment: 0n },
      { intentHash: hashIntent(intentB), receives: [1n], netPayment: 0n },
    ];

    const err = validateSettlement([intent, intentB], legs, state);
    expect(err).not.toBeNull();
    expect(err!.check).toBe('V1');
    expect(err!.error).toBe('IntentNotLive');
  });

  it('rejects redeemed ticket', () => {
    const intentA: Intent = {
      owner: alice,
      offered: [1n],
      eventId: EVENT_ID,
      sessionMask: 1n,
      sectionMask: 1n,
      exactCount: 1,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: 0n,
      deadline: 2000n,
      nonce: 1n,
    };
    const intentB: Intent = {
      owner: bob,
      offered: [2n],
      eventId: EVENT_ID,
      sessionMask: 1n,
      sectionMask: 1n,
      exactCount: 1,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: 0n,
      deadline: 2000n,
      nonce: 1n,
    };

    const state = makeState([intentA, intentB]);
    addTicket(state, 1n, { status: 1 });
    addTicket(state, 2n);

    const legs: Leg[] = [
      { intentHash: hashIntent(intentA), receives: [2n], netPayment: 0n },
      { intentHash: hashIntent(intentB), receives: [1n], netPayment: 0n },
    ];

    const err = validateSettlement([intentA, intentB], legs, state);
    expect(err).not.toBeNull();
    expect(err!.check).toBe('V3');
    expect(err!.error).toBe('TicketRedeemed');
  });

  it('rejects conservation violation', () => {
    const intentA: Intent = {
      owner: alice,
      offered: [1n],
      eventId: EVENT_ID,
      sessionMask: 1n,
      sectionMask: 1n,
      exactCount: 1,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: 0n,
      deadline: 2000n,
      nonce: 1n,
    };
    const intentB: Intent = {
      owner: bob,
      offered: [2n],
      eventId: EVENT_ID,
      sessionMask: 1n,
      sectionMask: 1n,
      exactCount: 1,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: 0n,
      deadline: 2000n,
      nonce: 1n,
    };

    const state = makeState([intentA, intentB]);
    addTicket(state, 1n);
    addTicket(state, 2n);
    addTicket(state, 3n);

    const legs: Leg[] = [
      { intentHash: hashIntent(intentA), receives: [3n], netPayment: 0n },
      { intentHash: hashIntent(intentB), receives: [1n], netPayment: 0n },
    ];

    const err = validateSettlement([intentA, intentB], legs, state);
    expect(err).not.toBeNull();
    expect(err!.check).toBe('V4');
  });

  it('rejects over budget', () => {
    const intentA: Intent = {
      owner: alice,
      offered: [1n],
      eventId: EVENT_ID,
      sessionMask: 1n,
      sectionMask: 1n,
      exactCount: 1,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: 10_000_000n,
      deadline: 2000n,
      nonce: 1n,
    };
    const intentB: Intent = {
      owner: bob,
      offered: [2n],
      eventId: EVENT_ID,
      sessionMask: 1n,
      sectionMask: 1n,
      exactCount: 1,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: -20_000_000n,
      deadline: 2000n,
      nonce: 1n,
    };

    const state = makeState([intentA, intentB]);
    addTicket(state, 1n);
    addTicket(state, 2n);

    const legs: Leg[] = [
      { intentHash: hashIntent(intentA), receives: [2n], netPayment: 20_000_000n },
      { intentHash: hashIntent(intentB), receives: [1n], netPayment: -20_000_000n },
    ];

    const err = validateSettlement([intentA, intentB], legs, state);
    expect(err).not.toBeNull();
    expect(err!.check).toBe('V6');
    expect(err!.error).toBe('BudgetExceeded');
  });

  it('rejects unbalanced payment', () => {
    const intentA: Intent = {
      owner: alice,
      offered: [1n],
      eventId: EVENT_ID,
      sessionMask: 1n,
      sectionMask: 1n,
      exactCount: 1,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: 50_000_000n,
      deadline: 2000n,
      nonce: 1n,
    };
    const intentB: Intent = {
      owner: bob,
      offered: [2n],
      eventId: EVENT_ID,
      sessionMask: 1n,
      sectionMask: 1n,
      exactCount: 1,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: 0n,
      deadline: 2000n,
      nonce: 1n,
    };

    const state = makeState([intentA, intentB]);
    addTicket(state, 1n);
    addTicket(state, 2n);

    const legs: Leg[] = [
      { intentHash: hashIntent(intentA), receives: [2n], netPayment: 10_000_000n },
      { intentHash: hashIntent(intentB), receives: [1n], netPayment: 0n },
    ];

    const err = validateSettlement([intentA, intentB], legs, state);
    expect(err).not.toBeNull();
    expect(err!.check).toBe('V7');
    expect(err!.error).toBe('PaymentImbalance');
  });

  it('rejects wrong session', () => {
    const intentA: Intent = {
      owner: alice,
      offered: [1n],
      eventId: EVENT_ID,
      sessionMask: 1n, // only session 0
      sectionMask: 3n,
      exactCount: 1,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: 0n,
      deadline: 2000n,
      nonce: 1n,
    };
    const intentB: Intent = {
      owner: bob,
      offered: [2n],
      eventId: EVENT_ID,
      sessionMask: 3n,
      sectionMask: 3n,
      exactCount: 1,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: 0n,
      deadline: 2000n,
      nonce: 1n,
    };

    const state = makeState([intentA, intentB]);
    addTicket(state, 1n, { sessionId: 0, sectionId: 0 });
    addTicket(state, 2n, { sessionId: 1, sectionId: 0 });

    const legs: Leg[] = [
      { intentHash: hashIntent(intentA), receives: [2n], netPayment: 0n },
      { intentHash: hashIntent(intentB), receives: [1n], netPayment: 0n },
    ];

    const err = validateSettlement([intentA, intentB], legs, state);
    expect(err).not.toBeNull();
    expect(err!.check).toBe('V5');
    expect(err!.error).toBe('SessionNotAccepted');
  });

  it('rejects insufficient payment capacity', () => {
    const intentA: Intent = {
      owner: alice,
      offered: [1n],
      eventId: EVENT_ID,
      sessionMask: 3n,
      sectionMask: 3n,
      exactCount: 1,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: 50_000_000n,
      deadline: 2000n,
      nonce: 1n,
    };
    const intentB: Intent = {
      owner: bob,
      offered: [2n],
      eventId: EVENT_ID,
      sessionMask: 3n,
      sectionMask: 3n,
      exactCount: 1,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: -20_000_000n,
      deadline: 2000n,
      nonce: 1n,
    };

    const state = makeState([intentA, intentB]);
    addTicket(state, 1n, { sessionId: 0 });
    addTicket(state, 2n, { sessionId: 1 });
    state.usdcBalance.set(alice, 0n);

    const legs: Leg[] = [
      { intentHash: hashIntent(intentA), receives: [2n], netPayment: 20_000_000n },
      { intentHash: hashIntent(intentB), receives: [1n], netPayment: -20_000_000n },
    ];

    const err = validateSettlement([intentA, intentB], legs, state);
    expect(err).not.toBeNull();
    expect(err!.check).toBe('V8');
    expect(err!.error).toBe('InsufficientPaymentCapacity');
  });
});
