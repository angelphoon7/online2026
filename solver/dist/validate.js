import { hashIntent } from './hash.js';
import { INTENT_STATE } from './types.js';
export function validateSettlement(intents, legs, state) {
    const n = intents.length;
    // V0: Settlement shape
    if (n === 0 || n !== legs.length) {
        return { check: 'V0', error: 'MalformedSettlement', details: {} };
    }
    const intentHashes = [];
    for (let i = 0; i < n; i++) {
        const h = hashIntent(intents[i]);
        intentHashes.push(h);
        if (h !== legs[i].intentHash) {
            return {
                check: 'V0',
                error: 'IntentHashMismatch',
                details: { expected: h, actual: legs[i].intentHash },
            };
        }
        for (let j = 0; j < i; j++) {
            if (intentHashes[j] === intentHashes[i]) {
                return {
                    check: 'V0',
                    error: 'DuplicateIntentHash',
                    details: { intentHash: h },
                };
            }
        }
    }
    // V1: Intent validity
    for (let i = 0; i < n; i++) {
        const s = state.intentState.get(intentHashes[i]);
        if (s !== INTENT_STATE.LIVE) {
            return {
                check: 'V1',
                error: 'IntentNotLive',
                details: { intentHash: intentHashes[i] },
            };
        }
        if (state.blockTimestamp > intents[i].deadline) {
            return {
                check: 'V1',
                error: 'IntentExpired',
                details: { intentHash: intentHashes[i], deadline: intents[i].deadline.toString() },
            };
        }
    }
    // V2: Escrow ownership and event binding
    for (let i = 0; i < n; i++) {
        for (const tokenId of intents[i].offered) {
            const dep = state.depositor.get(tokenId);
            if (dep?.toLowerCase() !== intents[i].owner.toLowerCase()) {
                return {
                    check: 'V2',
                    error: 'TicketNotEscrowed',
                    details: { tokenId: tokenId.toString(), expectedOwner: intents[i].owner },
                };
            }
            const meta = state.ticketMeta.get(tokenId);
            if (!meta || meta.eventId !== intents[i].eventId) {
                return {
                    check: 'V2',
                    error: 'WrongEvent',
                    details: { tokenId: tokenId.toString() },
                };
            }
        }
    }
    // V3: Ticket status
    for (let i = 0; i < n; i++) {
        for (const tokenId of intents[i].offered) {
            const meta = state.ticketMeta.get(tokenId);
            if (meta && meta.status === 1) {
                return {
                    check: 'V3',
                    error: 'TicketRedeemed',
                    details: { tokenId: tokenId.toString() },
                };
            }
        }
    }
    // V4: Conservation
    const err4 = checkConservation(intents, legs);
    if (err4)
        return err4;
    // V5: Per-participant predicate
    for (let i = 0; i < n; i++) {
        const err5 = checkPredicate(intentHashes[i], intents[i], legs[i], state);
        if (err5)
            return err5;
    }
    // V6: Budget
    for (let i = 0; i < n; i++) {
        if (legs[i].netPayment > intents[i].maxNetPay) {
            return {
                check: 'V6',
                error: 'BudgetExceeded',
                details: {
                    intentHash: intentHashes[i],
                    limit: intents[i].maxNetPay.toString(),
                    actual: legs[i].netPayment.toString(),
                },
            };
        }
    }
    // V7: Payment balance
    let total = 0n;
    for (let i = 0; i < n; i++)
        total += legs[i].netPayment;
    if (total !== 0n) {
        return {
            check: 'V7',
            error: 'PaymentImbalance',
            details: { total: total.toString() },
        };
    }
    // V8: Payment capacity
    const ownerNets = new Map();
    for (let i = 0; i < n; i++) {
        const key = intents[i].owner.toLowerCase();
        ownerNets.set(key, (ownerNets.get(key) ?? 0n) + legs[i].netPayment);
    }
    for (const [owner, net] of ownerNets) {
        if (net > 0n) {
            const addr = owner;
            const balance = state.usdcBalance.get(addr) ?? 0n;
            const allowance = state.usdcAllowance.get(addr) ?? 0n;
            if (balance < net || allowance < net) {
                return {
                    check: 'V8',
                    error: 'InsufficientPaymentCapacity',
                    details: { payer: addr, required: net.toString() },
                };
            }
        }
    }
    return null;
}
function checkConservation(intents, legs) {
    const allOffered = [];
    const allReceived = [];
    for (let i = 0; i < intents.length; i++) {
        allOffered.push(...intents[i].offered);
        allReceived.push(...legs[i].receives);
    }
    if (allOffered.length !== allReceived.length) {
        return { check: 'V4', error: 'ConservationViolated', details: {} };
    }
    const sortedOffered = [...allOffered].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const sortedReceived = [...allReceived].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (let i = 1; i < sortedOffered.length; i++) {
        if (sortedOffered[i] === sortedOffered[i - 1]) {
            return { check: 'V4', error: 'ConservationViolated', details: {} };
        }
    }
    for (let i = 1; i < sortedReceived.length; i++) {
        if (sortedReceived[i] === sortedReceived[i - 1]) {
            return { check: 'V4', error: 'ConservationViolated', details: {} };
        }
    }
    for (let i = 0; i < sortedOffered.length; i++) {
        if (sortedOffered[i] !== sortedReceived[i]) {
            return { check: 'V4', error: 'ConservationViolated', details: {} };
        }
    }
    return null;
}
/**
 * V5 for one candidate bundle, without a whole settlement.
 *
 * The agent's supply funnel needs to ask "would this intent accept these tickets?" - masks,
 * exactCount, cohesion and adjacency - about bundles that are not part of any proposal. It
 * calls THIS, the same predicate settlement validation uses, rather than carrying a second
 * implementation: two copies of the adjacency rule would eventually disagree, and a diagnosis
 * that contradicts the contract is worse than no diagnosis.
 */
export function checkReceivedBundle(intent, receives, state) {
    const intentHash = hashIntent(intent);
    return checkPredicate(intentHash, intent, { intentHash, receives, netPayment: 0n }, state);
}
function checkPredicate(intentHash, intent, leg, state) {
    if (leg.receives.length !== intent.exactCount) {
        return {
            check: 'V5',
            error: 'CountMismatch',
            details: { intentHash, expected: intent.exactCount, actual: leg.receives.length },
        };
    }
    if (intent.exactCount === 0)
        return null;
    let firstSessionId;
    let firstSectionId;
    for (let j = 0; j < leg.receives.length; j++) {
        const meta = state.ticketMeta.get(leg.receives[j]);
        if (!meta) {
            return {
                check: 'V5',
                error: 'TicketMetaMissing',
                details: { tokenId: leg.receives[j].toString() },
            };
        }
        if (meta.eventId !== intent.eventId) {
            return {
                check: 'V5',
                error: 'WrongEvent',
                details: { tokenId: leg.receives[j].toString() },
            };
        }
        if ((intent.sessionMask & (1n << BigInt(meta.sessionId))) === 0n) {
            return {
                check: 'V5',
                error: 'SessionNotAccepted',
                details: { intentHash, sessionId: meta.sessionId },
            };
        }
        if ((intent.sectionMask & (1n << BigInt(meta.sectionId))) === 0n) {
            return {
                check: 'V5',
                error: 'SectionNotAccepted',
                details: { intentHash, sectionId: meta.sectionId },
            };
        }
        if (j === 0) {
            firstSessionId = meta.sessionId;
            firstSectionId = meta.sectionId;
        }
        if (intent.mustShareSession && meta.sessionId !== firstSessionId) {
            return { check: 'V5', error: 'NotSameSession', details: { intentHash } };
        }
        if (intent.mustShareSection && meta.sectionId !== firstSectionId) {
            return { check: 'V5', error: 'NotSameSection', details: { intentHash } };
        }
    }
    if (intent.mustBeAdjacent) {
        const err = checkAdjacency(intentHash, leg, state);
        if (err)
            return err;
    }
    return null;
}
function checkAdjacency(intentHash, leg, state) {
    const metas = [];
    for (const tokenId of leg.receives) {
        const meta = state.ticketMeta.get(tokenId);
        if (!meta) {
            return {
                check: 'V5',
                error: 'TicketMetaMissing',
                details: { tokenId: tokenId.toString() },
            };
        }
        metas.push(meta);
    }
    const refSession = metas[0].sessionId;
    const refSection = metas[0].sectionId;
    const refRow = metas[0].row;
    for (let j = 1; j < metas.length; j++) {
        if (metas[j].sessionId !== refSession ||
            metas[j].sectionId !== refSection ||
            metas[j].row !== refRow) {
            return { check: 'V5', error: 'SeatsNotAdjacent', details: { intentHash } };
        }
    }
    const seats = metas.map((m) => m.seat).sort((a, b) => a - b);
    for (let j = 1; j < seats.length; j++) {
        if (seats[j] !== seats[j - 1] + 1) {
            return { check: 'V5', error: 'SeatsNotAdjacent', details: { intentHash } };
        }
    }
    return null;
}
//# sourceMappingURL=validate.js.map