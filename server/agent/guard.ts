import 'server-only';
import { renderEvidence } from './template';
import type { Evidence } from './diagnose';

// The guard - step 7-H of docs/RESHUFFLE_GRAPH_PLAN.md.
//
// The last check between a language model and a claim about somebody's tickets. It does not
// improve the answer; it decides whether the answer is allowed to be shown at all, and
// substitutes the deterministic one when it is not.
//
// Three rejections, each for a failure that would otherwise be invisible:
//
//   1. Banned vocabulary. This project's whole claim is that it promises only what it checks.
//      "optimal", "guaranteed" and "no solution exists" are promises nothing here can keep -
//      the search is bounded, and a bound is not a proof of absence.
//   2. Addresses and hashes not present in the evidence. A plausible-looking counterparty
//      address that no tool returned is a fabricated one, and it would be indistinguishable
//      from a real one to the reader.
//   3. A missing or wrong block number. Every claim holds at one block. An answer that does
//      not say which block is not checkable, and one naming a different block is wrong.

const BANNED = [
  /\boptimal(ly)?\b/i,
  /\bbest price\b/i,
  /\bguarantee(d|s)?\b/i,
  /\bno risk\b/i,
  /\bimpossible\b/i,
  /\blocked\b/i,
  /\bno solution exists\b/i,
  /\beliminates?\b/i,
  /\bonly possible\b/i,
  /\brisk[- ]free\b/i,
  /\bcertain to\b/i,
];

/** One entry per tool call the model made, and the exact output it was given back. */
export type ToolLogEntry = { tool: string; input: unknown; output: unknown };

export type GuardedAnswer = {
  answer: string;
  /** True when the model's text was rejected and the deterministic sentence used instead. */
  guardFallback: boolean;
  /** Why it was rejected. Kept for debugging; the UI does not show it. */
  guardReason?: 'EMPTY' | 'BANNED_LANGUAGE' | 'UNSUPPORTED_IDENTIFIER' | 'WRONG_BLOCK';
  evidence: ToolLogEntry[];
  block: string;
};

/** JSON.stringify cannot serialize a bigint; the evidence is full of them. */
export const bigintSafe = (_key: string, value: unknown) => (typeof value === 'bigint' ? value.toString() : value);

/**
 * 0x-prefixed addresses (40 hex) and hashes (64 hex) the text states as fact.
 *
 * Truncated forms ("0x3a...") are not checked: they carry no claim a reader could act on, and
 * requiring them to match in full would reject correct answers for shortening a hash.
 */
function identifiers(text: string): string[] {
  return (text.match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])|0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g) ?? []).map((value) =>
    value.toLowerCase()
  );
}

export function checkAnswer(text: string, log: ToolLogEntry[], block: string): GuardedAnswer['guardReason'] | null {
  if (!text.trim()) return 'EMPTY';
  if (BANNED.some((pattern) => pattern.test(text))) return 'BANNED_LANGUAGE';

  const evidence = JSON.stringify(log, bigintSafe).toLowerCase();
  if (identifiers(text).some((value) => !evidence.includes(value))) return 'UNSUPPORTED_IDENTIFIER';

  // The block must be stated, and it must be the pinned one. A different number in a
  // "#<digits>" position means the answer is describing some other moment.
  const cited = text.match(/#(\d+)/g) ?? [];
  if (!cited.length) return 'WRONG_BLOCK';
  if (!cited.some((value) => value === `#${block}`)) return 'WRONG_BLOCK';

  return null;
}

/**
 * Accept the model's answer, or replace it with the deterministic one.
 *
 * `fallback` is the evidence to render when the answer is rejected. It is required: there is
 * no code path where a rejected answer leaves the user with nothing, and none where a
 * rejected answer is shown with a warning attached.
 */
export function guard(text: string, log: ToolLogEntry[], block: string, fallback: Evidence): GuardedAnswer {
  const reason = checkAnswer(text, log, block);
  if (!reason) return { answer: text.trim(), guardFallback: false, evidence: log, block };
  return { answer: renderEvidence(fallback), guardFallback: true, guardReason: reason, evidence: log, block };
}
