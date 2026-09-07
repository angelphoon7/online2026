# PITCH.md — AquaValve

## One-Liner

> Liquidity doesn't have to be all-in. AquaValve lets a maker decide how much goes live each block.

## Technical One-Liner

> AMMs made price programmable. AquaValve makes liveness programmable.

## The Problem (30 seconds)

In 1inch Aqua, one maker wallet can back many positions. Each position tracks virtual balances independently. Position B can look fully executable even after Position A already consumed the real wallet capacity. The solver routes to B, the transaction lands, and Aqua's ERC-20 transfer reverts.

This is **route-first, revert-later**. The capacity looked live but wasn't.

## The Solution (60 seconds)

AquaValve adds `ACTIVENESS_XD` to the SwapVM instruction pipeline. It sits before Decay and XYC and does two things:

1. **Local λ** — each position exposes only a fraction of its reserves per block. A 20% valve on 100 ETH means the active curve this block starts at 20 ETH. Trades can still execute within that curve; they just face a shallower pool. Next block, the position repartitions from the new total state.

2. **Shared Γ** — sibling positions sharing the same maker wallet get a deterministic envelope. Once Position A consumes part of the envelope, Position B's quote reflects the reduced capacity immediately. No more independent quoting of capacity the wallet cannot release.

The result: solvers know **at quote time** how much capacity is live. Route-first, revert-later becomes **quote-time deterministic capacity**.

## Why This Matters (30 seconds)

- **For solvers:** fewer reverts, better routing decisions, lower wasted gas.
- **For makers:** controlled exposure per block without pulling liquidity entirely.
- **For the protocol:** shared wallet positions become reliably quotable instead of probabilistically executable.

## Key Demo Moment

> "This second order looks locally executable, but the shared wallet envelope has already been consumed. AquaValve tells the solver before settlement would revert."

## Sponsor Fit

| Sponsor | Role | Why It's Load-Bearing |
|---|---|---|
| **1inch Aqua** | Shared wallet positions + settlement | AquaValve is meaningless without shared wallet positions to valve. |
| **SwapVM** | `ACTIVENESS_XD` instruction | The valve logic lives inside the swap instruction pipeline — it's not a wrapper. |
| **The Graph** | Live capacity discovery | Solvers need to query which positions have remaining capacity before routing. This is the preferred secondary integration. |

Stretch sponsors (World, Ledger, Chainlink, Uniswap) add optional gates and portability but are not required.

## What We Are Not Claiming

- AquaValve does not guarantee solvency.
- AquaValve does not replace Decay — they are orthogonal and composable.
- World ID does not secure swaps.
- No test or deployment success is claimed without command output.

## Technical Differentiator

AMM research has focused on making **price** more expressive (concentrated liquidity, dynamic fees, decay curves). AquaValve is the first to make **liveness** — how much inventory is actually available for repricing in a given block — a programmable, composable SwapVM parameter.

## Closing Line

> AquaValve turns Aqua shared liquidity from soft virtual promises into programmable live capacity.
