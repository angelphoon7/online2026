import { search, DEFAULT_CONFIG } from './search.js';
import { rankCandidates } from './rank.js';
import { buildEvidence } from './evidence.js';
import { INTENT_STATE } from './types.js';
import { hashIntent } from './hash.js';
export function solve(allIntents, state, config = DEFAULT_CONFIG) {
    const liveIntents = allIntents.filter((intent) => {
        const h = hashIntent(intent);
        const s = state.intentState.get(h);
        if (s !== INTENT_STATE.LIVE)
            return false;
        if (state.blockTimestamp > intent.deadline)
            return false;
        return true;
    });
    const { candidates, excluded, termination } = search(liveIntents, state, config);
    const ranked = rankCandidates(candidates);
    const chosen = ranked.length > 0 ? ranked[0] : null;
    const evidence = buildEvidence(liveIntents.length, candidates, excluded, chosen);
    evidence.search = { termination };
    return {
        candidates: ranked,
        chosen: chosen
            ? { intents: chosen.intents, legs: chosen.legs }
            : null,
        evidence,
    };
}
//# sourceMappingURL=solve.js.map