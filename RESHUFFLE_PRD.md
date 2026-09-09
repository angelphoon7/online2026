# RESHUFFLE — Product Requirements

**A market for outcomes, not listings.**

| | |
|---|---|
| Version | 1.0 |
| Date | 8 September 2026 |
| Event | ETHOnline 2026 — submission deadline **Sunday 13 September, 12:00 EDT**. The 16th is the event close and Arc's public mainnet launch, not the submission cutoff |
| Chain | Arc Testnet, single chain, no bridges |
| Sponsors | Arc, The Graph |

---

## 1. The pitch

> **Never sell your old tickets and hope. Trade only when your whole replacement is guaranteed.**

Official exchange exists, but typically only within narrow bounds — same event, same venue, same date, replacement priced at or above the original. When the replacement you need falls outside those bounds, resale markets reduce the problem to two independent actions: sell what you have, then buy what you want. The risk in between is yours. Sell first and the replacement may be gone. Buy first and you carry two sets.

RESHUFFLE lets you sign the outcome you would accept:

> *Take my two Friday tickets — but only if I simultaneously receive exactly two Saturday tickets, same section, adjacent seats, and I pay no more than 30 USDC net.*

The market composes many such intents. Nothing moves until an entire outcome exists that satisfies every participant's own signed conditions.

### Outcome authorisation, not proposal authorisation

This is the distinction that separates RESHUFFLE from prior multi-party barter.

| | Proposal authorisation | Outcome authorisation |
|---|---|---|
| What the user sees | a concrete proposed trade | nothing — they already left |
| What they approve | *this* trade | *any* trade inside these bounds |
| Signatures | one per proposed settlement, from every participant | one per intent; settlements inside it need none |
| Coordination | every participant must return and approve before it can execute | no post-match coordination at all |

Existing systems ask *"here is the trade, do you approve it?"* RESHUFFLE says *"here are the boundaries; any future trade inside them is already approved."*

Two precisions, because both are easy to overstate:

**Not "everyone online at once."** Prior systems can notify participants and collect approvals over time. The cost is not simultaneity — it is that a discovered proposal is dead until every participant returns to approve *that specific proposal*. RESHUFFLE removes the post-match round trip, not the need for people to be awake.

**Not "one signature ever."** A user signs again when an intent expires, is revoked, or is changed. The claim is one signature *per intent*, not one per proposed settlement.

**And predicates are not new.** Seaport criteria orders already let a signed order name any asset matching a condition rather than a specific token, `matchOrders` settles any number of orders together, and zones allow custom validation around fulfilment. Seaport is a general settlement engine and this is not beyond it.

What differs is the subject of the condition and what is first-class. A criteria order constrains *which asset may fill one side of my order*. An intent here constrains *the outcome of this settlement for me* — the bundle I must receive, its internal relationships, and the maximum cash I will part with. Relational bundle constraints and per-participant cash bounds are the primitives here, not something a caller assembles.

> You don't sign the asset you want. You sign the post-settlement state you're willing to accept.

Everything in §3 and §4 follows from that. The user is not present when their tickets move, so every condition they care about has to be enforceable without them.

---

## 2. Users and jobs

| User | Job | Today's failure |
|---|---|---|
| **Swapper** | Change dates without splitting the group | Must sell first, then compete for replacements |
| **Buyer** | Acquire tickets | Nothing broken — but their presence lets others' chains close |
| **Seller** | Exit | Nothing broken — same |
| **Issuer** | Issue tickets, **and stand in the pool with unsold inventory** | Official exchange is typically processed as one customer against inventory, so a returned ticket waits on a shelf |
| **Solver** | Find satisfying combinations, earn nothing in v1 | — |

Buyers and sellers are not decoration. Without them the mechanism needs a closed cycle, which is far rarer. With them, a chain can terminate in cash at either end.

**The issuer is a participant, not an operator.** Unsold inventory enters the same pool under the same rules — an intent offering tickets and accepting returns within a policy.

Standard official exchange is typically processed as an individual customer-versus-inventory replacement, so a returned ticket goes back on a shelf and waits. Here issuer inventory participates inside the same multi-party clearing: it **injects an asset into the graph**, which lets user inventory that had no counterparty flow directly to another participant in the same settlement.

Concretely, and consistent with V4 conservation — every ticket is received exactly once:

```
Venue's Saturday  →  A
A's Friday        →  C          (directly; it does not route through the venue)
C's Sunday        →  B
B's ticket / cash →  Venue      (per the venue's own predicate)
```

The venue's ticket is what makes the chain possible; the returned ticket does not pass through it. A design where A's ticket went to the venue *and* to C would be rejected by V4 as a double receive.

This materially reduces how much user-to-user coincidence a reshuffle needs. It does not remove the dependency; see §10.

---

## 3. What the product guarantees

Only these. Anything not on this list must not appear in the interface either.

| # | Guarantee |
|---|---|
| G1 | A user's tickets leave only in a settlement satisfying every condition they signed |
| G2 | No partial execution — the whole reshuffle happens or none of it |
| G3 | After signing, the user need not be online when settlement occurs |
| G4 | The solver cannot make a user accept anything outside their signed conditions. The signature is verified once at commit; settlement rebinds the supplied conditions to that authenticated hash and validates against them |
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

**There is no platform price for a ticket.** A Friday floor seat is worth 300 to someone with an exam that evening and 800 to someone for whom it is the only date they can attend. The system never computes what a ticket is "worth" and never publishes a valuation; each participant states only their own reservation constraint — the most they will pay, or the least they will accept. A settlement is valid when every participant's own constraint holds, not when the transfers match some assessed value.
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

Steps 5 and 6 are immediately consecutive, but they are separate calls and simulation does not lock state. A user who withdraws in between causes the real transaction to revert — cleanly, with nothing half-moved, because Settlement revalidates everything at execution. The proposer loses gas, which is why simulation runs first.

---

## 6. Which valid solution gets chosen

Several reshuffles may satisfy everyone. The contract accepts any of them — it checks conditions, it does not rank.

**Selection is therefore the solver's, and the rule must be published:**

> Among all valid reshuffles found within the search budget, choose the one minimising **gross cash moved** — `sum of max(netPayment, 0)` across all legs. Ties break toward fewer participants, then toward the lexicographically smallest ordered set of intent hashes.

The final tie-break is a hash comparison rather than gas, so ranking is fully deterministic from the inputs alone. Gas is measured and reported, but never used to choose between candidates — estimation is unreliable on Arc and would make the same inputs produce different outputs.

**Gross, not net.** Every valid settlement has `sum(netPayment) == 0` by V7, so ranking on net total would score every candidate identically. Gross cash moved is the total USDC that actually has to change hands among participants, and minimising it is a defensible default. It is not a claim about value: the system assigns no valuation to any ticket, so no statement about *value difference* is available to it.

The interface must distinguish three numbers that are easy to conflate:

```
Your limit            30 USDC     what you signed
Actual payment        15 USDC     what this solution costs you
Why this one          least cash moved among 4 candidates
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

**Every displayed number must trace to chain state or be deterministically derived from it.** `overcommitPrevented = requested − available` is fine. A hardcoded `remaining = 6` invalidates the demo the moment a judge asks what happened on-chain.

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

- **Cold start.** Reshuffles need density of compatible intent. Buyers, sellers and issuer inventory reduce the dependency; they do not remove it. When a session is genuinely sold out and the issuer holds nothing, no protocol creates a seat. A constructed successful cycle is not evidence that a real market has sufficient demand.
- **The mechanism is not new; the execution model is.** Top Trading Cycles dates to 1974, kidney exchange is its best-known application, a 2026 Imperial paper studies ticket reallocation including price differences between dates, and NeoSwap shipped multi-party NFT barter with budgets in 2022. What is not prior art is the combination: persistent signed outcome predicates, clearing without re-approval, issuer inventory as a standing participant, and net cash settlement over non-fungible bundles. Cite the prior work; do not claim novelty it does not have.
- **Issuer trust is centralised.** Only registered issuer contracts are recognised; their permissions are published.
- **No incentive compatibility claim.** Users may misreport conditions.
- **Bounded search.** *No solution found* does not mean *no solution exists*.
- **Unaudited.** Demonstration only. Do not deposit real assets.
- **Atomicity is not the contribution.** A single transaction reverting wholesale is EVM default behaviour. The contribution is verifying that a reshuffle satisfies every participant's own signed conditions before it executes.
- **The Graph is not the only possible discovery mechanism.** Mappings cannot be enumerated on-chain, but RPC logs could be indexed by other means. This implementation relies on The Graph to reconstruct the live intent pool.
