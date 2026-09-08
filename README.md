# Cross

**Aqua strategies advertise liquidity the wallet no longer backs.
Cross turns virtual depth into executable depth — before pricing runs.**

🔗 **Live demo:** _TBD_ &nbsp;&nbsp; 🎥 **Video:** _TBD_ &nbsp;&nbsp; 📄 [Spec](./docs/CROSS_SPEC.md)

![From revert to resize](docs/resize.gif)

> Cross moves inventory safety upstream of pricing.

---

## Tracks

| Sponsor | Track | Status |
|---|---|---|
| **1inch** | Build an Aqua App — $5,000 | Primary |
| **The Graph** | Best AI Tooling or AI Use Case (From Scratch) — $5,000 | Conditional, see [The Graph](#the-graph-integration) |

Category: **DeFi** · Pool: **Start Fresh** (net-new, built during ETHOnline 2026)

Cross is a custom SwapVM instruction, so it targets the higher-scored path of the 1inch track.
Aqua is used unmodified at its official deployment; only the router is redeployed, which the
qualification rules permit.

---

## Problem

### One wallet, many strategies, one real balance

1inch Aqua replaces escrow with promises. Funds stay in the maker's wallet, and multiple
strategies quote against them. This is Aqua's central capability — the same capital powers
several strategies at once.

But Aqua tracks balances **per strategy**:

```
balances[maker][app][strategyHash][token]
```

- `ship()` records a virtual amount **without checking what the maker actually holds**
- `pull()` decrements **only the strategy that traded**, then transfers real ERC-20
- `safeBalances()` returns the virtual figure — "safe" means the strategy is active and not
  docked, not that funds back it

Sibling strategies are never told the wallet shrank.

### What that produces

```
              wallet 10 ETH
        A virtual 10    B virtual 10

A fills 6 ETH
              wallet  4 ETH
        A virtual  4    B virtual 10   ← stale, and permanently so

taker routes into B for 8 ETH
        quote says fine  →  pricing says fine  →  safeTransferFrom  →  REVERT
```

The gap widens with every fill. This is the default trajectory, not an edge case.

1inch documents the resulting contention as a **first-fill-wins race** and states plainly that
Aqua will not resolve it for the operator. The suggested mitigations are to segregate wallets,
cap what each strategy is shipped, or keep docking and re-shipping — each of which either
reintroduces the capital partitioning Aqua exists to remove, or requires active off-chain
inventory management.

### Why off-chain risk management does not transfer

Every professional market maker runs global inventory limits. That machinery assumes the maker
can withdraw quotes when inventory is consumed.

Aqua strategies are immutable on-chain programs that execute autonomously. Cancelling requires
`dock()` — a transaction, taking a block. A maker cannot be in the loop at block granularity.

**The inventory limit has to live inside the strategy.**

---

## Solution

`CROSS_XD` is a SwapVM instruction placed first in a strategy's program. Before any pricing
runs, it replaces the stale virtual reserves with reserves the wallet can actually honour.

```
Aqua virtual reserves            10 ETH
            │
      ┌─────▼─────┐
      │ CROSS_XD  │   coverage = min(wallet balance, allowance to Aqua)
      └─────┬─────┘   scale BOTH reserves by the same factor
            │
truthful executable reserves      6 ETH
            │
   downstream pricing (XYC / Concentrate / Decay / limit)
            │
   native partial fill  →  Aqua.pull(6)  →  real ERC-20 transfer
```

**Guards say yes or no. Cross says how much is executable.**

The scope is deliberate. Cross does not improve solvency — Aqua's terminal transfer already
guarantees the wallet cannot pay what it lacks. What changes is *where* the constraint binds:
from a settlement-time revert to quote-time executable capacity.

### Pricing-agnostic by construction

Cross never inspects the pricing logic below it. It does not need to know whether the strategy
is a limit order, a constant-product curve, concentrated liquidity, or something written next
month. It answers one question — *how much really exists* — and hands that down.

Two statements, deliberately kept separate:

> **Cross is pricing-agnostic:** it constrains executable reserves before downstream pricing,
> without understanding the strategy's pricing logic.

> **For partial-fill-capable strategies,** stale virtual liquidity becomes a smaller executable
> fill instead of a late settlement failure. For full-fill-only strategies it becomes a clean
> reject, which is correct behaviour.

Conflating these produces a claim a SwapVM-literate reader can break in one question.

---

## How it works

### Execution

```
 1  read coverage        = min(balanceOf(maker), allowance(maker, AQUA))
 2  resolve epoch        new block → snapshot openingCoverage, consumed = 0
                         same block → load stored values
 3  envelope             blockRemaining = saturating(openingCoverage − consumed)
                         remaining      = min(blockRemaining, currentCoverage)
 4  (deferred)           optional per-fill bound
 5  zero envelope        revert InsufficientSharedInventory(requested, 0)
 6  proportional scale   if remaining < balanceOut:
                             balanceIn  = balanceIn * remaining / balanceOut
                             balanceOut = remaining
 7  exact-out guard      compare against the POST-scaling reserve
 8  continue             ctx.runLoop()
 9  persist              real-swap path only: consumed += amountOut
```

Four rules that are not stylistic:

| Rule | Why |
|---|---|
| Subtract `consumed` from `openingCoverage` only, never from live coverage | Live coverage already fell with every fill; subtracting again charges the same tokens twice. With wallet 10 and a 4 ETH fill: `min(10−4, 6) = 6` correct, `min(10,6)−4 = 2` wrong |
| Saturating arithmetic throughout | A checked subtraction against externally mutable balances underflows and bricks `swap()` and `quote()` permanently — the shape OpenZeppelin flagged in `_decayXD` as acknowledged-not-resolved |
| Scale both reserves by one factor | Scaling only `balanceOut` moves the implied spot price. Both sides keeps the ratio and only reduces depth |
| Persist only when `!isStaticContext` | Quoting must not consume inventory. Same pattern the official `Decay` instruction uses |

### Why virtual drift does not break it

Sibling virtual balances diverge permanently, but coverage is re-read live on every
invocation. Cross never trusts the number that drifts.

```
virtual balance   can lie, and does, monotonically
real coverage     cannot — Aqua.pull ends in safeTransferFrom
```

Cross writes nothing back to Aqua. A sibling's recorded claim still reads 10; what changed is
what that claim can execute.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Frontend — REVERT vs RESIZE, side by side, real transactions │
└───────────────────────────┬──────────────────────────────────┘
                            │ GraphQL
┌───────────────────────────▼──────────────────────────────────┐
│  Subgraph — reconstructs a wallet's strategy set from         │
│  Aqua `Shipped` events; discovery only, not source of truth   │
└───────────────────────────┬──────────────────────────────────┘
                            │ eth_call / events
┌───────────────────────────▼──────────────────────────────────┐
│  CrossRouter                                                  │
│    is Simulator, SwapVM, CrossOpcodes                         │
│    CrossOpcodes is AquaOpcodes    (append-only override)       │
│    redeployed — permitted by the track rules                  │
└───────────────────────────┬──────────────────────────────────┘
                            │ ship / dock / pull / push
┌───────────────────────────▼──────────────────────────────────┐
│  Aqua — official deployment, unmodified                       │
└──────────────────────────────────────────────────────────────┘
```

`AquaOpcodes._runOpcode` is `virtual`; delegating to `super` keeps every program the stock Aqua
SDK emits dispatching byte-identically. The extension is strictly additive — no existing opcode
is renumbered or replaced.

### One wallet behind many strategies

```
                    maker wallet
                 10 ETH (never escrowed)
                          │
          ship()  ┌───────┼───────┐  ship()
                  │       │       │
             Strategy A  Strategy B  Strategy C
             limit sell   RFQ sell   AMM ask side
             virtual 10   virtual 10  virtual 10
                  │       │       │
                  └───────┼───────┘
                          │
                   one real balance
              every fill reduces it for all
```

All three consume the **same** token. A buy-side strategy would consume the quote asset and
would not contend for this inventory at all.

---

## Sequence — without Cross

```
Taker            Router           Aqua            Maker wallet
  │                │               │                   │
  │ swap(B, 8) ───▶│               │                   │
  │                │ safeBalances ▶│                   │
  │                │◀── 10 ────────│   virtual, stale  │
  │                │               │                   │
  │                │ XYCConcentrate                    │
  │                │ 10 ≥ 8, no cap needed             │
  │                │               │                   │
  │                │ pull(8) ─────▶│                   │
  │                │               │ balance 10→2  ok  │
  │                │               │ transferFrom(8) ─▶│
  │                │               │                   │ holds 6
  │                │               │◀───── REVERT ─────│
  │◀── REVERT ─────│               │                   │
  │  gas burned, no fill                               │
```

## Sequence — with Cross

```
Taker            Router          CROSS_XD          Aqua         Maker wallet
  │                │                │               │                │
  │ swap(B, 8) ───▶│                │               │                │
  │                │ safeBalances ──────────────────▶│                │
  │                │◀───────── 10 ───────────────────│  virtual       │
  │                │                │               │                │
  │                │ dispatch ─────▶│               │                │
  │                │                │ balanceOf ────────────────────▶│
  │                │                │ allowance ────────────────────▶│
  │                │                │◀──── coverage = 6 ─────────────│
  │                │                │                                │
  │                │                │ balanceIn  ×= 6/10             │
  │                │                │ balanceOut  = 6                │
  │                │                │ ratio unchanged                │
  │                │                │                                │
  │                │                │ runLoop() ▶ XYCConcentrate     │
  │                │                │   wants 8 > balanceOut 6       │
  │                │                │   cap out = 6                  │
  │                │                │   recompute amountIn ↓         │
  │                │                │               │                │
  │                │ pull(6) ───────────────────────▶│                │
  │                │                │               │ transferFrom(6)▶│
  │◀── 6 ETH ──────────────────────────────────────────────────────── │
  │  SETTLED                                                          │
```

## Flow chart

```
                    swap() / quote()
                           │
                  load Aqua virtual reserves
                           │
                      ┌────▼────┐
                      │ CROSS_XD│
                      └────┬────┘
                           │
                 coverage = min(balance, allowance)
                           │
              remaining = min(opening − consumed, coverage)
                           │
                    ┌──────▼──────┐
                    │ remaining=0 │
                    └──┬───────┬──┘
                   yes │       │ no
                       ▼       ▼
    InsufficientSharedInventory │
       (named, recoverable)     │
                                ▼
                    ┌───────────────────────┐
                    │ remaining < balanceOut│
                    └──┬─────────────────┬──┘
                   yes │                 │ no
                       ▼                 │
          scale both reserves            │
          by remaining/balanceOut        │
                       └────────┬────────┘
                                ▼
                          ctx.runLoop()
                                │
                     downstream pricing
                                │
              ┌─────────────────┴─────────────────┐
              │ partial-fill capable              │ full-fill only
              ▼                                   ▼
     cap output, recompute input            clean reject
              │
              ▼
     Aqua.pull → real ERC-20 → SETTLED
```

---

## Benefits

**For makers**

- Oversubscribe without your positions racing each other into settlement failures
- Stale strategies degrade into smaller fills instead of dying
- No keeper, no oracle, no repair window — enforcement is atomic inside the swap
- Works with any pricing strategy; Cross never touches your pricing logic

**For solvers and routers**

- Executable capacity is knowable at quote time rather than discovered by routing into a revert
- No wasted gas on trades that were never fillable
- Routing decisions reflect real depth, not promises

**For the ecosystem**

- Aqua's capital multiplier stays usable at high utilisation, not only when utilisation happens
  to be low
- Reusable primitive: one instruction, composable in front of any SwapVM pricing program

**Explicitly not claimed**

- Not a solvency guarantee — Aqua's transfer already provides that
- Not an allocator — Cross bounds the aggregate, it does not decide which strategy deserves
  inventory. Execution order stays order-dependent, as everywhere on Ethereum
- Not a firm quote across later state changes

---

## Removal test

| Remove | Consequence |
|---|---|
| **SwapVM** | No place to insert the layer. You would rewrite an AMM contract, and the result is not a composable primitive |
| **Aqua** | The contention does not exist — with escrow, pool A's capital is not pool B's |
| **`CROSS_XD`** | Strategies race each other until a transfer reverts |
| **The Graph** | A maker cannot see their own strategy set; there is no on-chain way to enumerate it |

---

## The Graph integration

Aqua stores balances in a nested mapping. There is **no on-chain way to enumerate which
strategies a wallet has shipped** — a router cannot observe a sibling position it has never
executed. Aqua emits `Shipped(maker, app, strategyHash, strategy)`, and indexing those events
is the only way to reconstruct a maker's full position set and remaining shared inventory.

Submitted to the AI track as a risk copilot over live indexed data, answering questions such as
which makers show the largest gap between virtual liquidity and executable coverage, which
groups are exposed to first-fill-wins failure, and why a given maker's executable depth
collapsed.

**Boundary:** the subgraph is discovery and prefiltering. `router.quote()` against current
chain state is the source of truth — balances and allowances move, and an indexer lags.

A plain subgraph qualifies for neither Graph track, so this submission is conditional on the
copilot being completed. If it is not, the track is dropped rather than mocked.

---

## Prior art

| Work | Approach | Relationship |
|---|---|---|
| **Doca / plimsoll** (Lisbon 2026) | Per-strategy budgets with an off-chain keeper that docks and re-ships after balances move | Independent discovery of the same problem. Their README documents a `BudgetGuard` they did not build, and the reason: changing the taker's amount after downstream fee instructions have run does not fit the SwapVM pipeline. Cross sits *before* pricing, so it never faces that |
| **Superpose** (Lisbon 2026) | On-chain guard over shared collateral | Their guard answers whether a position may spend, at the last instant. Cross changes what the position exposes, before pricing runs |
| **`_decayXD`** (official) | Mooniswap-derived virtual reserves; directional offsets decaying over time | Orthogonal. Decay governs how fast price impact recovers; Cross governs how much inventory participates. They compose |
| **PA-AMM research** (2026) | Block-scoped active/passive reserve partition in one pool | Cross reuses the block-scoped idea. The paper models one pool and has no notion of inventory shared across positions |

No prior work found implements this exact mechanism — a strategy-agnostic reserve resize
applied before pricing, enforced inside the swap VM. Adjacent work exists and is listed above;
this states what a search surfaced, not absolute novelty.

---

## Repository

```
src/
  Cross.sol            instruction body
  CrossOpcodes.sol     AquaOpcodes + dispatch override
  CrossRouter.sol      Simulator + SwapVM + CrossOpcodes
test/
  Gate05_RevertToResize.t.sol      the A/B proof
  helpers/
scripts/
  preflight.sh         verifies the pinned swap-vm actually has the mechanism
subgraph/
docs/
  CROSS_SPEC.md
```

### Build

```bash
forge install 1inch/swap-vm 1inch/aqua
./scripts/preflight.sh              # blocking — see below
forge test --match-test test_fromRevertToResize -vvvv
```

### Version pinning matters

Tagged releases and `main` differ in whether the mechanism exists at all. At `v1.0.2`,
`XYCConcentrate` is only a balance transform with no output cap, `TakerTraits` has no
`allowPartialFill`, and `OpcodeList.sol` does not exist. On `main` (0.0.6) all three are
present.

`scripts/preflight.sh` checks the resolved dependency and refuses to proceed if the
partial-fill path is missing. Pinned version and commit are recorded below.

| Dependency | Pin | Verified |
|---|---|---|
| `@1inch/swap-vm` | _TBD_ | _TBD_ |
| `@1inch/aqua` | _TBD_ | _TBD_ |

---

## Qualification

- [x] Official Aqua/SwapVM contracts; only the router is redeployed
- [x] Custom SwapVM instruction, appended without renumbering existing opcodes
- [ ] On-chain ERC-20 transfer shown in the final demo
- [ ] Positions demonstrated through both tests and UI
- [ ] Commit history narrating the development sequence, no final-day single commit

---

## License

Cross is released under MIT. The 1inch SwapVM and Aqua contracts it builds on carry their own
licences (`LicenseRef-Degensoft-SwapVM-1.1`, `Aqua-Source-1.1`); hackathon use including
redeployment of a modified SwapVM is permitted by the track rules.
