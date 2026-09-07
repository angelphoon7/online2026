# AquaValve Agent Instructions

Use this file together with `SKILL.md` when generating README, FULL_EXECUTION, diagrams, tests, and submission material for AquaValve.

## Project Identity

**Project:** AquaValve — Programmable Live Liquidity for Aqua

**One-line pitch:**

> Liquidity doesn't have to be all-in. AquaValve lets a maker decide how much goes live each block.

**Technical pitch:**

> AMMs made price programmable. AquaValve makes liveness programmable.

## Core Idea

AquaValve adds a SwapVM instruction called `ACTIVENESS_XD`.

It has two layers:

1. **Local λ** — per-position active reserves for the current block.
2. **Shared Γ / group envelope** — per-maker, per-group, per-token wallet release envelope across sibling Aqua positions.

## What AquaValve Is

AquaValve is a custom Aqua app and SwapVM extension. It lets makers expose only part of their liquidity to trading during a block, while preventing sibling Aqua positions from independently quoting capacity that the shared wallet cannot deterministically execute.

## What AquaValve Is Not

AquaValve is not:

- a generic dashboard,
- a router aggregator,
- a dynamic fee AMM,
- a replacement for `DECAY_XD`,
- a solvency guarantee,
- a World/Uniswap/Chainlink/Ledger project first.

## Claim Discipline

Always distinguish:

- implemented behavior,
- tests that actually ran,
- model tests,
- planned integration,
- sponsor roadmap.

Never say “passed” unless there is command output.

## Non-Negotiable Technical Semantics

### Local λ

- `λ = 100%` must behave like normal XYC.
- `λ < 100%` creates a shallower effective reserve curve.
- Same-block exact-in trades can still execute after the first trade.
- Same-block trades continue along the already consumed active curve.
- Same-block trades never receive a fresh active slice.
- Next block repartitions from the current total state.

### ExactOut

- Guard against `amountOut >= finalEffectiveActiveOut`.
- Use the final scaled output reserve after local λ and group coverage scaling.
- Do not rely on downstream XYC arithmetic panic.

### Shared Γ

- Group state is keyed by `maker + groupId + token`.
- Use ordinary storage, not transient storage.
- Same outer transaction must share group consumption across different order hashes.
- Group envelope should turn “route first, revert later” into quote-time deterministic capacity.
- It does not make an underfunded wallet solvent.

### Coverage

Executable coverage is at most:

```text
min(maker ERC20 balance, maker allowance to Aqua)
```

Coverage drops should shrink quotes, not brick quote.

Same-block inflows should not reopen the envelope until the next block.

### Opcode Index

Do not hard-code `0x92` or any fixed opcode index. Append to the actual `_instructions()` table and expose an `activenessOpcode()` helper for tests/builders.

### Hashing / Shipping

Do not independently reimplement order-hash logic off-chain.

Use `router.hash(order)` as the source of truth, then ship the corresponding strategy bytes/key consistently. Add a test named:

```text
aqua_strategy_hash_matches_router_order_hash
```

## Required Test Gates

Gate 0 — Compile:

```bash
forge build
```

Gate 1 — Local λ:

```text
lambda_100_equals_XYC
same_block_does_not_refresh_lambda
split_trade_does_not_reactivate_liquidity
next_block_repartitions
exact_in_continues_on_consumed_curve
exact_out_above_effective_active_reverts
quote_does_not_mutate_state
```

Gate 2 — Shared Γ:

```text
two_orders_same_tx_share_group_budget
coverage_drop_shrinks_quote_not_reverts
allowance_drop_shrinks_quote_not_reverts
same_block_inflow_does_not_reopen_envelope
```

Gate 3 — Decay:

```text
XYC only
DECAY + XYC
ACTIVENESS + XYC
ACTIVENESS + DECAY + XYC
```

Gate 4 — Demo:

- real Aqua ship,
- real token transfer,
- local λ visualization,
- shared Γ failure path,
- quote shrink after coverage drop.

## Sponsor Priority

1. 1inch Aqua/SwapVM core — mandatory.
2. The Graph live capacity surface — strongest secondary layer.
3. World / Ledger / Chainlink / Uniswap — stretch only after core tests pass.

## Best README Sentence

Use this near the top:

> AquaValve turns Aqua shared liquidity from soft virtual promises into programmable live capacity.

## Best Demo Sentence

Use this during the demo:

> This second order looks locally executable, but the shared wallet envelope has already been consumed. AquaValve tells the solver before settlement would revert.
