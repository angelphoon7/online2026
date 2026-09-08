# Cross Agent Instructions

Use this file together with `SKILL.md` when generating README, FULL_EXECUTION, diagrams, tests, and submission material for Cross.

## Project Identity

**Project:** Cross — Shared-inventory market making on 1inch Aqua

**One-line pitch:**

> Cross margin for DeFi: one balance behind every position, enforced inside the swap.

**Technical pitch:**

> AMMs made price programmable. Cross makes inventory programmable.

## Core Idea

Cross adds a SwapVM instruction called `CROSS_XD`.

It reads the maker's real executable coverage and proportionally resizes the strategy's reserves before downstream pricing runs, so a partial-fill-capable pricing instruction settles a smaller fill instead of failing at settlement.

At full maturity (Gate 1+), Cross reconciles multiple strategies shipped by the same maker so they quote against one shared real inventory rather than against independently tracked virtual balances. Depth falls; quoted price ratios remain unchanged.

## What Cross Is

Cross is a custom Aqua app and SwapVM extension. It reads real on-chain coverage (wallet balance and allowance) and resizes Aqua's virtual reserves to match, preventing settlement failures when virtual depth exceeds real capacity.

## What Cross Is Not

Cross is not:

- a generic dashboard,
- a router aggregator,
- a dynamic fee AMM,
- a replacement for `DECAY_XD`,
- a solvency guarantee,
- a local activeness / block-scoped participation rate mechanism.

## Claim Discipline

Always distinguish:

- implemented behavior,
- tests that actually ran,
- model tests,
- planned integration,
- sponsor roadmap.

Never say "passed" unless there is command output.

## Current State: Gate 0.5 — REVERT to RESIZE

Gate 0.5 proves exactly one thing:

```
Aqua virtual depth 10 / real wallet coverage 6, same taker parameters both sides

  without CROSS_XD:  pricing trusts 10 -> oversized Aqua.pull -> REVERT
  with    CROSS_XD:  reserves resized to 6 -> native partial fill -> SETTLE
```

**Status: PASS** — `test_fromRevertToResize` and `test_crossOpcodeViewMatchesDispatchedSlot` both green.

### What Gate 0.5 implements

- `coverage(maker, token)` = `min(balanceOf, allowance to Aqua)`
- Zero-coverage revert with `InsufficientSharedInventory(requested, 0)`
- Proportional resize of both `balanceIn` and `balanceOut` when coverage < balanceOut
- `ctx.runLoop()` to continue the SwapVM program

### What Gate 0.5 does NOT implement

- Group state (`GroupEpoch`, `openingCoverage`, `consumed`)
- Sibling accounting across order hashes
- `maxFillBps` or any rate-limiting
- Exact-out zero-envelope short circuit (returns zero path)
- Envelope ceiling with same-block inflow protection

These belong to Gate 1+.

## Technical Semantics: Gate 0.5

### Coverage

Executable coverage is:

```text
min(maker ERC20 balance, maker allowance to Aqua)
```

Coverage drops shrink quotes, not brick them.

### Proportional Scaling

Scale both `balanceIn` and `balanceOut` by the same factor. Scaling only one side alters the spot ratio.

### Zero-Envelope Revert

When coverage is zero, revert with `InsufficientSharedInventory(requested, 0)`. A zero fill is not representable: `TakerTraits.validate` opens with `require(amountOut > 0)` and is called by both `quote()` and `swap()`.

### Opcode Index

Do not hard-code `0x92` or any fixed opcode index. Reference as `Opcode._92` via the enum. Expose `crossOpcode()` as a public view on the router.

### Saturating Subtraction

Never use checked subtraction that could underflow and brick the position. At Gate 0.5 this applies to the coverage-vs-balanceOut comparison (use `<` guard, not subtraction).

### allowPartialFill is load-bearing

Without it, `TakerTraits.validate` enforces `takerAmount == amountIn` on exact-in, so a resize that lowers `amountIn` reverts on validation, not on anything Cross did.

### Hashing / Shipping

In Aqua mode (`useAquaInsteadOfSignature: true`), `aqua.ship(router, abi.encode(order), tokens, amounts)` creates `strategyHash = keccak256(abi.encode(order))` which equals `router.hash(order)`.

## Technical Semantics: Gate 1+ (Planned)

### Shared Inventory / Group Envelope

- Group state is keyed by `maker + groupId + token`.
- State struct is `GroupEpoch { lastBlock, openingCoverage, consumed }`.
- Use ordinary storage, not transient storage.
- State must NOT be keyed by `orderHash`.
- Same outer transaction must share group consumption across different order hashes.
- Group envelope turns "route first, revert later" into quote-time deterministic capacity.
- It does not make an underfunded wallet solvent.

### Envelope Ceiling

```text
cap = min(openingCoverage, currentCoverage)
```

`openingCoverage` is snapshotted at the block's first real execution. `currentCoverage` is read live every invocation. Taking the minimum means:
- Same-block inflows cannot raise the ceiling (I8).
- Same-block outflows lower it immediately.

### Zero-Envelope Short Circuit (Gate 1)

When remaining is zero:
- Exact-in: return amountOut = 0 without invoking downstream pricing.
- Exact-out: revert with `InsufficientSharedInventory(requested, 0)`.

### Exact-Out Guard

Guard against `amountOut >= balanceOut` after scaling (step 7), not against the pre-scaling reserve.

## Required Test Gates

Gate 0 — Plumbing (**PASS**):

```text
cross_opcode_view_matches_dispatched_slot
```

Gate 0.5 — REVERT to RESIZE (**PASS**):

```text
test_fromRevertToResize
```

Gate 1 — Single-strategy (planned):

```text
unbound_envelope_matches_plain_program
first_execution_initialises_epoch
second_same_block_execution_uses_stored_consumption
split_trade_cannot_reopen_envelope
next_block_refreshes_from_current_coverage
reverse_direction_shares_token_keyed_state
quote_does_not_mutate_state
exact_out_above_post_scaling_reserve_reverts_cleanly
dust_grants_minimum_unit_and_stays_live
```

Gate 2 — Shared inventory (planned):

```text
siblings_share_one_envelope
fill_on_one_shrinks_all_siblings_same_block
proportional_shrink_preserves_spot_ratio
coverage_drop_shrinks_quote_not_reverts
allowance_drop_shrinks_quote_not_reverts
same_block_inflow_does_not_replenish
zero_envelope_exact_in_returns_zero_without_reverting
zero_envelope_exact_out_reverts_named
virtual_balances_unchanged_after_sibling_fill
next_block_refreshes_from_real_coverage
distinct_group_ids_do_not_share
headroom_only_tightens
two_orders_same_tx_share_group_budget
```

Gate 3 — Aqua integration (planned):

```text
shipped_key_equals_router_resolved_key
fill_moves_real_erc20_between_maker_and_taker
```

Gate 4 — Composition (planned):

```text
xyc_baseline
decay_then_xyc
cross_then_xyc
cross_then_decay_then_xyc
```

Test 2.10 (`two_orders_same_tx_share_group_budget`) is the load-bearing security test. It MUST be implemented in Solidity with a real `DemoTaker` helper contract.

## Invariants

| # | Invariant | Gate |
|---|---|---|
| I1 | With no binding envelope, output is byte-identical to the equivalent stock SwapVM program. | 1 |
| I2 | Within one block, the sum of gross outflows across all strategies in a group never exceeds the coverage observed at that block's first real execution. | 2 |
| I3 | The reserve ratio handed to downstream pricing equals the pre-scaling ratio, within integer rounding. | **0.5 (proven)** |
| I4 | `quote()` never mutates state. | 1 |
| I5 | An exact-in `quote()` never reverts on account of state drift; it shrinks toward zero. Exact-out above executable inventory reverts with a named error. | 1 |
| I6 | A position never becomes permanently unfillable. | 1 |
| I7 | Consumption is visible to sibling strategies executing later in the *same transaction*, not merely the same block. | 2 |
| I8 | Same-block inflows do not increase `remaining`. The envelope may only tighten within a block. | 2 |
| I9 | Cross never writes to Aqua's virtual balances. Sibling strategies' recorded claims are unchanged; only effective executable depth is reduced. | 2 |

## File Layout

```
contracts/
  Cross.sol              CrossBuilder library + Cross abstract (coverage + resize)
  CrossOpcodes.sol       AquaOpcodes + CROSS_XD dispatch
  CrossRouter.sol        Simulator + SwapVM + CrossOpcodes
  DemoTaker.sol          multi-call taker helper (kept for Gate 1)
test/
  Cross.t.sol            Gate 0 + Gate 0.5 tests (real Aqua integration)
scripts/
  preflight.sh           mandatory version check before writing contract code
references/
  scaffold.md            contract and test templates
  traps.md               version traps with source citations
SKILL.md                 cross-gate05 skill definition
```

## Sponsor Priority

1. 1inch Aqua/SwapVM core — mandatory.
2. The Graph live capacity surface — strongest secondary layer.
3. Ledger / Chainlink / Uniswap — stretch only after core tests pass.

## Best README Sentence

> Cross turns Aqua shared liquidity from soft virtual promises into deterministic executable capacity.

## Best Demo Sentence

> This second order looks locally executable, but the shared wallet envelope has already been consumed. Cross tells the solver before settlement would revert.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
