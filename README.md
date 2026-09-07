# AquaValve

> **Liquidity doesn't have to be all-in. AquaValve lets a maker decide how much goes live each block.**

AquaValve turns Aqua shared liquidity from soft virtual promises into programmable live capacity.

## The Problem

AMM liquidity is usually all-in: if an LP provides inventory, the market can reprice the full amount immediately. In 1inch Aqua, the situation is more subtle — one maker wallet can back many positions, and each strategy tracks virtual balances independently. A sibling position can look executable even after another sibling consumed the real wallet capacity, causing **route-first, revert-later** behavior.

AquaValve does not make an underfunded wallet solvent. Aqua's ERC-20 transfer remains the final hard constraint. AquaValve moves the failure earlier: from settlement-time revert to **quote-time deterministic capacity**.

## What AquaValve Does

AquaValve adds a SwapVM instruction called `ACTIVENESS_XD` with two layers:

### Local λ — per-position live liquidity

A maker sets a local activeness fraction. If the full virtual reserve is 100 ETH / 400,000 USDC and `λ = 20%`, this block's active curve starts as 20 ETH / 80,000 USDC.

- `λ = 100%` behaves like normal XYC (no restriction).
- Same-block trades continue on the consumed active curve — no fresh slice.
- Exact-out reverts only when `amountOut >= finalEffectiveActiveOut`.
- Next block repartitions from the current total state.

### Shared Γ — wallet-level execution envelope

Sibling Aqua positions sharing the same maker wallet get a per-maker, per-group, per-token envelope. Executable coverage is clamped to:

```
min(maker token balance, maker allowance to Aqua)
```

- Coverage drops **shrink** quotes instead of bricking `quote()` calls.
- Same-block inflows do not reopen the envelope until the next block.
- Group state is keyed by `maker + groupId + token` in ordinary storage (not transient).

## Architecture

```mermaid
%%{init: {"theme":"dark","themeVariables":{"background":"#0b0f14","primaryColor":"#1f2937","primaryTextColor":"#f8fafc","primaryBorderColor":"#64748b","lineColor":"#94a3b8","fontFamily":"Inter, ui-sans-serif, system-ui, sans-serif"}}}%%
flowchart TB
    subgraph Frontend ["Frontend (Next.js)"]
        CW[ConnectWalletButton<br/>MetaMask]:::user
        WV[WorldVerifyButton<br/>Selfie Check]:::user
    end

    subgraph SwapVM ["SwapVM Instruction Pipeline"]
        ACT[ACTIVENESS_XD<br/>local λ + shared Γ]:::core
        DEC[DECAY_XD<br/>optional]:::swapvm
        XYC[XYC_SWAP<br/>pricing]:::swapvm
    end

    subgraph Aqua ["1inch Aqua"]
        AQ[Aqua Protocol<br/>virtual balances]:::sponsor
        POS_A[Position A<br/>local λ]:::core
        POS_B[Position B<br/>local λ]:::core
        GRP[Shared Γ<br/>wallet envelope]:::core
        SETTLE[Settlement<br/>real ERC-20 transfer]:::sponsor
    end

    subgraph Discovery ["The Graph (planned)"]
        SG[Live Capacity<br/>Subgraph]:::data
    end

    MW[Maker Wallet<br/>ERC-20 balance + allowance]:::user

    MW -->|backs| AQ
    AQ --> POS_A
    AQ --> POS_B
    POS_A --> GRP
    POS_B --> GRP
    GRP --> ACT
    ACT --> DEC
    DEC --> XYC
    XYC --> SETTLE
    SETTLE -->|safeTransferFrom| MW

    ACT -.->|emit events| SG

    CW -.->|connect| MW
    WV -.->|step-up gate<br/>stretch only| ACT

    classDef sponsor fill:#312e81,stroke:#818cf8,color:#ffffff,stroke-width:2px;
    classDef core fill:#064e3b,stroke:#34d399,color:#ffffff,stroke-width:2px;
    classDef swapvm fill:#065f46,stroke:#6ee7b7,color:#ffffff,stroke-width:2px;
    classDef data fill:#164e63,stroke:#22d3ee,color:#ffffff,stroke-width:2px;
    classDef user fill:#3f3f46,stroke:#d4d4d8,color:#ffffff,stroke-width:2px;
```

## Execution Flow

```mermaid
%%{init: {"theme":"dark","themeVariables":{"background":"#0b0f14","primaryColor":"#1f2937","primaryTextColor":"#f8fafc","primaryBorderColor":"#64748b","lineColor":"#94a3b8","fontFamily":"Inter, ui-sans-serif, system-ui, sans-serif"}}}%%
sequenceDiagram
    autonumber
    participant T as Taker / Solver
    participant R as AquaValveRouter
    participant V as ACTIVENESS_XD
    participant X as XYC_SWAP
    participant M as Maker Wallet

    T->>R: quote/swap(order, amount)

    rect rgb(6,78,59)
        Note over V: Local λ Phase
        R->>V: computeEffectiveReserves
        V->>V: load localState[orderHash][token]
        alt same block
            V->>V: continue on consumed active curve
        else new block
            V->>V: repartition from total state
        end
    end

    rect rgb(22,78,99)
        Note over V: Shared Γ Phase
        V->>V: load groupState[maker][groupId][token]
        alt same block
            V->>V: clamp to stored remaining
        else new block
            V->>M: read balanceOf + allowance
            M-->>V: coverage = min(balance, allowance)
            V->>V: open fresh envelope
        end
        V-->>R: final effective reserves
    end

    R->>X: XYC constant-product pricing
    X-->>R: amountIn / amountOut

    alt swap path (not quote)
        R->>V: applyActiveness (persist state)
        R->>M: transferFrom(taker→maker, tokenIn)
        R->>M: transferFrom(maker→taker, tokenOut)
    end
```

## State Machine

```mermaid
%%{init: {"theme":"dark","themeVariables":{"background":"#0b0f14","primaryColor":"#1f2937","primaryTextColor":"#f8fafc","primaryBorderColor":"#64748b","lineColor":"#94a3b8","fontFamily":"Inter, ui-sans-serif, system-ui, sans-serif"}}}%%
stateDiagram-v2
    state "Local λ State Machine" as LocalLambda {
        [*] --> Fresh: deploy / first interaction

        Fresh --> ActiveBlock: quote or swap in block N
        note right of ActiveBlock
            activeReserve = totalReserve × λ
            blockNumber = N
        end note

        ActiveBlock --> ConsumedCurve: exact-in trade executes
        ConsumedCurve --> ConsumedCurve: another exact-in same block
        ConsumedCurve --> ActiveBlock: block N+1 (repartition)
        ActiveBlock --> ActiveBlock: block N+1 (repartition)

        state ExactOutCheck <<choice>>
        ActiveBlock --> ExactOutCheck: exact-out requested
        ExactOutCheck --> ConsumedCurve: amountOut < effective active
        ExactOutCheck --> Reverted: amountOut >= effective active
        Reverted --> ActiveBlock: next block repartitions
    }

    state "Shared Γ State Machine" as SharedGamma {
        [*] --> Idle: no group activity

        Idle --> Open: first sibling quotes in block N
        note right of Open
            openingCoverage = min(balance, allowance)
            remaining = openingCoverage
        end note

        Open --> Consuming: sibling order fills
        Consuming --> Consuming: another sibling fills (same block)
        Consuming --> GroupExceeded: remaining < requested

        Consuming --> Open: block N+1 (refresh)
        Open --> Open: block N+1 (refresh)
        GroupExceeded --> Open: block N+1 (refresh)
    }
```

## Failure Paths

```mermaid
%%{init: {"theme":"dark","themeVariables":{"background":"#0b0f14","primaryColor":"#1f2937","primaryTextColor":"#f8fafc","primaryBorderColor":"#64748b","lineColor":"#94a3b8","fontFamily":"Inter, ui-sans-serif, system-ui, sans-serif"}}}%%
flowchart TD
    START[Taker calls quote or swap]:::user --> LOCAL{Local λ check}

    LOCAL -->|amountOut < effective active| GAMMA{Shared Γ check}
    LOCAL -->|amountOut >= effective active| F1[ActiveLiquidityExceeded]:::risk

    GAMMA -->|remaining >= needed| XYC[XYC_SWAP pricing]:::swapvm
    GAMMA -->|remaining < needed| F2[GroupActiveLiquidityExceeded]:::risk

    XYC --> ISQUOTE{quote or swap?}
    ISQUOTE -->|quote| RETURN[Return amounts<br/>no state mutation]:::data
    ISQUOTE -->|swap| PERSIST[Persist state + settle]:::core

    PERSIST --> SUCCESS[Transfer complete]:::core
    PERSIST -->|underfunded wallet| F3[ERC-20 transfer reverts]:::risk

    classDef sponsor fill:#312e81,stroke:#818cf8,color:#ffffff,stroke-width:2px;
    classDef core fill:#064e3b,stroke:#34d399,color:#ffffff,stroke-width:2px;
    classDef swapvm fill:#065f46,stroke:#6ee7b7,color:#ffffff,stroke-width:2px;
    classDef risk fill:#7f1d1d,stroke:#f87171,color:#ffffff,stroke-width:2px;
    classDef data fill:#164e63,stroke:#22d3ee,color:#ffffff,stroke-width:2px;
    classDef user fill:#3f3f46,stroke:#d4d4d8,color:#ffffff,stroke-width:2px;
```

## Sponsor Layers

```mermaid
%%{init: {"theme":"dark","themeVariables":{"background":"#0b0f14","primaryColor":"#1f2937","primaryTextColor":"#f8fafc","primaryBorderColor":"#64748b","lineColor":"#94a3b8","fontFamily":"Inter, ui-sans-serif, system-ui, sans-serif"}}}%%
flowchart LR
    subgraph MANDATORY ["Mandatory — Core"]
        INCH[1inch SwapVM<br/>execution primitive]:::sponsor
        AQUA[Aqua Protocol<br/>shared wallet + settlement]:::sponsor
        ACT[ACTIVENESS_XD<br/>local λ + shared Γ]:::core
    end

    subgraph SECONDARY ["Preferred Secondary"]
        GRAPH[The Graph<br/>live capacity subgraph]:::data
    end

    subgraph STRETCH ["Stretch — After Core Green"]
        WORLD[World ID<br/>human step-up]:::stretch
        LEDGER[Ledger<br/>hardware approval]:::stretch
        CHAIN[Chainlink CRE<br/>headroom policy]:::stretch
        UNI[Uniswap v4<br/>λ portability]:::stretch
    end

    INCH --> ACT
    AQUA --> ACT
    ACT -->|emit events| GRAPH
    ACT -.-> WORLD
    ACT -.-> LEDGER
    ACT -.-> CHAIN
    ACT -.-> UNI

    classDef sponsor fill:#312e81,stroke:#818cf8,color:#ffffff,stroke-width:2px;
    classDef core fill:#064e3b,stroke:#34d399,color:#ffffff,stroke-width:2px;
    classDef data fill:#164e63,stroke:#22d3ee,color:#ffffff,stroke-width:2px;
    classDef stretch fill:#1e1b4b,stroke:#6366f1,color:#a5b4fc,stroke-width:1px,stroke-dasharray: 5 5;
```

## Decay vs AquaValve

Decay controls **how quickly** price impact recovers. AquaValve controls **how much inventory** participates in that repricing. They are orthogonal and composable:

| Pipeline | What it tests |
|---|---|
| XYC only | Baseline |
| DECAY + XYC | Time recovery without liveness control |
| ACTIVENESS + XYC | Liveness control without time recovery |
| ACTIVENESS + DECAY + XYC | Full composition |

## Demo Flow

```mermaid
%%{init: {"theme":"dark","themeVariables":{"background":"#0b0f14","primaryColor":"#1f2937","primaryTextColor":"#f8fafc","primaryBorderColor":"#64748b","lineColor":"#94a3b8","fontFamily":"Inter, ui-sans-serif, system-ui, sans-serif"}}}%%
flowchart TD
    OPEN["OPEN<br/>Liquidity doesn't have to be all-in"]:::user

    OPEN --> SETUP["1 — Setup<br/>Maker wallet with 100k USDC<br/>Two Aqua positions, λ = 50%<br/>Same group, shared Γ"]:::core

    SETUP --> SHOW["2 — Show Local λ<br/>Both positions: 50k active<br/>Both look executable"]:::data

    SHOW --> EXEC_A["3 — Execute Position A<br/>Swap consumes group budget"]:::swapvm

    EXEC_A --> ATTEMPT_B["4 — Attempt Position B<br/>Above remaining Γ<br/>→ GroupActiveLiquidityExceeded"]:::risk

    ATTEMPT_B --> PUNCHLINE["DEMO SENTENCE<br/>This second order looks locally<br/>executable, but the shared wallet<br/>envelope has already been consumed"]:::highlight

    PUNCHLINE --> RETRY["5 — Retry B smaller<br/>Within remaining Γ<br/>→ Real ERC-20 transfer"]:::core

    RETRY --> COV_DROP["6 — Coverage Drop<br/>Maker balance decreases<br/>→ Quote shrinks, no brick"]:::warn

    COV_DROP --> CLOSE["CLOSE<br/>AquaValve turns soft virtual promises<br/>into programmable live capacity"]:::user

    classDef core fill:#064e3b,stroke:#34d399,color:#ffffff,stroke-width:2px;
    classDef swapvm fill:#065f46,stroke:#6ee7b7,color:#ffffff,stroke-width:2px;
    classDef risk fill:#7f1d1d,stroke:#f87171,color:#ffffff,stroke-width:2px;
    classDef data fill:#164e63,stroke:#22d3ee,color:#ffffff,stroke-width:2px;
    classDef user fill:#3f3f46,stroke:#d4d4d8,color:#ffffff,stroke-width:2px;
    classDef warn fill:#78350f,stroke:#fbbf24,color:#ffffff,stroke-width:2px;
    classDef highlight fill:#581c87,stroke:#c084fc,color:#ffffff,stroke-width:3px;
```

## Key Files

### Contracts (implemented)

```
contracts/Activeness.sol                — ACTIVENESS_XD instruction (local λ + shared Γ)
contracts/AquaValveRouter.sol           — SwapVM router (ACTIVENESS_XD → XYC_SWAP)
contracts/DemoTaker.sol                 — multi-order test helper
contracts/interfaces/IAqua.sol          — Aqua interface
contracts/interfaces/IERC20.sol         — ERC-20 interface
contracts/lib/SwapVMTypes.sol           — shared types (Order, LocalState, GroupState)
```

### Tests (passing)

```
test/ActivenessSinglePosition.t.sol     — Gate 1: 7 local λ tests
test/ActivenessGroupEnvelope.t.sol      — Gate 2: 4 shared Γ tests
test/MockERC20.sol                      — test token
```

### Frontend (implemented)

```
component/connectWallet/                — MetaMask wallet connection
component/world_verif_button/           — World ID Selfie Check (stretch)
lib/world_verif_button/                 — server-side verification handlers
app/                                    — Next.js pages and API routes
```

### Diagrams (Mermaid source)

```
docs/diagrams/01_architecture.mmd
docs/diagrams/02_execution_sequence.mmd
docs/diagrams/03_state_machine.mmd
docs/diagrams/04_failure_paths.mmd
docs/diagrams/05_sponsor_layers.mmd
docs/diagrams/06_demo_flow.mmd
```

## Running

### Contracts

```bash
forge build
forge test -vvv
```

### Frontend

```bash
npm install
npm run dev
```

## Test Results

| Gate | Scope | Tests | Status |
|---|---|---|---|
| Gate 0 | `forge build` compiles | — | **Pass** |
| Gate 1 | Local λ | 7/7 | **Pass** |
| Gate 2 | Shared Γ | 4/4 | **Pass** |
| Gate 3 | Decay composition | — | Planned |
| Gate 4 | Demo | — | Planned |

## Sponsor Fit

| Sponsor | Layer | Removal Test |
|---|---|---|
| **1inch Aqua** | Shared wallet + settlement | Core — cannot remove |
| **SwapVM** | `ACTIVENESS_XD` instruction | Core — cannot remove |
| **The Graph** | Live capacity subgraph | Remove → core works, discovery is manual |
| World ID | Human step-up gate (stretch) | Remove → core works |
| Ledger | Hardware approval (stretch) | Remove → core works |
| Chainlink CRE | Private headroom policy (stretch) | Remove → core works |
| Uniswap v4 | Local λ portability proof (stretch) | Remove → core works |

## Non-Claims

- AquaValve does **not** guarantee solvency.
- World ID Selfie Check does not secure swaps.
- No test or deployment success is claimed without command output.
- Model tests are not Solidity integration tests.
