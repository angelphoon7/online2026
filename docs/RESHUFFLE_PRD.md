# RESHUFFLE — Product Requirements

**A market for outcomes, not listings.**

| | |
|---|---|
| Version | 1.0 |
| Date | 8 September 2026 |
| Event | ETHOnline 2026 — **verify the submission deadline on the event page before planning; sources conflict between 13 and 16 September** |
| Chain | Arc Testnet, single chain, no bridges |
| Sponsors | Arc, The Graph |

---

## 1. The pitch

> **Never sell your old tickets and hope. Trade only when your whole replacement is guaranteed.**

Every marketplace makes you sell what you have, then buy what you want. The risk in between is yours. Sell first and the replacement may be gone. Buy first and you carry two sets.

RESHUFFLE lets you sign the outcome you would accept:

> *Take my two Friday tickets — but only if I simultaneously receive exactly two Saturday tickets, same section, adjacent seats, and I pay no more than 30 USDC net.*

The market composes many such intents. Nothing moves until an entire outcome exists that satisfies every participant's own signed conditions.

---

## 2. Users and jobs

| User | Job | Today's failure |
|---|---|---|
| **Swapper** | Change dates without splitting the group | Must sell first, then compete for replacements |
| **Buyer** | Acquire tickets | Nothing broken — but their presence lets others' chains close |
| **Seller** | Exit | Nothing broken — same |
| **Solver** | Find satisfying combinations, earn nothing in v1 | — |
| **Issuer** | Issue tickets, honour transfers, admit holders | — |

Buyers and sellers are not decoration. Without them the mechanism needs a closed cycle, which is far rarer. With them, a chain can terminate in cash at either end.

---

## 3. What the product guarantees

Only these. Anything not on this list must not appear in the interface either.

| # | Guarantee |
|---|---|
| G1 | A user's tickets leave only in a settlement satisfying every condition they signed |
| G2 | No partial execution — the whole reshuffle happens or none of it |
| G3 | After signing, the user need not be online when settlement occurs |
| G4 | The solver cannot make a user accept anything outside their signed conditions; the contract validates independently |
| G5 | Users may withdraw tickets or revoke intents at any time before settlement |
| G6 | A ticket received through RESHUFFLE can be redeemed by its new holder; the previous holder cannot |

**G3 has a boundary that must be stated exactly:** the user need not be online, but settlement still requires their intent, tickets and payment capacity to remain valid. ERC-20 approval is a spending allowance, not a reservation. A user who withdraws tickets or spends their balance breaks the plan, and the transaction fails — nobody is harmed, but nothing is guaranteed to succeed.

## 3.1 What is explicitly not guaranteed

| Not guaranteed | Why |
|---|---|
| That a solution will be found | Requires compatible demand |
| That the chosen solution is optimal or cheapest | Selection follows a published deterministic rule (§6), not an optimality proof |
| Strategy-proofness | Conditions are self-reported. This implementation makes no incentive-compatibility claim |
| Any external ticket | Only recognised issuer contracts. Minting an NFT from a PDF transfers nothing |
| That settlement is free | Gas is real, and a failed simulation still cost compute |

---

## 4. Conditions a user can express

**This list is the contract's validation surface. The UI must not offer anything outside it.** A promise the chain cannot check is a promise the product does not make.

| Condition | Example |
|---|---|
| Event scope | this festival only |
| Acceptable sessions | Saturday or Sunday |
| Acceptable sections | Floor or Tier 1 |
| Exact count received | exactly 2 |
| Group cohesion — session | all received tickets share one session |
| Group cohesion — section | all received tickets share one section |
| Seat adjacency | consecutive seats in one row |
| Net budget | pay at most 30 USDC, **or** receive at least 20 USDC |
| Expiry | valid until Friday 18:00 |

**Adjacency is only verifiable because we issue the tickets** and guarantee seat numbers are consecutive integers within a row. State this in the README; it does not generalise to arbitrary venues.

**Not expressible in v1:** ordinal preferences ("prefer Saturday but Sunday is fine if cheaper"), soft trade-offs, anything requiring the contract to rank rather than check.

---

## 5. Flow

```
1  Deposit tickets into escrow            withdrawable at any time
2  Sign an intent                         EIP-712, one signature, then leave
3  Intents are indexed                    the pool becomes visible
4  A solver finds a satisfying reshuffle  anyone may propose
5  Simulate                               eth_call, free
6  Submit                                 propose and execute in one transaction
7  Contract validates independently       every signed condition, for every party
8  Atomic settlement                      tickets move, USDC nets out
9  Redeem                                 new holder can, previous holder cannot
```

Steps 5 and 6 are one transaction with no window between them. A user who withdraws in the meantime causes the transaction to fail; the proposer loses gas, which is why simulation comes first.

---

## 6. Which valid solution gets chosen

Several reshuffles may satisfy everyone. The contract accepts any of them — it checks conditions, it does not rank.

**Selection is therefore the solver's, and the rule must be published:**

> Among all valid reshuffles found within the search budget, choose the one minimising total net payment. Ties break toward fewer participants, then lowest gas.

The interface must distinguish three numbers that are easy to conflate:

```
Your limit            30 USDC     what you signed
Actual payment        15 USDC     what this solution costs you
Why this one          lowest total net payment among 4 candidates
```

Never label a result "optimal" or "best price". The search is bounded; a better solution may exist outside it.

---

## 7. Demo

Three scenes, two embedded proofs.

**Scene 1 — the cycle.** Three families. No two can trade. A three-way reshuffle moves six tickets in one transaction.

**Scene 2 — the chain breaks.** One family now wants cash only, so no cycle exists. A registered buyer takes one end, a pure seller exits the other. The trade completes anyway.

*Answers: "did you hardcode three families?" and "what if there's no cycle?"*

**Scene 3 — refusal.** Lower a budget below feasibility, or revoke an intent. Nothing executes. Everyone keeps their tickets. The interface names the failing condition.

**Embedded proof A — the user is offline.** Sign, close the tab, settlement still happens. This is what pre-commitment buys.

**Embedded proof B — a malicious proposal.** Submit a reshuffle that is over budget or has non-adjacent seats. The contract rejects it. This proves the guarantee does not rest on trusting our solver.

**Agent scene (if The Graph is targeted).** Change a budget from 30 to 15. The agent re-queries live indexed data, the previous solution is excluded, and it reports a different answer or none. Static JSON narrated by an LLM does not qualify.

**Every displayed number must trace to chain state or be deterministically derived from it.** `overcommitPrevented = requested — available` is fine. A hardcoded `remaining = 6` invalidates the demo the moment a judge asks what happened on-chain.

Preloaded initial data is acceptable — ArcBook's demo used preloaded maker positions. **Preloaded outcomes are not.** A judge must be able to change a budget or revoke a ticket and see the system respond correctly.

---

## 8. Prizes

| Prize | Match |
|---|---|
| **Arc — Best DeFi/Onchain Finance** ($1,667) | Its scope covers payments and fintech infrastructure, and names conditional payments and multi-step settlement. Frame as *conditional delivery and multi-party net settlement for non-fungible entitlements*. Do not argue about whether NFTs count as swaps |
| **The Graph — AI Use Case, From Scratch** ($2,500 / $1,500 / $1,000) | Live indexed data must drive reasoning or decisions. The budget-change scene is the evidence. **Only submit if the agent exists** |
| **Arc — Launch on Testnet & Push to Mainnet** ($2,500 / $1,000) | Conditional. Its own examples include adding stablecoin settlement or escrow to a marketplace. But mainnet readiness is a separate bar, and Arc's public mainnet opens 16 September. **Ask what "deployment-ready" means before committing** |

Arc's multiple categories occupy one sponsor slot. Being eligible for two categories does not mean winning two.

**Not targeting: Best Agentic Economy.** It requires agents holding wallets and spending autonomously. Here the agent reasons and explains; the user signs and the user's money moves.

---

## 9. Scope

**In:** one issuer, one event, several sessions, one chain, USDC only, complete bundles, buy/sell/swap intents, bounded participant count, minimal redemption.

**Out:** cross-chain, external ticketing integrations, platform buy-back, insurance, solver fees, fiat, ordinal preferences, unbounded reshuffle size.

---

## 10. Honest limitations

State these in the README. Naming a constraint you cannot solve is stronger than being caught not knowing it.

- **Cold start.** Reshuffles need density of compatible intent. Buyers and sellers reduce the dependency but do not remove it. A constructed successful cycle is not evidence that real markets have sufficient demand.
- **Issuer trust is centralised.** Only registered issuer contracts are recognised; their permissions are published.
- **No incentive compatibility claim.** Users may misreport conditions.
- **Bounded search.** *No solution found* does not mean *no solution exists*.
- **Unaudited.** Demonstration only. Do not deposit real assets.
- **Atomicity is not the contribution.** A single transaction reverting wholesale is EVM default behaviour. The contribution is verifying that a reshuffle satisfies every participant's own signed conditions before it executes.
- **The Graph is not the only possible discovery mechanism.** Mappings cannot be enumerated on-chain, but RPC logs could be indexed by other means. This implementation relies on The Graph to reconstruct the live intent pool.
