# Demo

Three scenes, two embedded proofs, one agent scene. Under four minutes, enforced on upload.

Asynchronous judging means nobody is available to co-star. Everything must be operable by one
person switching roles, changing conditions and reproducing results.

## Scene 1 — the cycle

Three families. No two can trade: A wants what C holds, C wants what B holds, B wants what A
holds. Every pairwise negotiation fails.

The solver finds a three-way reshuffle. Six tickets move in one transaction.

## Scene 2 — the chain breaks

One family now wants cash only, so no cycle exists.

A registered buyer takes one end; a pure seller exits at the other. The trade completes anyway.

Answers two questions before they are asked: *did you hardcode three families?* and *what if
there is no cycle?*

## Scene 3 — refusal

Lower a budget below feasibility, or revoke an intent.

**Nothing executes. Everyone keeps their tickets.** The interface names the failing condition.

A system that only ever shows success has proven nothing about the property that matters —
that it will not trade when the conditions do not hold.

## Embedded proof A — the user is offline

Sign an intent, close the tab, and settlement still happens.

This is the entire value of pre-commitment. Without it the product needs everyone online
simultaneously inside a validity window, which fails constantly for reasons unrelated to
liquidity.

State the boundary honestly: the user need not be online, but settlement still requires their
intent, tickets and payment capacity to remain valid.

## Embedded proof B — a malicious proposal

Submit a reshuffle that is over budget, or has non-adjacent seats where adjacency was required.

**The contract rejects it, naming the condition.**

Scene 1 shows the system can do the thing. This shows why a user can sign and walk away —
the guarantee does not rest on trusting our solver, because a different solver could submit
anything.

`SeatsNotAdjacent` on screen is the proof that adjacency is enforced on-chain rather than
mentioned in the UI.

## Agent scene

Only if The Graph is targeted.

Change a budget from 30 to 15. The agent re-queries live indexed data, the previous candidate
is excluded, and it reports a different answer or none.

Show the evidence chain: which subgraph, which block, which intents, which candidates excluded
and why.

Static JSON narrated by an LLM does not qualify. The requirement is that live data drives the
decision, and the observable form of that is *the answer changes when the data changes*.

## Integrity

**Preloaded initial data is acceptable.** ArcBook's winning demo used preloaded maker
positions.

**Preloaded outcomes are not.** A judge must be able to change a budget or revoke an intent and
watch the system respond correctly. That is the difference between a demonstration and an
animation.

**Every displayed number traces to chain state or is deterministically derived from it.**
Derived values are fine — `overcommitPrevented = requested — available` is arithmetic on
chain-read numbers. A hardcoded `remaining = 6` invalidates the demo the moment someone asks
what happened on-chain.

## Structure

| Segment | Content |
|---|---|
| 0:00–0:20 | The problem in one sentence. No backstory |
| 0:20–1:10 | Scene 1, real transactions |
| 1:10–1:50 | Scene 2 |
| 1:50–2:20 | Scene 3 with embedded proof B |
| 2:20–2:40 | Embedded proof A |
| 2:40–3:10 | Agent scene, if built |
| 3:10–3:40 | Block explorer, redemption, the one-liner |

Keep the introduction under twenty seconds. Cut waiting time in the edit.

## Required deliverables

Arc wants a working frontend **and** backend, an architecture diagram, a video explaining the
use of Circle's tooling, a repository link, and an explicit statement of which bounty is being
submitted for.
