import { hashIntent } from './hash.js';
import { validateSettlement } from './validate.js';
export const DEFAULT_CONFIG = {
    maxParticipants: 8,
    maxCandidates: 1000,
    timeoutMs: 10_000,
};
export function search(intents, state, config = DEFAULT_CONFIG) {
    const candidates = [];
    const excluded = [];
    const startTime = Date.now();
    const maxSize = Math.min(intents.length, config.maxParticipants);
    // With mustInclude set, enumerate only subsets that contain that intent: hold it fixed and
    // combine the rest. Filtering after enumeration would still walk every subset of the pool,
    // which is what exhausts the time bound before the relevant ones are reached.
    const required = config.mustInclude
        ? intents.find((i) => hashIntent(i).toLowerCase() === config.mustInclude.toLowerCase())
        : undefined;
    if (config.mustInclude && !required) {
        return { candidates, excluded, termination: 'complete' };
    }
    const others = required ? intents.filter((i) => i !== required) : intents;
    const subsetsOfSize = (size) => required ? mapCombinations(others, size - 1, (rest) => [required, ...rest]) : combinations(intents, size);
    for (let size = 2; size <= maxSize; size++) {
        for (const subset of subsetsOfSize(size)) {
            if (Date.now() - startTime > config.timeoutMs)
                return { candidates, excluded, termination: 'timeout' };
            if (candidates.length >= config.maxCandidates)
                return { candidates, excluded, termination: 'candidate-limit' };
            const poolSize = subset.reduce((s, i) => s + i.offered.length, 0);
            const neededSize = subset.reduce((s, i) => s + i.exactCount, 0);
            if (poolSize !== neededSize) {
                excluded.push({ intentHashes: subset.map(hashIntent), reason: 'V4: Offered and received ticket counts differ' });
                continue;
            }
            const pool = subset.flatMap((i) => i.offered);
            const hashes = subset.map((i) => hashIntent(i));
            const paymentResult = computeMinGrossPayment(subset);
            if (!paymentResult) {
                excluded.push({ intentHashes: hashes, reason: 'No feasible payment distribution' });
                continue;
            }
            const assignments = findAssignments(subset, pool, state, 100, startTime + config.timeoutMs);
            if (assignments.length === 0) {
                if (Date.now() > startTime + config.timeoutMs)
                    return { candidates, excluded, termination: 'timeout' };
                excluded.push({
                    intentHashes: hashes,
                    reason: 'No valid ticket assignment satisfying all predicates',
                });
                continue;
            }
            for (const assignment of assignments) {
                if (candidates.length >= config.maxCandidates)
                    break;
                const { payments, gross } = paymentResult;
                const legs = subset.map((_, idx) => ({
                    intentHash: hashes[idx],
                    receives: assignment[idx],
                    netPayment: payments[idx],
                }));
                const validationError = validateSettlement(subset, legs, state);
                if (validationError) {
                    excluded.push({
                        intentHashes: hashes,
                        reason: `${validationError.check}: ${validationError.error}`,
                    });
                    continue;
                }
                candidates.push({
                    intents: subset,
                    legs,
                    gross,
                    participantCount: subset.length,
                    intentHashSet: hashes,
                });
            }
        }
    }
    return { candidates, excluded, termination: Date.now() > startTime + config.timeoutMs ? 'timeout' : candidates.length >= config.maxCandidates ? 'candidate-limit' : 'complete' };
}
export function computeMinGrossPayment(intents) {
    const n = intents.length;
    const payments = new Array(n);
    for (let i = 0; i < n; i++) {
        payments[i] = intents[i].maxNetPay < 0n ? intents[i].maxNetPay : 0n;
    }
    let sum = 0n;
    for (let i = 0; i < n; i++)
        sum += payments[i];
    if (sum === 0n) {
        const gross = payments.reduce((a, p) => a + (p > 0n ? p : 0n), 0n);
        return { payments, gross };
    }
    if (sum > 0n)
        return null;
    let remaining = -sum;
    for (let i = 0; i < n && remaining > 0n; i++) {
        if (intents[i].maxNetPay > 0n) {
            const contribution = remaining < intents[i].maxNetPay ? remaining : intents[i].maxNetPay;
            payments[i] = contribution;
            remaining -= contribution;
        }
    }
    if (remaining > 0n)
        return null;
    const gross = payments.reduce((a, p) => a + (p > 0n ? p : 0n), 0n);
    return { payments, gross };
}
export function findAssignments(subset, pool, state, limit, deadline = Number.POSITIVE_INFINITY) {
    const results = [];
    const used = new Set();
    const current = Array.from({ length: subset.length }, () => []);
    function backtrack(idx) {
        if (results.length >= limit || Date.now() > deadline)
            return;
        if (idx === subset.length) {
            if (used.size === pool.length) {
                results.push(current.map((a) => [...a]));
            }
            return;
        }
        const intent = subset[idx];
        if (intent.exactCount === 0) {
            current[idx] = [];
            backtrack(idx + 1);
            return;
        }
        const eligible = pool.filter((id) => {
            if (used.has(id))
                return false;
            const meta = state.ticketMeta.get(id);
            if (!meta)
                return false;
            if (meta.eventId !== intent.eventId)
                return false;
            if ((intent.sessionMask & (1n << BigInt(meta.sessionId))) === 0n)
                return false;
            if ((intent.sectionMask & (1n << BigInt(meta.sectionId))) === 0n)
                return false;
            return true;
        });
        for (const combo of combinations(eligible, intent.exactCount)) {
            if (results.length >= limit || Date.now() > deadline)
                return;
            if (intent.mustShareSession) {
                const sessions = new Set(combo.map((id) => state.ticketMeta.get(id).sessionId));
                if (sessions.size > 1)
                    continue;
            }
            if (intent.mustShareSection) {
                const sections = new Set(combo.map((id) => state.ticketMeta.get(id).sectionId));
                if (sections.size > 1)
                    continue;
            }
            if (intent.mustBeAdjacent) {
                if (!checkAdjacentTickets(combo, state))
                    continue;
            }
            current[idx] = combo;
            for (const id of combo)
                used.add(id);
            backtrack(idx + 1);
            for (const id of combo)
                used.delete(id);
        }
    }
    backtrack(0);
    return results;
}
function checkAdjacentTickets(tickets, state) {
    if (tickets.length < 2)
        return true;
    const metas = [];
    for (const id of tickets) {
        const meta = state.ticketMeta.get(id);
        if (!meta)
            return false;
        metas.push(meta);
    }
    const ref = metas[0];
    for (let i = 1; i < metas.length; i++) {
        if (metas[i].sessionId !== ref.sessionId ||
            metas[i].sectionId !== ref.sectionId ||
            metas[i].row !== ref.row) {
            return false;
        }
    }
    const seats = metas.map((m) => m.seat).sort((a, b) => a - b);
    for (let i = 1; i < seats.length; i++) {
        if (seats[i] !== seats[i - 1] + 1)
            return false;
    }
    return true;
}
function* mapCombinations(arr, k, wrap) {
    for (const combo of combinations(arr, k))
        yield wrap(combo);
}
export function* combinations(arr, k) {
    if (k === 0) {
        yield [];
        return;
    }
    if (k > arr.length)
        return;
    for (let i = 0; i <= arr.length - k; i++) {
        for (const rest of combinations(arr.slice(i + 1), k - 1)) {
            yield [arr[i], ...rest];
        }
    }
}
//# sourceMappingURL=search.js.map