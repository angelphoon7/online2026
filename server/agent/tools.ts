import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import type { Hex } from 'viem';
import type { Snapshot } from '@/shared/graph';
import { diagnose, type Evidence } from './diagnose';
import { whatIf, WhatIfError, type WhatIfChanges } from './what-if';
import { poolOverview } from './overview';
import { readCapacity, type Capacity } from '../solve-hypothetical';
import type { Address } from 'viem';

// Tool definitions and dispatch - step 7-F of docs/RESHUFFLE_GRAPH_PLAN.md.
//
// This is where the model's only real decision happens: which question is being asked. The
// answers come from the deterministic engine, so a wrong tool choice produces an unhelpful
// answer, never an untrue one.
//
// Every tool is read-only and pinned to one snapshot. None of them can sign, submit, or
// change anything - the agent holds no key.

const HASH = { type: 'string' as const, description: 'A committed intent hash: 0x followed by 64 hex characters.' };

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'diagnose_intent',
    description:
      'Explain why a RESHUFFLE intent has no settlement at the pinned block. Returns: whether a ' +
      'reshuffle including it exists right now; or the named reason it was excluded from matching; ' +
      'or a supply funnel (do the tickets it wants exist?), a demand check (does anyone accept the ' +
      'tickets it offers?), and single-condition relaxations each re-run through the solver. ' +
      'Read-only. Use this for "why can\'t this settle?" and "what would make it settle?".',
    input_schema: {
      type: 'object',
      properties: { intentHash: HASH },
      required: ['intentHash'],
      additionalProperties: false,
    },
  },
  {
    name: 'what_if',
    description:
      "Re-run the solver with the participant's own intent hypothetically changed - a higher or " +
      'lower signed payment limit, a dropped cohesion requirement, or additional acceptable ' +
      'sections or sessions. Use this when the question names a specific change ("what if I drop ' +
      'adjacency?", "what if I accept Tier 2?"). The result is never submittable: the participant ' +
      'would have to sign a new intent, and nothing moves until they do.',
    input_schema: {
      type: 'object',
      properties: {
        intentHash: HASH,
        changes: {
          type: 'object',
          properties: {
            maxNetPayUsdc: {
              type: 'number',
              description: 'Signed USDC. Positive is a ceiling on what they pay; negative is a floor on what they must receive.',
            },
            mustBeAdjacent: { type: 'boolean' },
            mustShareSection: { type: 'boolean' },
            mustShareSession: { type: 'boolean' },
            addSections: { type: 'array', items: { type: 'integer' }, description: 'Section ids to also accept.' },
            addSessions: { type: 'array', items: { type: 'integer' }, description: 'Session ids to also accept.' },
          },
          additionalProperties: false,
        },
      },
      required: ['intentHash', 'changes'],
      additionalProperties: false,
    },
  },
  {
    name: 'pool_overview',
    description:
      'Counts of live intents and escrowed tickets at the pinned block, by session and by section, ' +
      'plus how many intents the indexer excluded and why. Use this for questions about the market ' +
      'as a whole rather than one intent.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

export type Dispatcher = {
  run: (name: string, input: unknown) => Promise<unknown>;
  /** The diagnosis of the selected intent, for the guard's deterministic fallback. */
  baseline: () => Promise<Evidence>;
};

const asHash = (value: unknown, fallback: Hex): Hex =>
  typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value) ? (value.toLowerCase() as Hex) : fallback;

/**
 * Bind the tools to one snapshot and one selected intent.
 *
 * Payment capacity and the baseline diagnosis are each computed at most once per request and
 * shared: a question that triggers diagnose_intent and then two what_ifs should not re-read
 * the same USDC balances three times.
 */
export function dispatcher(snapshot: Snapshot, selected: Hex): Dispatcher {
  let capacity: Promise<Capacity> | undefined;
  let baseline: Promise<Evidence> | undefined;

  const funds = () => (capacity ??= readCapacity(snapshot.intents.map((i) => i.owner as Address), snapshot.block));
  const liveAtSnapshot = (hash: Hex) => snapshot.intents.some(i => i.hash.toLowerCase() === hash.toLowerCase());
  const diagnosis = async (hash: Hex) => diagnose(snapshot, hash, liveAtSnapshot(hash) ? await funds() : undefined);
  const selectedDiagnosis = () => (baseline ??= diagnosis(selected));

  return {
    baseline: selectedDiagnosis,

    run: async (name, input) => {
      const args = (input ?? {}) as Record<string, unknown>;
      // An intent hash the model invented cannot be diagnosed; fall back to the selected
      // intent, which is the one the user actually has open.
      const hash = asHash(args.intentHash, selected);

      if (name === 'diagnose_intent') {
        return hash === selected ? await selectedDiagnosis() : await diagnosis(hash);
      }
      if (name === 'what_if') {
        try {
          return await whatIf(snapshot, hash, (args.changes ?? {}) as WhatIfChanges, liveAtSnapshot(hash) ? await funds() : undefined);
        } catch (error) {
          if (error instanceof WhatIfError) return { error: error.message, submittable: false };
          throw error;
        }
      }
      if (name === 'pool_overview') return poolOverview(snapshot);
      return { error: `unknown tool ${name}` };
    },
  };
}

export { type Evidence };
