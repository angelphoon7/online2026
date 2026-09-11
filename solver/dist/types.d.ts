export type Hex = `0x${string}`;
export type Address = `0x${string}`;
export interface TicketMeta {
    eventId: number;
    sessionId: number;
    sectionId: number;
    row: number;
    seat: number;
    status: number;
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
    search?: {
        termination: SearchResult['termination'];
    };
    timestamp: string;
    intentsConsidered: number;
    candidatesFound: number;
    candidatesExcluded: ExcludedCandidate[];
    chosen: {
        intentHashes: Hex[];
        gross: string;
        reason: string;
    } | null;
    simulationResult?: {
        success: boolean;
        error?: string;
    };
    transactionHash?: Hex;
}
export interface ValidationError {
    check: string;
    error: string;
    details: Record<string, unknown>;
}
export declare const INTENT_STATE: {
    readonly NONE: 0;
    readonly LIVE: 1;
    readonly REVOKED: 2;
    readonly SETTLED: 3;
};
