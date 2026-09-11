import { describe, it, expect } from 'vitest';
import { hashIntent, INTENT_TYPEHASH } from '../src/hash.js';
import type { Intent } from '../src/types.js';

describe('hashIntent', () => {
  it('INTENT_TYPEHASH matches Solidity constant', () => {
    expect(INTENT_TYPEHASH).toBe(
      '0x91f516d8c49db0dc6f0c19637e160da3ebab539eb1d439344398a2c1e8a14488'
    );
  });

  it('matches Solidity fixture vector', () => {
    const intent: Intent = {
      owner: '0x1234567890123456789012345678901234567890',
      offered: [100n, 200n],
      eventId: 1,
      sessionMask: 3n,
      sectionMask: 7n,
      exactCount: 2,
      mustShareSession: true,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: 50000000n,
      deadline: 1694649600n,
      nonce: 42n,
    };

    expect(hashIntent(intent)).toBe(
      '0x99dad476ef70ca50f04342e1c4502e03a649eaefe22ab303c6b051c481567e07'
    );
  });

  it('different nonce produces different hash', () => {
    const base: Intent = {
      owner: '0x1234567890123456789012345678901234567890',
      offered: [100n, 200n],
      eventId: 1,
      sessionMask: 3n,
      sectionMask: 7n,
      exactCount: 2,
      mustShareSession: true,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: 50000000n,
      deadline: 1694649600n,
      nonce: 42n,
    };
    const altered = { ...base, nonce: 43n };
    expect(hashIntent(base)).not.toBe(hashIntent(altered));
  });

  it('empty offered array hashes correctly', () => {
    const intent: Intent = {
      owner: '0x1234567890123456789012345678901234567890',
      offered: [],
      eventId: 1,
      sessionMask: 3n,
      sectionMask: 7n,
      exactCount: 0,
      mustShareSession: false,
      mustShareSection: false,
      mustBeAdjacent: false,
      maxNetPay: -50000000n,
      deadline: 1694649600n,
      nonce: 1n,
    };
    const hash = hashIntent(intent);
    expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
  });
});
