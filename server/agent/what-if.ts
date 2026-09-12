import 'server-only';
import type { Hex } from 'viem';
import type { Intent } from '../../solver/src/types';
import type { Snapshot } from '@/shared/graph';
import { solveHypothetical, type Capacity } from '../solve-hypothetical';
import { SEARCH_CONFIG } from '../solve';
import type { RequestBudget } from './request-budget';
import type { CounterpartyIntent } from '@/lib/agent-evidence';

// what_if - step 7-E of docs/RESHUFFLE_GRAPH_PLAN.md.
//
// Answers "what if I accepted Tier 2 as well?" by re-running the solver with the caller's own
// intent hypothetically changed. The result is never submittable: the participant would have
// to sign a new intent, and nothing moves until they do. That is enforced in
// server/solve-hypothetical.ts by the literal `submittable: false` type, not by wording here.
//
// Only the fields listed in the tool schema can be changed, and only in the widening or
// budget-raising direction that the UI offers. eventId, offered, exactCount, deadline, nonce
// and owner are not changeable through this path: those are what the participant asked for
// and who they are, and silently varying them would answer a different question than the one
// asked.

export type WhatIfChanges = {
  /** Signed USDC. Positive is a ceiling on what they pay, negative a floor on what they get. */
  maxNetPayUsdc?: number;
  mustBeAdjacent?: boolean;
  mustShareSection?: boolean;
  mustShareSession?: boolean;
  addSections?: number[];
  addSessions?: number[];
};

const USDC = 1_000_000n;
/** Masks index bit positions, and TicketNFT enforces class ids below 256 at mint. */
const MAX_CLASS_ID = 255;

export class WhatIfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhatIfError';
  }
}

/** USDC has 6 decimals; the conversion has to survive a negative amount unchanged. */
export function toContractUnits(usdc: number): bigint {
  if (!Number.isFinite(usdc)) throw new WhatIfError('Provide a finite USDC amount.');
  if (Math.abs(usdc) > 1_000_000) throw new WhatIfError('That amount is outside the demo range.');
  return BigInt(Math.round(usdc * Number(USDC)));
}

function classIds(values: unknown, label: string): number[] {
  if (!Array.isArray(values) || values.length > 256) {
    throw new WhatIfError(`${label} must be an array of at most 256 class ids.`);
  }
  for (const value of values) {
    if (!Number.isInteger(value) || value < 0 || value > MAX_CLASS_ID) {
      throw new WhatIfError(`${label} ids must be whole numbers between 0 and ${MAX_CLASS_ID}.`);
    }
  }
  return [...new Set(values)] as number[];
}

const BOOLEAN_FIELDS = ['mustBeAdjacent', 'mustShareSection', 'mustShareSession'] as const;
const CLASS_FIELDS = ['addSections', 'addSessions'] as const;
const FIELDS = new Set<string>(['maxNetPayUsdc', ...BOOLEAN_FIELDS, ...CLASS_FIELDS]);

/** Model tool schemas describe inputs; this runtime boundary enforces them. */
export function parseWhatIfChanges(input: unknown): WhatIfChanges {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    throw new WhatIfError('changes must be an object containing only supported fields.');
  }
  const raw = input as Record<string, unknown>;
  for (const field of Object.keys(raw)) {
    if (!FIELDS.has(field)) throw new WhatIfError(`Unsupported change field: ${field}.`);
  }
  const parsed: WhatIfChanges = {};
  if (Object.hasOwn(raw, 'maxNetPayUsdc')) {
    if (typeof raw.maxNetPayUsdc !== 'number') throw new WhatIfError('maxNetPayUsdc must be a finite number.');
    toContractUnits(raw.maxNetPayUsdc);
    parsed.maxNetPayUsdc = raw.maxNetPayUsdc;
  }
  for (const field of BOOLEAN_FIELDS) {
    if (!Object.hasOwn(raw, field)) continue;
    if (typeof raw[field] !== 'boolean') throw new WhatIfError(`${field} must be a boolean: true or false.`);
    parsed[field] = raw[field];
  }
  for (const field of CLASS_FIELDS) {
    if (Object.hasOwn(raw, field)) parsed[field] = classIds(raw[field], field);
  }
  return parsed;
}

/** Apply the requested changes to a committed intent, rejecting anything not offered. */
export function applyChanges(intent: Intent, input: unknown): Intent {
  const changes = parseWhatIfChanges(input);
  const next: Intent = { ...intent };
  if (changes.maxNetPayUsdc !== undefined) next.maxNetPay = toContractUnits(changes.maxNetPayUsdc);
  if (changes.mustBeAdjacent !== undefined) next.mustBeAdjacent = changes.mustBeAdjacent;
  if (changes.mustShareSection !== undefined) next.mustShareSection = changes.mustShareSection;
  if (changes.mustShareSession !== undefined) next.mustShareSession = changes.mustShareSession;
  for (const section of changes.addSections ?? []) next.sectionMask |= 1n << BigInt(section);
  for (const session of changes.addSessions ?? []) next.sessionMask |= 1n << BigInt(session);

  // mustBeAdjacent requires exactCount >= 2, enforced at commit. A hypothetical that turns it
  // on below that describes an intent the registry would refuse, so refuse it here too rather
  // than reporting a result about something nobody could sign.
  if (next.mustBeAdjacent && next.exactCount < 2) {
    throw new WhatIfError('Adjacency needs at least two requested tickets; commit() rejects it below that.');
  }
  return next;
}

export type WhatIfResult = {
  submittable: false;
  found: boolean;
  block: string;
  bounds: typeof SEARCH_CONFIG;
  intent: string;
  changes: WhatIfChanges;
  counterparties: string[];
  counterpartyIntents: CounterpartyIntent[];
  participantCount: number | null;
  targetNetPay: string | null;
  receives: string[];
  /** Set when the intent is not live in this snapshot, so nothing could be varied. */
  unavailable?: 'NOT_LIVE_AT_THIS_BLOCK';
};

export async function whatIf(
  snapshot: Snapshot,
  intentHash: Hex,
  input: unknown,
  capacity?: Capacity,
  budget?: RequestBudget
): Promise<WhatIfResult> {
  budget?.checkpoint();
  const changes = parseWhatIfChanges(input);
  const target = intentHash.toLowerCase();
  const intent = snapshot.intents.find((i) => i.hash.toLowerCase() === target);
  const shell = {
    submittable: false as const,
    block: snapshot.block.toString(),
    bounds: SEARCH_CONFIG,
    intent: intentHash,
    changes,
  };
  if (!intent) {
    return { ...shell, found: false, counterparties: [], counterpartyIntents: [], participantCount: null, targetNetPay: null, receives: [], unavailable: 'NOT_LIVE_AT_THIS_BLOCK' };
  }

  const varied = applyChanges({ ...intent }, changes);
  const result = await solveHypothetical(snapshot, { replaceHash: intent.hash, intent: varied }, capacity, budget);

  return {
    ...shell,
    found: result.found,
    counterparties: result.counterparties,
    counterpartyIntents: result.counterpartyIntents,
    participantCount: result.participantCount,
    targetNetPay: result.targetNetPay,
    receives: result.receives,
  };
}
