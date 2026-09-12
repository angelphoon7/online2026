import 'server-only';
import { renderEvidence } from './template';
import type { Evidence } from './diagnose';
import { answerOptions, answerPrefix } from './answer-options';

const BANNED = [
  /\boptimal(ly)?\b/i, /\bbest price\b/i, /\bguarantee(d|s)?\b/i,
  /\bno risk\b/i, /\bimpossible\b/i, /\blocked\b/i, /\bno solution exists\b/i,
  /\beliminates?\b/i, /\bonly possible\b/i, /\brisk[- ]free\b/i, /\bcertain to\b/i,
];

/** Exact tool results, with fallback evidence distinguished from model tool use. */
export type ToolLogEntry = { tool: string; input: unknown; output: unknown; source?: 'model' | 'fallback' };
export type GuardReason = 'EMPTY' | 'BANNED_LANGUAGE' | 'UNSUPPORTED_IDENTIFIER' | 'WRONG_BLOCK'
  | 'INVALID_PREFIX' | 'EVIDENCE_BLOCK_MISMATCH' | 'UNSUPPORTED_CLAIM';
export type GuardedAnswer = {
  answer: string;
  guardFallback: boolean;
  guardReason?: GuardReason;
  evidence: ToolLogEntry[];
  block: string;
};

export const bigintSafe = (_key: string, value: unknown) => typeof value === 'bigint' ? value.toString() : value;
const normalise = (text: string) => text.trim().replace(/\s+/g, ' ');
const identifiers = (text: string) => text.match(/0x(?:[0-9a-fA-F]{64}|[0-9a-fA-F]{40})(?![0-9a-fA-F])/g) ?? [];

export function checkAnswer(text: string, log: ToolLogEntry[], block: string, selectedIntent?: string): GuardReason | null {
  if (!text.trim()) return 'EMPTY';
  if (BANNED.some(pattern => pattern.test(text))) return 'BANNED_LANGUAGE';
  // Ticket #7 is not block #7. Other fabricated block claims are also rejected by the
  // complete-passage check below; matching the right number somewhere is insufficient.
  const blocks = [...text.matchAll(/\bblock\s*#?\s*([\d,]+)/gi)];
  if (blocks.some(match => match[1].replaceAll(',', '') !== block)) return 'WRONG_BLOCK';
  if (!text.startsWith(`${answerPrefix(block)} `)) return 'INVALID_PREFIX';

  for (const entry of log) {
    if (entry.output && typeof entry.output === 'object' && 'block' in entry.output && entry.output.block !== block) {
      return 'EVIDENCE_BLOCK_MISMATCH';
    }
  }
  // Inputs are written by the model, so they cannot attest to an address or transaction.
  const outputs = JSON.stringify(log.map(entry => entry.output), bigintSafe).toLowerCase();
  if (identifiers(text).some(id => !outputs.includes(id.toLowerCase()))) return 'UNSUPPORTED_IDENTIFIER';

  // A value allowlist would permit reversing payer/receiver or treating a proposed ceiling
  // as an actual payment. Match whole evidence-rendered passages, including qualifications
  // and next action. Arbitrary prose cannot be certified by checking its numbers alone.
  const supported = log.flatMap(entry => answerOptions(entry, block, selectedIntent));
  if (!supported.some(option => normalise(option) === normalise(text))) return 'UNSUPPORTED_CLAIM';
  return null;
}

export class AgentEvidenceMismatch extends Error {
  constructor() {
    super('The fallback diagnosis does not belong to the answer snapshot.');
    this.name = 'AgentEvidenceMismatch';
  }
}

export function guard(text: string, log: ToolLogEntry[], block: string, fallback: Evidence): GuardedAnswer {
  if (fallback.block !== block) throw new AgentEvidenceMismatch();
  // Check BEFORE adding fallback evidence: the model cannot claim it used an uncalled tool.
  const reason = checkAnswer(text, log, block, fallback.intent);
  const evidence = log.some(entry => entry.tool === 'diagnose_intent'
    && JSON.stringify(entry.output, bigintSafe) === JSON.stringify(fallback, bigintSafe)) ? log : [
      ...log, { tool: 'diagnose_intent', input: { intentHash: fallback.intent }, output: fallback, source: 'fallback' as const },
    ];
  return reason
    ? { answer: renderEvidence(fallback), guardFallback: true, guardReason: reason, evidence, block }
    : { answer: text.trim(), guardFallback: false, evidence, block };
}
