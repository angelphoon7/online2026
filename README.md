# RESHUFFLE

**A market for outcomes, not listings.**

You never give up your tickets unless the whole replacement arrives.

<!-- Live demo: TBD · Video: TBD -->

---

## Contents

- [The problem](#the-problem)
- [The solution](#the-solution)
- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Component flows](#component-flows)
- [Sequence diagrams](#sequence-diagrams)
- [Sponsor tracks](#sponsor-tracks)
- [Questions we expect](#questions-we-expect)
- [Limitations](#limitations)
- [Repository](#repository)

---

## The problem

### The user's version

> I bought Sunday tickets as a backup because I didn't know if I'd get the date I wanted. Then I got Tuesday. Now I'm stuck with three Sunday tickets, resale isn't open, and social media is full of scammers.

That is a real 2026 post, and it is not rare. People buy backup tickets, get better ones, and are left holding the first set. Others need four seats together and end up buying extra tickets and reselling them just so a family can sit in one row.

The intent already exists — it is written in forum comments:

> *"HAVE: 4 Toronto, Sec 105. WANT: 4 Vancouver, together. Will pay difference."*

Users are already expressing conditional replacement in natural language. There is just no system that executes it.

### Why current systems can't help

Every marketplace splits the operation in two:

```
    SELL what you have          BUY what you want
           │                            │
           └──────────  ???  ───────────┘
                   the risk in
                   between is yours
```

Sell first and the replacement may be gone. Buy first and you carry two sets. Official exchange usually requires the same event, venue and date, so changing dates is not an exchange at all — it is a sale followed by a purchase.

### And sometimes no bilateral trade exists

```
  A holds Friday,   wants Saturday
  B holds Saturday, wants Sunday
  C holds Sunday,   wants Friday

  A ↔ B   ✗   B doesn't want Friday
  B ↔ C   ✗   C doesn't want Saturday
  C ↔ A   ✗   A doesn't want Sunday
```

No two people can trade. All three together can. Every pairwise negotiation fails, and the trade that works involves everyone at once.

### The four pains, separated

| # | Pain | Type |
|---|---|---|
| 1 | Replacement exposure — I want to *change*, not to speculate | user pain |
| 2 | No direct counterparty — nobody wants exactly what I hold | matching problem |
| 3 | Bundle constraints — not any two tickets, but a complete outcome | user pain |
| 4 | Coordination — four people cannot all be online at the same second | coordination problem |

Most systems address some of 1–3. Number 4 is what makes the others usable in reality.

---

## The solution

Users sign the **outcome** they will accept, not an order.

```
  ┌──────────────────────────────────────────────────────┐
  │  Take my two Friday tickets                          │
  │                                                      │
  │  ONLY IF I simultaneously receive                    │
  │      exactly 2 Saturday tickets                      │
  │      same section, adjacent seats                    │
  │      and I pay no more than 30 USDC net              │
  │                                                      │
  │  Valid until Friday 18:00                            │
  └──────────────────────────────────────────────────────┘
```

Sign once, then leave. A solver later composes many such intents — including buyers, sellers and unsold issuer inventory — into a reallocation where everyone's signed conditions hold at once. The contract verifies each condition independently and settles atomically.

**Ordinary marketplace:** *How much do you want for your ticket?*
**RESHUFFLE:** *What would have to be true for you to give it up?*

### The property that drives the architecture

```
  asynchronous execution
            ↓
  the user is not present at settlement
            ↓
  there is no final approval step
            ↓
  the solver is untrusted
            ↓
  the outcome predicate must be
  independently enforceable on-chain
```

This is why the contract checks session, section, count, cohesion, adjacency, budget, expiry and redemption status. Not to be thorough — because nobody is there to click *confirm*.

---

## How it works

```
 ┌─────────┐   deposit    ┌─────────┐   sign once   ┌──────────┐
 │  User   │─────────────▶│ Escrow  │──────────────▶│  Intent  │
 └─────────┘  withdrawable└─────────┘   then leave  │ Registry │
                any time                            └────┬─────┘
                                                         │ events
                                                         ▼
                                                  ┌─────────────┐
                                                  │  Subgraph   │
                                                  │ intent pool │
                                                  └──────┬──────┘
                                                         │ query
                                                         ▼
                                                  ┌─────────────┐
                                                  │   Solver    │
                                                  │   search    │
                                                  └──────┬──────┘
                                                         │ propose + execute
                                                         ▼
                                                  ┌─────────────┐
                                                  │ Settlement  │
                                                  │  V1 … V8    │
                                                  └──────┬──────┘
                                                         │ all pass
                                                         ▼
                                              tickets move · USDC nets
                                                new holder can redeem
```

### The issuer is a participant, not an operator

Unsold inventory joins the same graph. This is what stops a reshuffle from requiring a closed cycle:

```
   Venue inventory
         │  Saturday
         ▼
         A ──── Friday returned ────▶ C
                                     │  Sunday returned
                                     ▼
                                     B
```

One issuer ticket does not complete a single upgrade — it starts a chain. The returned Friday immediately satisfies the next person's predicate.

---

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  Frontend — swapper / buyer / seller, single-operator mode     │
└──────────────────────────┬────────────────────────────────────┘
                           │ one EIP-712 signature per intent
┌──────────────────────────▼────────────────────────────────────┐
│  Arc Testnet — EVM, USDC as native gas                        │
│                                                               │
│   TicketNFT        packed metadata, redemption                 │
│   Escrow           custody, unconditional withdrawal           │
│   IntentRegistry   signed conditions, revocation               │
│   Settlement       V1–V8 validation, atomic execution          │
└──────────────────────────┬────────────────────────────────────┘
                           │ events
┌──────────────────────────▼────────────────────────────────────┐
│  Subgraph — reconstructs the live intent pool                  │
└──────────────────────────┬────────────────────────────────────┘
                           │ GraphQL
┌──────────────────────────▼────────────────────────────────────┐
│  Solver + Agent — search, simulate, propose, explain           │
└───────────────────────────────────────────────────────────────┘
```

| Layer | Responsibility | Trusted? |
|---|---|---|
| Frontend | Collect conditions, obtain one signature | No |
| Solver | Find a satisfying combination | **No** — the contract re-checks everything |
| Subgraph | Discovery and prefiltering | **No** — chain state at execution is authoritative |
| Settlement | Verify every signed condition | Yes — this is the trust anchor |

---

## Component flows

### 1. Intent creation

```
   user describes what they want
              │
              ▼
   agent parses into structured conditions
              │
              ▼
   user reviews and confirms the conditions
              │
              ▼
   deposit tickets into escrow ─── withdrawable at any time
              │
              ▼
   sign EIP-712 intent   ← the only signature ever required
              │
              ▼
   commit on-chain, emit IntentCommitted
              │
              ▼
   user closes the tab
```

### 2. Discovery and solving

```
   fetch live intents from subgraph
              │
              ▼
   verify freshness against chain state ── the indexer lags
              │
              ▼
   search for valid reshuffles ── bounded: participants, candidates, timeout
              │
       ┌──────┴──────┐
       │             │
   none found     ≥1 found
       │             │
       ▼             ▼
   report        rank by published rule
   honestly      min total net payment,
                 ties → fewer participants
                     │
                     ▼
              eth_call simulate
                     │
              ┌──────┴──────┐
              │             │
           fails         passes
              │             │
              ▼             ▼
          re-solve    submit propose+execute
                      in one transaction
```

Simulation and submission are one transaction with no window between them. A participant withdrawing in the meantime causes a revert — the proposer loses gas, which is why simulation comes first.

### 3. Settlement validation

```
                  settle(intents, legs)
                          │
                          ▼
         V1  intent live, unexpired, signature valid?  ──✗──▶ IntentNotLive
                          │ ✓                                 IntentExpired
                          ▼
         V2  every offered ticket escrowed by owner?   ──✗──▶ TicketNotEscrowed
                          │ ✓
                          ▼
         V3  no ticket already redeemed?               ──✗──▶ TicketRedeemed
                          │ ✓
                          ▼
         V4  exact bijection offered ↔ received?       ──✗──▶ ConservationViolated
                          │ ✓
                          ▼
         V5  each bundle satisfies its own predicate?  ──✗──▶ SessionNotAccepted
             event · session · section · count                SectionNotAccepted
             cohesion · adjacency                             CountMismatch
                          │ ✓                                 NotSameSection
                          │                                   SeatsNotAdjacent
                          ▼
         V6  each net payment within signed budget?    ──✗──▶ BudgetExceeded
                          │ ✓
                          ▼
         V7  Σ netPayment == 0 exactly?                ──✗──▶ PaymentImbalance
                          │ ✓
                          ▼
         V8  every payer has balance and allowance?    ──✗──▶ InsufficientPaymentCapacity
                          │ ✓
                          ▼
              transfer tickets · settle USDC · mark settled · emit
```

Checks first, effects second, interactions last. Nothing transfers until all eight pass.

### 4. Redemption

```
   holder opens ticket
          │
          ▼
   contract checks current owner ── previous holder fails here
          │ ✓
          ▼
   redeem() sets status permanently
          │
          ▼
   ticket can never re-enter escrow or a reshuffle
```

A ticket sitting in escrow must be withdrawn first — revoke the intent, withdraw, then redeem.

---

## Sequence diagrams

### Happy path — a three-way reshuffle

```
 A     B     C   Frontend  Registry  Subgraph  Solver  Settlement  Escrow  USDC
 │     │     │      │         │         │        │         │         │      │
 ├─────┼─────┼─────▶│         │         │        │         │         │      │
 │  sign intent     ├────────▶│         │        │         │         │      │
 │     ├─────┼─────▶│         │         │        │         │         │      │
 │     │     ├─────▶│         ├────────▶│        │         │         │      │
 │     │     │      │      events       │        │         │         │      │
 │                                                                          │
 │  all three go offline                                                    │
 │                                                                          │
 │     │     │      │         │         ├───────▶│         │         │      │
 │     │     │      │         │   intent pool    │         │         │      │
 │     │     │      │         │         │  search│         │         │      │
 │     │     │      │         │         │        ├────────▶│         │      │
 │     │     │      │         │         │        │ eth_call simulate  │      │
 │     │     │      │         │         │        │◀────────┤ ok      │      │
 │     │     │      │         │         │        ├────────▶│         │      │
 │     │     │      │         │         │        │  settle │         │      │
 │     │     │      │         │◀─────────────────────────  ├ V1 V2 V3       │
 │     │     │      │         │  read intents    │         ├ V4 V5 V6 V7    │
 │     │     │      │         │         │        │         ├────────▶│      │
 │     │     │      │         │         │        │         │   V8    ├─────▶│
 │     │     │      │         │         │        │         │ tickets move   │
 │     │     │      │         │         │        │         ├───────────────▶│
 │     │     │      │         │         │        │         │   net USDC     │
 │◀────┼─────┼──────────────────── Settled ────────────────┤         │      │
 │     │◀────┼──────────────────── Settled ────────────────┤         │      │
 │     │     │◀───────────────────  Settled ───────────────┤         │      │
```

No participant signed anything after their initial intent.

### Rejection path — a malicious proposal

```
 Solver          Settlement                          Result
   │                  │
   ├─── settle() ────▶│
   │                  ├─ V1  intents live          ✓
   │                  ├─ V2  tickets escrowed      ✓
   │                  ├─ V3  none redeemed         ✓
   │                  ├─ V4  conservation holds    ✓
   │                  ├─ V5  A wanted adjacent,
   │                  │      proposal gives B14
   │                  │      and B27               ✗
   │◀── revert ───────┤
   │   SeatsNotAdjacent(0x7f3a…)
   │
   │  nothing moved · everyone keeps their tickets
```

The guarantee does not rest on trusting our solver. A different solver could submit anything; the contract still refuses.

### Issuer inventory unlocking a chain

```
 A            Venue        Solver     Settlement
 │              │            │            │
 ├─ wants Saturday; no user holds one     │
 │              │            │            │
 │              ├───────────▶│            │
 │              │  unsold Saturday in escrow
 │              │            │            │
 │              │            ├───────────▶│
 │              │            │   A     ← Saturday (venue)
 │              │            │   venue ← Friday (A)
 │              │            │   C     ← Friday (venue, same tx)
 │              │            │   B     ← Sunday (C)
 │              │            │            │
 │◀───────────────────── Settled ─────────┤
```

The returned Friday satisfies C in the same transaction that gave A a Saturday.

---

## Sponsor tracks

| Sponsor | Track | Why |
|---|---|---|
| **Arc** | Best DeFi / Onchain Finance | Conditional delivery and multi-party net settlement for non-fungible entitlements. Ticket delivery determines whether payment is permitted; multiple participants' debits and credits correspond within one settlement |
| **The Graph** | AI Use Case — From Scratch | Live indexed data drives the solver and the agent. Change a budget and the answer changes, because the pool is re-queried |
| **Arc** | Launch on Testnet & Push to Mainnet | *Conditional.* Its examples include stablecoin settlement and escrow logic added to a marketplace. Mainnet readiness is a separate bar — confirming what qualifies before committing |

### How Arc is load-bearing

```
   ticket conditions satisfied?
            │
            ├── no ──▶ no payment occurs at all
            │
            └── yes ─▶ USDC nets across all participants
                       A −50 · D −100 · B +120 · C +30 · Σ = 0
```

Money is not appended at the end. Delivery gates payment, and every participant's cash position resolves in the same settlement.

### How The Graph is load-bearing

Intents live in a Solidity mapping, and mappings cannot be enumerated on-chain. A contract cannot see the pool. Events are what make discovery possible.

More importantly, intents are **persistent**:

```
   Monday    intent signed          no solution
   Tuesday   venue releases 20      the same intent becomes
             tickets                satisfiable, with the user
                                    doing nothing
```

The market changes around a standing intent. That is what live indexed data is for.

*The subgraph is discovery and prefiltering. Chain state at execution is the source of truth — balances and allowances move, and an indexer lags.*

---

## Questions we expect

**Isn't this just a multi-party NFT swap?**
Multi-party barter exists — NeoSwap did it in 2022 with budgets, reserve prices and combinatorial optimisation. Their flow is: bid on specific known items, receive a proposed trade, then everyone signs it. Ours is: sign an outcome predicate once, and any future combination inside those bounds is already approved. Proposal authorisation versus outcome authorisation.

**Isn't this CoW Protocol?**
CoW clears fungible tokens at a uniform price. Tickets are non-fungible and carry per-person bundle constraints — four seats must share a session and a section. No uniform clearing price exists, so what gets verified is not a price but each participant's declared conditions.

**Isn't this Seaport criteria orders?**
Seaport can express "any NFT matching this criterion", and that part is not new. Seaport matches bilaterally. Ours composes many asynchronous predicates into a multi-party reallocation with net cash settlement, without asking anyone to approve a concrete trade.

**Hasn't the theory been done?**
Yes, and we cite it. Top Trading Cycles dates to 1974; kidney exchange is its best-known application; a 2026 Imperial paper studies exactly this for Wimbledon ballot winners, including price differences between courts and dates. Matching-market research shows the reallocation can be improved. We made the conditional replacement executable — signed predicates, on-chain enforcement, asynchronous settlement, issuer inventory as a standing participant.

**What if there's no cycle?**
Buyers and sellers participate in the same pool, so a chain can terminate in cash at either end. Issuer inventory can start one. A closed cycle is one solution shape, not a requirement.

**Two solutions are both valid — who picks?**
The contract checks conditions; it does not rank. Selection is the solver's, and the rule is published: minimise total net payment, ties break toward fewer participants, then lowest gas. The interface separates *your limit*, *what you actually paid*, and *why this candidate*. We never call a result optimal — the search is bounded.

**How do I know the solver isn't cheating me?**
You don't have to. The contract validates the final state against the predicate you signed. A malicious solver can propose anything; V1–V8 refuse it. Try it in the demo.

**What if someone withdraws before settlement?**
The transaction reverts. Nobody is half-traded — that is EVM default behaviour, not our contribution. The proposer loses gas, which is why simulation runs first. Withdrawal is unconditional and immediate, by design.

**Doesn't signing in advance lock my funds?**
No. ERC-20 approval is a spending allowance, not a reservation, and escrowed tickets can be withdrawn at any time. You need not be online at settlement, but settlement still requires your intent, tickets and payment capacity to remain valid.

**Does this work with my Ticketmaster tickets?**
No. Only tickets issued by contracts in our registry. Minting an NFT from a PDF transfers nothing. This is a post-allocation reshuffling layer for issuer-native tickets, not a replacement for existing platforms.

**What stops scalpers?**
Nothing here. This reallocates tickets that have already been sold; it creates no seats and prevents no bot from buying them in the first place.

**What about the atomicity guarantee?**
A single transaction reverting wholesale is EVM default behaviour, so we don't claim it as an innovation. The contribution is verifying that a reshuffle satisfies every participant's own signed conditions before it executes.

---

## Limitations

Named, not hidden.

| Limitation | Status |
|---|---|
| **Cold start** | Reshuffles need density of compatible intent. Buyers, sellers and issuer inventory reduce the dependency; they do not remove it. A constructed cycle is not evidence of market demand |
| **Issuer trust is centralised** | Only registered issuer contracts are recognised. Their permissions are published |
| **No incentive-compatibility claim** | Conditions are self-reported. Users may misreport |
| **Bounded search** | *No solution found* is not *no solution exists*. Participant, candidate and timeout caps are published |
| **Unaudited** | Demonstration only. Do not deposit real assets |
| **Adjacency depends on us issuing** | Seat numbers are consecutive integers within a row by construction. This does not generalise to arbitrary venues |
| **The Graph is not the only possible discovery mechanism** | Mappings cannot be enumerated on-chain, but RPC logs could be indexed by other means. This implementation relies on The Graph |

---

## Repository

```
src/
  TicketNFT.sol        ERC-721, packed metadata, redemption
  Escrow.sol           custody, unconditional withdrawal
  IntentRegistry.sol   EIP-712 commitment and revocation
  Settlement.sol       V1–V8 validation, atomic execution
test/
  Settlement.t.sol     the rejection table
script/
  Deploy.s.sol
solver/                TypeScript
subgraph/
web/
docs/                  PRD, TRD
```

### Build

```bash
forge build
forge test -vvvv
forge test --gas-report
forge script script/Deploy.s.sol --rpc-url $ARC_RPC --broadcast
```

`foundry.toml` sets `evm_version = "paris"` — Arc Testnet has known PUSH0 compatibility issues with newer EVM versions. Gas estimation on some USDC writes is unreliable, so deployment scripts pass explicit gas limits.

### Deployment

| Contract | Address | Network |
|---|---|---|
| TicketNFT | *TBD* | Arc Testnet |
| Escrow | *TBD* | Arc Testnet |
| IntentRegistry | *TBD* | Arc Testnet |
| Settlement | *TBD* | Arc Testnet |

Gas figures come from `forge test --gas-report`. They are populated after the validation suite is green, never estimated.

---

## Prior art

We build on existing work and say so.

| Work | What it established |
|---|---|
| Shapley & Scarf (1974), Top Trading Cycles | Multi-party reallocation from endowments |
| Roth et al., kidney exchange | All-or-nothing multi-way chains in practice |
| Haugh (2026), *From Luck to Choice: The Wimbledon Ballot and Matching Markets* | Ticket reallocation with price differences between dates and courts |
| NeoSwap | Multi-party NFT barter with budgets and combinatorial optimisation |
| Seaport | Criteria-based orders — bidding on any item matching a predicate |
| CoW Protocol | Signed intents cleared in batches, coincidence of wants |

None of them combines persistent outcome predicates, asynchronous multi-party clearing without re-approval, issuer inventory as a standing participant, and net cash settlement over non-fungible bundles. That combination is what this implements.
