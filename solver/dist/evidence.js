export function buildEvidence(intentsConsidered, candidates, excluded, chosen) {
    return {
        timestamp: new Date().toISOString(),
        intentsConsidered,
        candidatesFound: candidates.length,
        candidatesExcluded: excluded,
        chosen: chosen
            ? {
                intentHashes: chosen.intentHashSet,
                gross: chosen.gross.toString(),
                reason: describeChoice(chosen, candidates.length),
            }
            : null,
    };
}
function describeChoice(chosen, totalCandidates) {
    return (`Least cash moved among ${totalCandidates} candidate${totalCandidates === 1 ? '' : 's'} ` +
        `found within the search budget: ${chosen.gross.toString()} gross, ` +
        `${chosen.participantCount} participant${chosen.participantCount === 1 ? '' : 's'}`);
}
export function addSimulationResult(evidence, success, error) {
    return { ...evidence, simulationResult: { success, error } };
}
export function addTransactionHash(evidence, hash) {
    return { ...evidence, transactionHash: hash };
}
//# sourceMappingURL=evidence.js.map