export type Hex = `0x${string}`;
export type Address = `0x${string}`;

export interface TicketMeta {
  eventId: number;
  sessionId: number;
  sectionId: number;
  row: number;
  seat: number;
  status: number; // 0 active, 1 redeemed
}

export interface Intent {
  owner: Address;
  offered: bigint[];
  eventId: number;
  sessionMask: bigint;
  sectionMask: bigint;
  exactCount: number;
  mustShareSession: boolean;
  mustShareSection: boolean;
  mustBeAdjacent: boolean;
  maxNetPay: bigint;
  deadline: bigint;
  nonce: bigint;
}

export interface Leg {
  intentHash: Hex;
  receives: bigint[];
  netPayment: bigint;
}

export interface ChainState {
  ticketMeta: Map<bigint, TicketMeta>;
  depositor: Map<bigint, Address>;
  intentState: Map<Hex, number>;
  usdcBalance: Map<Address, bigint>;
  usdcAllowance: Map<Address, bigint>;
  blockTimestamp: bigint;
}

export interface SearchConfig {
  maxParticipants: number;
  maxCandidates: number;
  timeoutMs: number;
  /**
   * Restrict the search to reshuffles that include this intent.
   *
   * The bound is spent on candidates, not on subsets, so a global search over a large pool
   * fills its budget with reshuffles between other people and never reaches the asking
   * participant at all. That is the right behaviour when proposing a settlement - any valid
   * reshuffle will do - and the wrong one when answering "can I settle?", where a candidate
   * without the asker answers a different question. The ranking rule is unchanged; it is
   * applied to the candidates that include this hash.
   */
  mustInclude?: Hex;
}

export interface Candidate {
  intents: Intent[];
  legs: Leg[];
  gross: bigint;
  participantCount: number;
  intentHashSet: Hex[];
}

export interface ExcludedCandidate {
  intentHashes: Hex[];
  reason: string;
}

export interface SearchResult {
  candidates: Candidate[];
  excluded: ExcludedCandidate[];
  termination: 'complete' | 'timeout' | 'candidate-limit';
}

export interface Evidence {
  search?: { termination: SearchResult['termination'] };
  timestamp: string;
  intentsConsidered: number;
  candidatesFound: number;
  candidatesExcluded: ExcludedCandidate[];
  chosen: { intentHashes: Hex[]; gross: string; reason: string } | null;
  simulationResult?: { success: boolean; error?: string };
  transactionHash?: Hex;
}

export interface ValidationError {
  check: string;
  error: string;
  details: Record<string, unknown>;
}

export const INTENT_STATE = {
  NONE: 0,
  LIVE: 1,
  REVOKED: 2,
  SETTLED: 3,
} as const;
