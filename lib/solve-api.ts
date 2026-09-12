import type { Address, Hex } from 'viem';
import type { IntentParams } from './contracts';

export interface SolveEvidence {
  id: string;
  timestamp: string;
  source: { kind: string; blockNumber: string; subgraphEndpoint: string | null };
  intentsConsidered: number;
  candidatesFound: number;
  candidatesExcluded: { intentHashes: string[]; reason: string }[];
  chosen: { intentHashes: string[]; gross: string; reason: string } | null;
  simulationResult?: { success: boolean; error?: string };
  transactionHash?: string;
  receipt?: { status: string; blockNumber: string; confirmed: boolean };
  requestedIntentHashes?: Hex[];
  pool?: { liveIntents: number; searchableIntents: number; excludedIntents: number };
  search?: { termination: 'complete' | 'timeout' | 'candidate-limit' };
}
export interface SettlementProposal {
  evidenceId: string;
  intents: IntentParams[];
  legs: { intentHash: Hex; owner: Address; receives: bigint[]; netPayment: bigint; maxNetPay: bigint }[];
  gross: bigint;
  candidatesFound: number;
  reason: string;
}
// minBlock is the freshness floor (trust rule 2): the block of a transaction just sent, so the
// pool the backend searches cannot predate it. Omitted for an ordinary search, where any
// indexed block is a truthful answer.
const body = (fields: Record<string, unknown>, minBlock?: bigint) =>
  JSON.stringify(minBlock && minBlock > 0n ? { ...fields, minBlock: minBlock.toString() } : fields);
export async function findSettlement(intents: { hash: Hex }[], minBlock?: bigint): Promise<{ proposal: SettlementProposal | null; evidence: SolveEvidence }> {
  const response = await fetch('/api/solve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body({ intentHashes: intents.map(i => i.hash) }, minBlock) });
  return parseSolveResponse(response);
}
export async function findPoolSettlement(minBlock?: bigint): Promise<{ proposal: SettlementProposal | null; evidence: SolveEvidence }> {
  return parseSolveResponse(await fetch('/api/solve/pool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body({}, minBlock) }));
}
async function parseSolveResponse(response: Response): Promise<{ proposal: SettlementProposal | null; evidence: SolveEvidence }> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Backend solve failed');
  if (!data.proposal) return { proposal: null, evidence: data };
  const parsed: IntentParams[] = data.proposal.intents.map((i: Record<string, unknown>) => ({
    ...i, offered: (i.offered as string[]).map(BigInt),
    sessionMask: BigInt(i.sessionMask as string), sectionMask: BigInt(i.sectionMask as string),
    maxNetPay: BigInt(i.maxNetPay as string), deadline: BigInt(i.deadline as string), nonce: BigInt(i.nonce as string),
  }));
  return { evidence: data, proposal: {
    evidenceId: data.id, intents: parsed, gross: BigInt(data.chosen.gross), candidatesFound: data.candidatesFound, reason: data.chosen.reason,
    legs: data.proposal.legs.map((l: { intentHash: Hex; receives: string[]; netPayment: string }, index: number) => ({ ...l, receives: l.receives.map(BigInt), netPayment: BigInt(l.netPayment), owner: parsed[index].owner, maxNetPay: parsed[index].maxNetPay })),
  } };
}
export async function confirmSettlementEvidence(id: string, transactionHash: Hex): Promise<SolveEvidence> {
  const response = await fetch(`/api/evidence/${id}/receipt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transactionHash }) });
  const record = await response.json();
  if (!response.ok) throw new Error(record.error ?? 'Receipt verification failed');
  return record;
}
