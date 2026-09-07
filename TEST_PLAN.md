# TEST_PLAN.md — AquaValve

## Overview

All tests are Foundry-based Solidity tests using `forge test`. No test claims success unless command output proves it.

**Current status: all gates are planned. No contracts have been implemented yet.**

## Gate 0 — Compile

```bash
forge build
```

Must produce zero errors before any test gate runs.

| Check | Criteria |
|---|---|
| Compilation | All contracts compile without errors or warnings |
| Opcode index | `ACTIVENESS_XD` appended to `_instructions()` table, not hard-coded `0x92` |
| `activenessOpcode()` | Helper exposed for tests and builders |

**Status:** Planned.

## Gate 1 — Local λ

**File:** `test/ActivenessSinglePosition.t.sol`

| # | Test Name | Input | Expected Output |
|---|---|---|---|
| 1.1 | `lambda_100_equals_XYC` | λ = 100%, exact-in trade | Output identical to vanilla XYC with same reserves |
| 1.2 | `same_block_does_not_refresh_lambda` | Two trades in same block | Second trade sees consumed curve, not fresh λ slice |
| 1.3 | `split_trade_does_not_reactivate_liquidity` | Split exact-in across two calls, same block | Combined output equals single-trade output on same active curve |
| 1.4 | `next_block_repartitions` | Trade in block N, trade in block N+1 | Block N+1 trade gets fresh active reserves computed from current total state |
| 1.5 | `exact_in_continues_on_consumed_curve` | Sequential exact-in trades, same block | Each trade faces the curve after prior trades consumed it |
| 1.6 | `exact_out_above_effective_active_reverts` | exactOut >= finalEffectiveActiveOut | Reverts with `ActiveLiquidityExceeded` |
| 1.7 | `quote_does_not_mutate_state` | Call quote, then read state | All state slots unchanged after quote |

### Local λ Invariants

- `λ = 100%` is a no-op: output must match vanilla XYC exactly.
- Active reserves are computed as `totalReserve × λ / 1e18`.
- Same-block trades NEVER receive a fresh active slice.
- Exact-out guard uses the **final** scaled output reserve (after both local λ and group coverage scaling).

**Status:** Planned.

## Gate 2 — Shared Γ

**File:** `test/ActivenessGroupEnvelope.t.sol`

| # | Test Name | Input | Expected Output |
|---|---|---|---|
| 2.1 | `two_orders_same_tx_share_group_budget` | DemoTaker fills A then B in one tx | B's available capacity reflects A's consumption |
| 2.2 | `coverage_drop_shrinks_quote_not_reverts` | Reduce maker balance mid-test | Quote returns smaller amount instead of reverting |
| 2.3 | `allowance_drop_shrinks_quote_not_reverts` | Reduce maker allowance mid-test | Quote returns smaller amount instead of reverting |
| 2.4 | `same_block_inflow_does_not_reopen_envelope` | Deposit tokens to maker in same block after consumption | Group remaining does not increase |

### Shared Γ Invariants

- Group state keyed by `maker + groupId + token`.
- Uses ordinary storage (not transient).
- Same outer transaction must share group consumption across different order hashes.
- Coverage drops produce smaller quotes, never brick `quote()`.
- Same-block inflows do not reopen the envelope.

**Status:** Planned.

## Gate 3 — Decay Composition

**File:** `test/ActivenessDecayComposition.t.sol`

Run the same swap sequence through four pipeline configurations:

| # | Pipeline | Purpose |
|---|---|---|
| 3.1 | XYC only | Baseline pricing |
| 3.2 | DECAY + XYC | Time recovery without liveness control |
| 3.3 | ACTIVENESS + XYC | Liveness control without time recovery |
| 3.4 | ACTIVENESS + DECAY + XYC | Full composition |

### Composition Invariants

- ACTIVENESS and DECAY are orthogonal: applying both is equivalent to applying each independently in sequence.
- ACTIVENESS restricts **how much** inventory participates.
- DECAY controls **how quickly** price impact recovers.
- With both enabled, the active slice uses the decay-adjusted reserves for pricing.

**Status:** Planned.

## Gate 4 — Demo

| # | Step | Verification |
|---|---|---|
| 4.1 | Real Aqua ship with maker position | Transaction receipt shows position created |
| 4.2 | Real token transfer via Aqua settlement | ERC-20 Transfer event in transaction logs |
| 4.3 | Local λ visualization | Active vs inactive reserves readable from state |
| 4.4 | Shared Γ failure path | `GroupActiveLiquidityExceeded` revert on Position B |
| 4.5 | Quote shrink after coverage drop | Quote returns smaller amount after balance reduction |

**Status:** Planned.

## Hash Integrity

| Test Name | What it proves |
|---|---|
| `aqua_strategy_hash_matches_router_order_hash` | Off-chain strategy bytes produce the same order hash as `router.hash(order)` |

**Status:** Planned.

## Test Execution Order

```
Gate 0 (compile) → Gate 1 (local λ) → Gate 2 (shared Γ) → Gate 3 (decay) → Gate 4 (demo)
```

Do not proceed to the next gate until the current gate is fully green. Do not add stretch sponsor tests until Gate 3 passes.

## Failure Protocol

- If Gate 1 fails: fix local λ before touching shared Γ.
- If Gate 2 fails by deadline: ship local-λ only. Do not ship half-working Γ.
- If Gate 3 fails: ship local λ + shared Γ without decay composition.
- If any gate "passes" only in a JS model test, label it as **model test** — not a Solidity integration test.
