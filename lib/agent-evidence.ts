import type { Evidence as Diagnosis } from '@/server/agent/diagnose';
import type { WhatIfResult } from '@/server/agent/what-if';
import type { PoolOverview } from '@/server/agent/overview';
import { AGENT_EVIDENCE_COPY as COPY } from './agent-copy';

/** A committed intent actually used by a candidate at the answer's snapshot block. */
export type CounterpartyIntent = {
  intentHash: `0x${string}`;
  owner: `0x${string}`;
  committedTx: string;
};

export type { Diagnosis, WhatIfResult, PoolOverview };
export type AgentToolEntry = { tool: string; input?: unknown; output: unknown; source?: 'model' | 'fallback' | 'direct' };
export type ToolResult<T> = { index: number; output: T; source?: AgentToolEntry['source'] };
export type DrawerEvidence = {
  diagnosis: Diagnosis | null;
  diagnoses: ToolResult<Diagnosis>[];
  hypotheticals: ToolResult<WhatIfResult>[];
  overviews: ToolResult<PoolOverview>[];
  failures: { index: number; tool: string; error: string; code?: string }[];
  entries: AgentToolEntry[];
  omitted: number;
};

export class AgentEvidenceInvalid extends Error {
  constructor(message = COPY.invalid) { super(message); this.name = 'AgentEvidenceInvalid'; }
}
export class AgentEvidenceScopeMismatch extends Error {
  constructor() { super(COPY.mismatch); this.name = 'AgentEvidenceScopeMismatch'; }
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^0x[\da-f]{64}$/i.test(value);
export const evidenceBlock = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(v => typeof v === 'string');
const bounds = (value: unknown) => object(value) && ['maxParticipants', 'maxCandidates', 'timeoutMs'].every(k => count(value[k]));
const references = (value: unknown) => Array.isArray(value) && value.every(v => object(v) && hash(v.intentHash)
  && typeof v.owner === 'string' && /^0x[\da-f]{40}$/i.test(v.owner) && hash(v.committedTx));
const signedUnits = (value: unknown) => typeof value === 'string' && /^-?\d+$/.test(value);

/** The direct diagnosis endpoint must attest to its own intent, not just the requested URL. */
export function readDiagnosis(value: unknown, selected: string, block?: string): Diagnosis {
  if (!object(value) || !hash(value.intent) || !evidenceBlock(value.block)) throw new AgentEvidenceInvalid();
  if (value.intent.toLowerCase() !== selected.toLowerCase() || (block !== undefined && value.block !== block)) throw new AgentEvidenceScopeMismatch();
  if (!['SETTLEABLE', 'NOT_FOUND_WITHIN_BOUND', 'EXCLUDED', 'CLOSED', 'UNKNOWN'].includes(String(value.status))
    || !Array.isArray(value.relaxations) || !bounds(value.bounds)
    || typeof value.runtimeMs !== 'number' || !Number.isFinite(value.runtimeMs) || value.runtimeMs < 0) throw new AgentEvidenceInvalid();
  if (value.exclusion !== undefined && (!object(value.exclusion) || typeof value.exclusion.reason !== 'string'
    || (value.exclusion.detail !== undefined && typeof value.exclusion.detail !== 'string'))) throw new AgentEvidenceInvalid();
  if (value.closed !== undefined && (!object(value.closed) || !['REVOKED', 'SETTLED'].includes(String(value.closed.state))
    || (value.closed.tx !== null && !hash(value.closed.tx)))) throw new AgentEvidenceInvalid();
  if (value.settleable !== undefined && (!object(value.settleable) || !count(value.settleable.participantCount)
    || !signedUnits(value.settleable.targetNetPay) || !references(value.settleable.counterpartyIntents))) throw new AgentEvidenceInvalid();
  if (value.supply !== undefined && (!object(value.supply) || !Array.isArray(value.supply.stages)
    || !value.supply.stages.every(s => object(s) && typeof s.stage === 'string' && count(s.remaining))
    || !['need', 'largestGroup', 'groupSearched', 'groupCandidates'].every(k => count((value.supply as Record<string, unknown>)[k]))
    || typeof value.supply.truncated !== 'boolean')) throw new AgentEvidenceInvalid();
  if (value.demand !== undefined && (!object(value.demand) || !Array.isArray(value.demand.perTicket)
    || !value.demand.perTicket.every(t => object(t) && typeof t.ticket === 'string' && count(t.acceptingIntents)))) throw new AgentEvidenceInvalid();
  if (!value.relaxations.every(r => object(r) && typeof r.change === 'string' && typeof r.found === 'boolean'
    && (r.found ? count(r.participantCount) && signedUnits(r.targetNetPay) && references(r.counterpartyIntents)
      : r.participantCount === null && r.targetNetPay === null))) throw new AgentEvidenceInvalid();
  return value as unknown as Diagnosis;
}

/** Select by output identity and block. Model-written inputs never attest to successful results. */
export function readDrawerEvidence(value: unknown, selected: string, block: string): DrawerEvidence {
  if (!hash(selected) || !evidenceBlock(block) || !Array.isArray(value)) throw new AgentEvidenceInvalid();
  const view: DrawerEvidence = { diagnosis: null, diagnoses: [], hypotheticals: [], overviews: [], failures: [], entries: [], omitted: 0 };
  for (const [index, raw] of value.entries()) {
    if (!object(raw) || typeof raw.tool !== 'string') throw new AgentEvidenceInvalid();
    if (!['diagnose_intent', 'what_if', 'pool_overview'].includes(raw.tool)) { view.omitted++; continue; }
    const out = raw.output;
    if (!object(out)) throw new AgentEvidenceInvalid();
    if (typeof out.error === 'string') {
      // Failed what-if validation may have no output identity/block. Its input identifies
      // the attempted call only; the error is displayed separately from chain evidence.
      const attempted = hash(out.intent) ? out.intent : object(raw.input) ? raw.input.intentHash : undefined;
      if (raw.tool !== 'pool_overview' && (!hash(attempted) || attempted.toLowerCase() !== selected.toLowerCase())) { view.omitted++; continue; }
      if (out.block !== undefined && out.block !== block) throw new AgentEvidenceScopeMismatch();
      view.failures.push({ index, tool: raw.tool, error: out.error, code: typeof out.code === 'string' ? out.code : undefined });
      view.entries.push(raw as AgentToolEntry);
      continue;
    }
    if (raw.tool !== 'pool_overview') {
      if (!hash(out.intent)) throw new AgentEvidenceInvalid();
      if (out.intent.toLowerCase() !== selected.toLowerCase()) { view.omitted++; continue; }
    }
    if (out.block !== block) throw new AgentEvidenceScopeMismatch();
    const entry = raw as AgentToolEntry;
    if (raw.tool === 'diagnose_intent') {
      const diagnosis = readDiagnosis(out, selected, block);
      view.diagnoses.push({ index, output: diagnosis, source: entry.source });
      view.diagnosis ??= diagnosis;
    } else if (raw.tool === 'what_if') {
      if (out.submittable !== false || typeof out.found !== 'boolean' || !object(out.changes) || !bounds(out.bounds)
        || !strings(out.counterparties) || !references(out.counterpartyIntents) || !strings(out.receives)
        || (out.found ? !count(out.participantCount) || !signedUnits(out.targetNetPay) || out.unavailable !== undefined
          : out.participantCount !== null || out.targetNetPay !== null)
        || (out.unavailable !== undefined && out.unavailable !== 'NOT_LIVE_AT_THIS_BLOCK')) throw new AgentEvidenceInvalid();
      for (const [key, changed] of Object.entries(out.changes)) {
        const valid = key === 'maxNetPayUsdc' ? typeof changed === 'number' && Number.isFinite(changed) && Math.abs(changed) <= 1_000_000
          : ['mustBeAdjacent', 'mustShareSection', 'mustShareSession'].includes(key) ? typeof changed === 'boolean'
          : ['addSections', 'addSessions'].includes(key) && Array.isArray(changed) && changed.length <= 256 && changed.every(id => count(id) && id < 256);
        if (!valid) throw new AgentEvidenceInvalid();
      }
      view.hypotheticals.push({ index, output: out as unknown as WhatIfResult, source: entry.source });
    } else {
      if (!['liveIntents', 'escrowedTickets', 'pureSellers', 'pureBuyers'].every(k => count(out[k]))
        || !object(out.excludedByReason) || !Object.values(out.excludedByReason).every(count)
        || !Array.isArray(out.bySession) || !out.bySession.every(s => object(s) && count(s.sessionId) && count(s.tickets))
        || !Array.isArray(out.bySection) || !out.bySection.every(s => object(s) && count(s.sectionId) && count(s.tickets))) throw new AgentEvidenceInvalid();
      view.overviews.push({ index, output: out as unknown as PoolOverview, source: entry.source });
    }
    view.entries.push(entry);
  }
  if (!view.entries.length) throw new AgentEvidenceInvalid(COPY.missing);
  return view;
}
