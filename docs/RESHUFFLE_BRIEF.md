# RESHUFFLE — Project Brief

**Conditional exchange for tickets: only give up what you have when you actually get what you need.**

| | |
|---|---|
| Event | ETHOnline 2026 · **Sep 4–16** (verify on the event page before planning) |
| Category | DeFi / Marketplace |
| Pool | Start Fresh |
| Chain | Arc Testnet (single chain, no bridges) |
| Sponsors | Arc, The Graph |

---

## 1. What it does

You hold two Friday tickets. You want two Saturday tickets, seated together.

Today you must either sell first and hope to buy back, or buy first and hope to resell. Both leave you exposed. And if nobody wants exactly what you have while holding exactly what you want, no direct trade exists at all.

RESHUFFLE lets you post a condition instead of an order:

> *Take my two Friday tickets — but only if I simultaneously receive two Saturday tickets in the same section, and I pay no more than 30 USDC net.*

A solver finds a combination across many participants that satisfies everyone's stated conditions at once. The contract verifies it and executes atomically. If any condition fails, nothing moves.

Buyers and sellers participate in the same pool. A pure buyer can absorb one end of a chain; a pure seller can exit at the other. The mechanism is not restricted to closed swap cycles.

---

## 2. The problem

### 2.1 There is no common unit of account

An order book matches on a price axis. A Friday ticket and a Saturday ticket are not "one cheaper than the other" — they are different goods with different value to different people.

Without a shared numéraire, **bilateral matching does not exist**. A wants what C has, C wants what B has, B wants what A has. No two of them can trade. Every pairwise negotiation fails, and the trade that works involves all three.

This is the *double coincidence of wants* problem. Money exists to avoid it. Here we solve it directly instead.

### 2.2 The exposure problem

Sell first, and you may not get the replacement. Buy first, and you carry two sets. Both are risks the user did not want to take — they only ever wanted to *change* what they hold.

### 2.3 Why an order book does not solve it

| | Order book | RESHUFFLE |
|---|---|---|
| Matching axis | price, one-dimensional | directed graph, no axis |
| Parties | two | many, simultaneously |
| Rule | one global rule: price crosses | per-participant conditions, each different |
| Constraints | quantity, price | bundle cohesion, session, section, net budget |

A judge will ask whether this is CoW Protocol. It is not: CoW clears fungible tokens at a uniform price. Tickets are non-fungible and carry per-person bundle constraints — four seats must share a session and a section. **No uniform clearing price exists**, so what gets verified is not a price but each participant's own declared conditions.

---

## 3. What must be true for this to work

Three properties, each of which drives a design decision.

| Property | Design consequence |
|---|---|
| Nobody ends up half-traded | Single atomic transaction — free in the EVM, so **not** claimed as the contribution |
| The solver cannot cheat you | Conditions are committed on-chain; the contract validates the proposal against *your* signature, not the solver's word |
| Nobody has to be online at the same time | Users sign **once**, in advance. Execution is asynchronous |

The third is the one that decides whether the system works in reality. A four-party trade requiring four live confirmations inside a validity window will fail constantly — not from lack of liquidity, but from lack of simultaneity. Pre-commitment removes that failure mode entirely.

---

## 4. Technical work

### 4.1 Contracts (Arc Testnet)

**TicketNFT** — ERC-721 with session, section and row/seat as packed metadata. Redemption marks a ticket permanently ineligible for exchange. Only issuer contracts registered by the deployer can mint.

**Escrow** — holds tickets while an intent is live. Withdrawal is unconditional and immediate; there is no lock-up. This is what makes the grief surface bounded rather than open-ended.

**IntentRegistry** — stores signed conditions:

```solidity
struct Intent {
    address owner;
    uint256[] offered;        // ticket ids, already escrowed
    uint16   sessionMask;     // acceptable sessions, bitmap
    uint16   sectionMask;     // acceptable sections, bitmap
    uint8    minCount;        // how many tickets must be received
    bool     mustShareSession;// the group cannot be split
    int256   maxNetPay;       // positive: max paid. negative: min received
    uint64   deadline;
    uint256  nonce;
}
```

EIP-712 signed. Bitmaps rather than arrays so validation is a mask-and rather than a loop.

**Settlement** — the core. Given a proposed reshuffle, verify:

```
a  conservation      every escrowed ticket is given exactly once, received exactly once
b  per-participant   each recipient's bundle satisfies their own masks, count, cohesion
c  payment balance   sum of debits equals sum of credits
d  per-participant   each net amount is within that participant's signed budget
e  freshness         tickets still escrowed, not redeemed; intents unexpired, unrevoked
```

Only if all five hold does it transfer tickets and settle USDC in one transaction.

**Note on `maxNetPay`:** signed integer, so a single field expresses both "I will pay at most X" and "I must receive at least Y". Positive is a debit ceiling, negative is a credit floor.

### 4.2 Solver (backend — Arc requires a working backend)

Reads the live intent pool from the subgraph, searches for a satisfying reshuffle, simulates it, and submits.

This is a combinatorial exchange and it is **NP-hard**. At demo scale (under ~20 participants) exhaustive search or an ILP solver is fine. State the limit plainly in the README: the search is bounded, and *no solution found* does not prove *no solution exists*.

### 4.3 Subgraph (The Graph)

Indexes intent creation, revocation, escrow deposits and withdrawals, and settlements.

**Why this is structural rather than decorative:** intents live in a Solidity mapping, and mappings cannot be enumerated on-chain. A contract cannot see the pool. Reconstructing it from events is the only way a solver can find anything at all. Remove the subgraph and no proposal can ever be generated.

The boundary, stated in the README so nobody has to ask: the subgraph is discovery. Chain state at execution is the authority — the contract re-validates everything, so a stale recommendation cannot cause a bad settlement.

### 4.4 Agent

Converts natural language into structured conditions the user confirms, queries live indexed data, calls the solver, and explains outcomes:

> "Two options: Saturday at 45 USDC, Sunday at 20. The Saturday seats are not adjacent, so it is excluded."

The agent interprets and explains. It does not decide legality and cannot widen a budget — the solver proposes and the contract verifies.

### 4.5 Frontend

Three roles — swapper, buyer, seller. Single-operator mode: one person can switch roles, change conditions and reproduce every scenario. Asynchronous judging means nobody will be available to co-star in a three-person live demo.

---

## 5. Hard problems, ranked

| # | Problem | Approach | Residual risk |
|---|---|---|---|
| 1 | Simultaneity | Pre-commitment: sign once, execute asynchronously | None — this removes the failure mode |
| 2 | On-chain condition validation | Bitmaps, packed metadata, single pass | Gas. Measure it; roughly 300–500k for 8 participants, cheap on Arc |
| 3 | Solver complexity | Bounded search at demo scale | NP-hard, does not scale. Say so |
| 4 | Escrow grief | `eth_call` simulate, then propose and execute in one transaction | Failed simulation costs nothing |
| 5 | Double-listing a ticket | Escrow ownership plus freshness check at execution | Other candidate solutions invalidate; re-solve |
| 6 | USDC approvals | Approve to the signed ceiling at commit time | Otherwise it fails at execution instead of at commit |
| 7 | Issuer trust | Registry of recognised issuer contracts | **Centralised. Unsolvable at this scale.** Scope to small events |
| 8 | Strategic misreporting | — | **Mathematically unsolvable.** Myerson–Satterthwaite rules out efficiency, budget balance, individual rationality and incentive compatibility together; bundles make it worse |
| 9 | Cold start | Enter through one existing event with a real ticket-holder base; allow buyers and sellers so a chain does not require a closed cycle | **Cannot be solved technically.** Cycles need density |

Items 7, 8 and 9 go in the README as limitations. Naming a constraint that is provably unsolvable is stronger than being caught not knowing it.

---

## 6. Protocols

### Arc — settlement

Circle's EVM-compatible L1. USDC is the native gas token, so a user does not need a separate asset to transact.

It carries tickets, escrow, conditions and USDC net settlement on one chain. **No bridges.** Splitting payment and assets across chains would make "all of it or none of it" far harder to guarantee, for no benefit.

Its prize language — *conditional payments, onchain automation, multi-step settlement* — describes this settlement path directly.

### The Graph — discovery

AI Tooling / Use Case, From Scratch. Live provider data must feed reasoning, decisions or automation; raw queries and visualisation do not qualify. The solver and agent consume indexed data to produce proposals.

Requires real Subgraph Studio deployment queried with an API key. Mocked or local-only data is disqualified, which means **the contracts must be deployed with real transactions before the subgraph has anything to index.**

### Deliberately excluded

| Protocol | Why not |
|---|---|
| Privy | Removing it changes nothing — users connect a wallet instead. Its prize also demands a specific control (policies, signers, key quorums, intents); embedded wallets alone do not qualify |
| ENS | An allowlist does the same job. An ENS name does not prove someone is an event organiser |
| World | Selfie Check is explicitly a low-assurance signal. It cannot stop scalping — a scalper is a person, not a bot, and raising the bar makes verified accounts more valuable |
| Hedera | A paid solver service introduces front-running: copy the proposal from the mempool, outbid on gas |
| Uniswap | Only relevant if payers hold mixed tokens. Turns a matching problem into treasury management |

Two load-bearing sponsors beat three where one is decoration.

---

## 7. Prizes

### Primary — Arc: Launch on Arc Testnet & Push to Mainnet

$3,500 · 1st $2,500 · 2nd $1,000 · **two places**

Its own example list includes *stablecoin settlement or escrow logic added to a DeFi protocol or marketplace*. That is exactly what this is.

**The timing matters and is worth understanding.** Arc's public mainnet launches **September 16** — the last day of the hackathon. Before that it is private mainnet with roughly a hundred institutional builders. **No team can deploy to mainnet during the event**, which is why the requirement reads *deployed **or deployment-ready** by September 30*.

The real competition is therefore among teams willing to return after the hackathon ends to deploy on a brand-new chain. Most teams do not come back.

**One question must be answered before committing to this prize.** Ask in the Arc Discord channel:

> Arc public mainnet launches September 16, the same day ETHOnline ends, so no one can deploy during the event. For the "Push to Mainnet" prize, what counts as "deployment-ready"? Is a verified testnet deployment with deployment scripts and documentation sufficient, or will judging weight actual mainnet deployment before September 30?

If scripts and documentation suffice, this is the best-odds prize available. If actual deployment is weighted, decide now whether to return before September 30 — the work is an afternoon, since Arc is EVM-compatible and only the RPC changes.

Asking also puts the project name in front of the Arc team before they judge.

### Secondary — The Graph: AI Tooling or Use Case, From Scratch

$5,000 · three places

Only if the agent layer is actually built. A subgraph with a query interface does not qualify for this track.

### Not targeting

**Arc — Best DeFi/Onchain Finance** ($1,667, single winner). Its list is lending, borrowing, swaps, liquidity, FX, yield. This project is a marketplace whose only financial primitive is net settlement. Worse, its central argument is *there is no common unit of account, so this is not a swap* — submitting to a DeFi track requires describing it as something the pitch explicitly denies.

**Arc — Best Agentic Economy** ($1,667). Requires agents holding wallets and spending autonomously via Circle Agent Stack. Here the agent reasons and explains; the user signs and the user's money moves. Not an agentic economy.

Two precise hits beat four partial ones. Every extra track needs its own justification section in the submission, and judges can tell which ones were retrofitted.

---

## 8. Build order

| # | Work | Cut? |
|---|---|---|
| 1 | TicketNFT, Escrow, Settlement | Never |
| 2 | Intent encoding and on-chain validation | Never |
| 3 | Solver | Never |
| 4 | Three-scene frontend | Never |
| 5 | Arc Testnet deployment with real transactions | Never — everything downstream depends on it |
| 6 | Subgraph | Cutting it drops The Graph |
| 7 | Agent | Cutting it drops The Graph's AI track |
| 8 | Redemption UI | Cut first |

Minimum viable submission is 1–5, targeting Arc alone. That version is complete and competitive.

---

## 9. Demo

Three scenes. The third is the one that earns trust.

**Scene 1 — the cycle.** No participant has a direct counterparty. The solver finds a three-way reshuffle; six tickets move in one transaction.

**Scene 2 — the chain breaks.** One participant now wants cash only, so the cycle no longer exists. A registered buyer absorbs that end and a pure seller exits at the other. The trade still completes. This answers *"did you just hardcode three families?"* and *"what if there is no cycle?"*

**Scene 3 — refusal.** The buyer withdraws, or someone lowers their budget below what is feasible. **Nothing executes. Everyone keeps their tickets.** The interface names the condition that failed.

A system that only ever shows success has proven nothing about the thing that matters — that it will not trade when the conditions do not hold.

Every displayed figure must trace to chain state or be deterministically derived from it. Derived values are fine; a hardcoded one invalidates the demo the moment a judge asks what happened on-chain.

### Required deliverables

Arc: working frontend **and** backend, architecture diagram, video demonstration explaining the use of Circle's tooling, repository link, and a clear statement of which bounty is being submitted for.

Video is 2–4 minutes, enforced on upload.

---

## 10. What is not claimed

- **Not a solution to cold start.** Cycles require density. Buyers and sellers reduce the dependency; they do not remove it.
- **Not usable with external tickets.** Uploading a Ticketmaster PDF and minting an NFT does not transfer real ownership. Only recognised issuer contracts.
- **Not strategy-proof.** Conditions are self-reported. With bundles and payments, no mechanism can be.
- **Not globally optimal.** Search is bounded. *No solution found* is not *no solution exists*.
- **Not audited.** If deployed to mainnet, state plainly that it is a demonstration and that real assets should not be deposited.
- **Atomicity is not the innovation.** A single transaction reverting wholesale is EVM default behaviour. The contribution is verifying that a reshuffle satisfies every participant's own signed conditions before it executes.
