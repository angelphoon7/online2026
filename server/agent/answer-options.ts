import 'server-only';
import type { Evidence } from './diagnose';
import type { PoolOverview } from './overview';
import type { WhatIfResult } from './what-if';
import { formatUsdc, renderEvidence } from './template';

export type AnswerSource = { tool: string; output: unknown };
export const answerPrefix = (block: string) => `At Arc Testnet block #${block},`;

function payment(units: string): string {
  const amount = BigInt(units);
  return amount > 0n ? `paying ${formatUsdc(amount)}`
    : amount < 0n ? `receiving ${formatUsdc(-amount)}` : 'with no payment either way';
}

function renderWhatIf(result: WhatIfResult): string {
  const at = answerPrefix(result.block);
  if (result.unavailable) return `${at} this intent is not live, so this hypothetical cannot be evaluated. Commit a new intent to rejoin the pool.`;
  const changes: string[] = [];
  const c = result.changes;
  if (c.maxNetPayUsdc !== undefined) {
    const units = BigInt(Math.round(c.maxNetPayUsdc * 1_000_000));
    changes.push(units >= 0n ? `a payment ceiling of ${formatUsdc(units)}` : `a minimum receipt of ${formatUsdc(-units)}`);
  }
  if (c.mustBeAdjacent !== undefined) changes.push(c.mustBeAdjacent ? 'requiring adjacent seats' : 'dropping the adjacent-seats requirement');
  if (c.mustShareSection !== undefined) changes.push(c.mustShareSection ? 'requiring one section' : 'allowing different sections');
  if (c.mustShareSession !== undefined) changes.push(c.mustShareSession ? 'requiring one session' : 'allowing different sessions');
  if (c.addSections?.length) changes.push(`also accepting sections ${c.addSections.join(', ')}`);
  if (c.addSessions?.length) changes.push(`also accepting sessions ${c.addSessions.join(', ')}`);
  const change = changes.join('; ') || 'keeping the signed conditions';
  const outcome = result.found
    ? `a ${result.participantCount}-participant candidate was found, ${payment(result.targetNetPay!)}; the received ticket IDs would be ${result.receives.length ? result.receives.join(', ') : 'none'}`
    : 'no settlement was found within the search bound';
  return `${at} hypothetically ${change}: ${outcome}. This does not change the committed intent. Sign a new intent to apply changed conditions; settlement still re-checks them before execution.`;
}

function renderOverview(result: PoolOverview): string {
  const sections = result.bySection.map(s => `section ${s.sectionId}: ${s.tickets}`).join('; ') || 'none';
  const sessions = result.bySession.map(s => `session ${s.sessionId}: ${s.tickets}`).join('; ') || 'none';
  return `${answerPrefix(result.block)} the pool contains ${result.liveIntents} live intents and ${result.escrowedTickets} escrowed tickets, including ${result.pureBuyers} pure-buyer intents and ${result.pureSellers} pure-seller intents. Escrowed ticket counts by section: ${sections}. By session: ${sessions}. These counts do not establish a match; diagnose the selected intent to check its conditions.`;
}

/**
 * The model selects a finding; amounts, their direction, counts and status are rendered here.
 * Never derive an answer from a tool's input or from model-supplied answerOptions. Matching
 * whole passages binds each number to its meaning and to the particular hypothetical tried.
 */
export function answerOptions(source: AnswerSource, block: string, selectedIntent?: string): string[] {
  const value = source.output;
  if (!value || typeof value !== 'object') return [];
  const out = value as Record<string, unknown>;
  if (out.block !== block) return [];
  if (source.tool !== 'pool_overview' && selectedIntent && out.intent !== selectedIntent.toLowerCase()) return [];
  if ('error' in out) return [];
  try {
    if (source.tool === 'diagnose_intent' && typeof out.intent === 'string' && Array.isArray(out.relaxations)
      && ['SETTLEABLE', 'NOT_FOUND_WITHIN_BOUND', 'EXCLUDED', 'CLOSED', 'UNKNOWN'].includes(String(out.status))) {
      return [renderEvidence(value as Evidence)];
    }
    if (source.tool === 'what_if' && out.submittable === false && typeof out.found === 'boolean'
      && out.changes && Array.isArray(out.receives)
      && (!out.found || (typeof out.targetNetPay === 'string' && Number.isInteger(out.participantCount)))) {
      return [renderWhatIf(value as WhatIfResult)];
    }
    if (source.tool === 'pool_overview' && Number.isInteger(out.liveIntents) && Number.isInteger(out.escrowedTickets)
      && Array.isArray(out.bySection) && Array.isArray(out.bySession)) {
      return [renderOverview(value as PoolOverview)];
    }
  } catch {
    // An incomplete tool result cannot support narration.
  }
  return [];
}
