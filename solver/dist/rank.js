/**
 * Among valid reshuffles found within the search budget, minimise gross cash
 * moved — sum of max(netPayment, 0) over all legs. Ties break toward fewer
 * participants, then the lexicographically smallest ordered set of intent hashes.
 */
export function rankCandidates(candidates) {
    return [...candidates].sort((a, b) => {
        if (a.gross < b.gross)
            return -1;
        if (a.gross > b.gross)
            return 1;
        if (a.participantCount < b.participantCount)
            return -1;
        if (a.participantCount > b.participantCount)
            return 1;
        const aHashes = [...a.intentHashSet].sort();
        const bHashes = [...b.intentHashSet].sort();
        const len = Math.min(aHashes.length, bHashes.length);
        for (let i = 0; i < len; i++) {
            if (aHashes[i] < bHashes[i])
                return -1;
            if (aHashes[i] > bHashes[i])
                return 1;
        }
        return aHashes.length - bHashes.length;
    });
}
//# sourceMappingURL=rank.js.map