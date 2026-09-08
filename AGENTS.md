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

It reconciles multiple strategies shipped by the same maker so they quote against one shared real inventory rather than against independently tracked virtual balances.

When one strategy fills, Cross reads the maker's actual remaining coverage and proportionally reduces the effective executable depth of every sibling strategy within the same block. Depth falls; quoted price ratios remain unchanged.

## What Cross Is

Cross is a custom Aqua app and SwapVM extension. It allows multiple 1inch Aqua strategies, shipped by the same maker, to quote against one shared real inventory rather than against independently tracked virtual balances. It prevents sibling strategies from quoting capacity that the shared wallet cannot deterministically execute.

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

## Non-Negotiable Technical Semantics

### Shared Inventory / Group Envelope

- Group state is keyed by `maker + groupId + token`.
- State struct is `GroupEpoch { lastBlock, openingCoverage, consumed }`.
- Use ordinary storage, not transient storage.
- State must NOT be keyed by `orderHash`.
- Same outer transaction must share group consumption across different order hashes.
- Group envelope turns "route first, revert later" into quote-time deterministic capacity.
- It does not make an underfunded wallet solvent.

### Coverage

Executable coverage is:

```text
min(maker ERC20 balance, maker allowance to Aqua)
```

Coverage drops should shrink quotes, not brick quote.

### Envelope Ceiling

```text
cap = min(openingCoverage, currentCoverage)
```

`openingCoverage` is snapshotted at the block's first real execution. `currentCoverage` is read live every invocation. Taking the minimum means:
- Same-block inflows cannot raise the ceiling (I8).
- Same-block outflows lower it immediately.

### Saturating Subtraction

```text
remaining = cap > consumed ? cap - consumed : 0
```

Never use checked subtraction that could underflow and brick the position.

### Zero-Envelope Short Circuit

When remaining is zero:
- Exact-in: return amountOut = 0 without invoking downstream pricing.
- Exact-out: revert with `InsufficientSharedInventory(requested, 0)`.

This prevents passing zero reserves to XYC, which would panic.

### Proportional Scaling

Scale both `balanceIn` and `balanceOut` by the same factor. Scaling only one side alters the spot ratio.

### Exact-Out Guard

Guard against `amountOut >= balanceOut` after scaling (step 7), not against the pre-scaling reserve.

### Opcode Index

Do not hard-code `0x92` or any fixed opcode index. Reference as `Opcode._92` via the enum. Expose `crossOpcode()` as a public view on the router.

### Hashing / Shipping

Do not independently reimplement order-hash logic off-chain.

Use `router.hash(order)` as the source of truth, then ship the corresponding strategy bytes/key consistently. Add a test named:

```text
shipped_key_equals_router_resolved_key
```

## Required Test Gates

Gate 0 — Plumbing:

```text
cross_opcode_view_matches_dispatched_slot
stock_aqua_programs_dispatch_unchanged
single_strategy_executes_real_erc20_transfer
```

Gate 1 — Single-strategy:

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

Gate 2 — Shared inventory:

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

Gate 3 — Aqua integration:

```text
shipped_key_equals_router_resolved_key
fill_moves_real_erc20_between_maker_and_taker
```

Gate 4 — Composition:

```text
xyc_baseline
decay_then_xyc
cross_then_xyc
cross_then_decay_then_xyc
```

Test 2.10 (`two_orders_same_tx_share_group_budget`) is the load-bearing security test. It MUST be implemented in Solidity with a real `DemoTaker` helper contract.

## Invariants

| # | Invariant |
|---|---|
| I1 | With no binding envelope, output is byte-identical to the equivalent stock SwapVM program. |
| I2 | Within one block, the sum of gross outflows across all strategies in a group never exceeds the coverage observed at that block's first real execution. |
| I3 | The reserve ratio handed to downstream pricing equals the pre-scaling ratio, within integer rounding. |
| I4 | `quote()` never mutates state. |
| I5 | An exact-in `quote()` never reverts on account of state drift; it shrinks toward zero. Exact-out above executable inventory reverts with a named error. |
| I6 | A position never becomes permanently unfillable. |
| I7 | Consumption is visible to sibling strategies executing later in the *same transaction*, not merely the same block. |
| I8 | Same-block inflows do not increase `remaining`. The envelope may only tighten within a block. |
| I9 | Cross never writes to Aqua's virtual balances. Sibling strategies' recorded claims are unchanged; only effective executable depth is reduced. |

## Sponsor Priority

1. 1inch Aqua/SwapVM core — mandatory.
2. The Graph live capacity surface — strongest secondary layer.
3. Ledger / Chainlink / Uniswap — stretch only after core tests pass.

## Best README Sentence

Use this near the top:

> Cross turns Aqua shared liquidity from soft virtual promises into deterministic executable capacity.

## Best Demo Sentence

Use this during the demo:

> This second order looks locally executable, but the shared wallet envelope has already been consumed. Cross tells the solver before settlement would revert.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
