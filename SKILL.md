---
name: aquavalve-build
summary: Build and test AquaValve — a custom 1inch Aqua SwapVM extension with programmable live liquidity (local λ + shared Γ).
description: Use this skill to build the AquaValve Solidity contracts, run test gates, generate documentation, and prepare a hackathon demo. Covers Foundry setup, Aqua/SwapVM interfaces, ACTIVENESS_XD instruction, local λ scaling, shared Γ wallet envelope, coverage-drop quote shrinking, Decay composition, The Graph subgraph, and all required diagrams.
---

# AquaValve Build Skill

## Mission

Build a working AquaValve — a custom Aqua app and SwapVM extension where liquidity liveness is programmable. The output must compile, pass test gates, and demonstrate the core claim:

> Liquidity doesn't have to be all-in. AquaValve lets a maker decide how much goes live each block.

## First Actions

Before writing any code:

1. Read `AGENTS.md` for non-negotiable technical semantics and test gates.
2. Check if Foundry is installed: `forge --version`.
3. Check the repo tree: identify what exists (frontend, docs) vs what is missing (contracts, tests).
4. Do **not** claim compile/test/deploy success unless command output proves it.

## Phase 1 — Foundry Setup

### 1.1 Initialize Foundry (alongside existing Next.js)

```bash
forge init --no-git --no-commit
```

This creates:

```
foundry.toml
src/              # Solidity source (rename or symlink to contracts/ if preferred)
test/             # Foundry tests
script/           # deploy scripts
lib/              # dependencies (forge-std)
```

### 1.2 Configure foundry.toml

```toml
[profile.default]
src = "contracts"
out = "out"
libs = ["lib"]
solc = "0.8.24"
optimizer = true
optimizer_runs = 200

[profile.default.fuzz]
runs = 256
```

Move the default `src/` to `contracts/` if using that convention:

```bash
mv src contracts
```

### 1.3 Install forge-std

```bash
forge install foundry-rs/forge-std --no-git --no-commit
```

### 1.4 Verify

```bash
forge build
```

Must compile with zero errors before proceeding.

## Phase 2 — Aqua/SwapVM Interfaces

1inch Aqua is not a public Foundry package. Build minimal interfaces that model the parts AquaValve needs.

### 2.1 Files to create

```
contracts/interfaces/IAqua.sol
contracts/interfaces/ISwapVM.sol
contracts/interfaces/IERC20.sol
contracts/lib/SwapVMTypes.sol
```

### 2.2 IAqua.sol — what we need from Aqua

```solidity
interface IAqua {
    function safeBalances(
        address maker,
        bytes32 orderHash,
        address tokenIn,
        address tokenOut
    ) external view returns (uint256 reserveIn, uint256 reserveOut);

    function settle(
        address maker,
        address taker,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        bytes32 orderHash
    ) external;
}
```

### 2.3 SwapVMTypes.sol — shared types

```solidity
struct Order {
    address maker;
    address tokenIn;
    address tokenOut;
    uint256 reserveIn;
    uint256 reserveOut;
    bytes32 groupId;
    uint256 activenessNumerator;   // λ as fraction of 1e18
    uint256 activenessGroupCap;    // Γ envelope cap
    bytes   strategyBytes;
}
```

### 2.4 Key constraint

Do **not** reimplement order-hash logic off-chain. Use `router.hash(order)` as the source of truth.

## Phase 3 — Core Contracts

Build in this order. Each contract must compile before starting the next.

### 3.1 Activeness.sol — the ACTIVENESS_XD instruction

This is the core. It does two things:

**Local λ — per-position active reserves:**

```
effectiveReserve = totalReserve × λ / 1e18
```

State per position per token:

```solidity
struct LocalState {
    uint256 blockNumber;
    uint256 activeReserveIn;
    uint256 activeReserveOut;
}
mapping(bytes32 => mapping(address => LocalState)) public localState;
// key: orderHash => token => state
```

Rules:
- `λ = 1e18` (100%) must behave identically to vanilla XYC.
- Same-block trades continue on consumed active curve — no fresh slice.
- Next block repartitions from current total state.

**Shared Γ — wallet-level envelope:**

```solidity
struct GroupState {
    uint256 blockNumber;
    uint256 openingCoverage;
    uint256 remaining;
}
mapping(bytes32 => GroupState) public groupState;
// key: keccak256(maker, groupId, token)
```

Coverage:

```solidity
uint256 coverage = min(
    IERC20(token).balanceOf(maker),
    IERC20(token).allowance(maker, aqua)
);
```

Rules:
- Coverage drops shrink quotes proportionally. Never brick `quote()`.
- Same-block inflows do not reopen envelope until next block.
- Group state uses ordinary storage (not transient).
- Same outer transaction must share group consumption across different order hashes.

**ExactOut guard:**

```solidity
require(amountOut < finalEffectiveActiveOut, "ActiveLiquidityExceeded");
```

Use the final scaled output reserve after both local λ and group coverage scaling. Do not rely on downstream XYC arithmetic panic.

**Opcode index:**

Do not hard-code `0x92`. Append to the actual `_instructions()` table and expose:

```solidity
function activenessOpcode() external view returns (uint8);
```

### 3.2 AquaValveRouter.sol — modified SwapVM router

Instruction pipeline:

```
ACTIVENESS_XD → optional DECAY_XD → XYC_SWAP → settlement
```

Two paths:
- `quote(order, amountIn)` → returns amountOut, **zero state writes**.
- `swap(order, amountIn)` → persists local + group state, calls Aqua settlement.

The router must:
- Call `IAqua.safeBalances()` for full virtual reserves.
- Run `ACTIVENESS_XD` (scales reserves, checks group envelope).
- Optionally run `DECAY_XD` (time-based price impact recovery).
- Run `XYC_SWAP` (constant-product pricing).
- On swap path: persist state, call `IAqua.settle()`.

Expose `hash(order)` as the canonical order-hash source.

### 3.3 AquaValveOrderBuilder.sol — strategy builder

Encodes activeness parameters into strategy bytes for Aqua orders:

```solidity
function buildStrategy(
    uint256 activenessNumerator,
    bytes32 groupId,
    uint256 groupCap
) external pure returns (bytes memory strategyBytes);
```

Uses `router.hash(order)` — no independent hash reimplementation.

### 3.4 DemoTaker.sol — multi-order test helper

A contract that calls two orders in a single transaction to prove shared Γ works:

```solidity
function fillTwoOrders(
    Order calldata orderA,
    uint256 amountInA,
    Order calldata orderB,
    uint256 amountInB
) external;
```

This is critical for Gate 2 — it proves that order B sees the group state consumed by order A within the same transaction.

## Phase 4 — Test Gates

Run gates in order. Do not skip ahead.

### Gate 0 — Compile

```bash
forge build
```

Zero errors. Zero warnings about the core contracts.

### Gate 1 — Local λ

File: `test/ActivenessSinglePosition.t.sol`

Write these 7 tests:

| Test | Setup | Assert |
|---|---|---|
| `test_lambda_100_equals_XYC` | λ = 1e18, exact-in | Output == vanilla XYC output |
| `test_same_block_does_not_refresh_lambda` | Two trades, same block | Second trade uses consumed curve |
| `test_split_trade_does_not_reactivate_liquidity` | Split exact-in, same block | Combined == single trade on active curve |
| `test_next_block_repartitions` | Trade block N, trade block N+1 | Block N+1 gets fresh active reserves |
| `test_exact_in_continues_on_consumed_curve` | Sequential exact-in, same block | Each faces moved curve |
| `test_exact_out_above_effective_active_reverts` | exactOut >= effective | Reverts `ActiveLiquidityExceeded` |
| `test_quote_does_not_mutate_state` | Call quote, snapshot state | State unchanged after quote |

To advance blocks in Foundry:

```solidity
vm.roll(block.number + 1);
```

Run:

```bash
forge test --match-contract ActivenessSinglePosition -vvv
```

### Gate 2 — Shared Γ

File: `test/ActivenessGroupEnvelope.t.sol`

Write these 4 tests using `DemoTaker`:

| Test | Setup | Assert |
|---|---|---|
| `test_two_orders_same_tx_share_group_budget` | DemoTaker fills A then B | B capacity reflects A consumption |
| `test_coverage_drop_shrinks_quote_not_reverts` | Reduce maker balance | Quote shrinks, no revert |
| `test_allowance_drop_shrinks_quote_not_reverts` | Reduce maker allowance | Quote shrinks, no revert |
| `test_same_block_inflow_does_not_reopen_envelope` | Deposit in same block | Group remaining unchanged |

Run:

```bash
forge test --match-contract ActivenessGroupEnvelope -vvv
```

### Gate 3 — Decay Composition

File: `test/ActivenessDecayComposition.t.sol`

Run the same swap through 4 pipelines and compare:

1. XYC only
2. DECAY + XYC
3. ACTIVENESS + XYC
4. ACTIVENESS + DECAY + XYC

```bash
forge test --match-contract ActivenessDecayComposition -vvv
```

### Gate 4 — Demo

This is the live demo. Requires all prior gates green.

1. Deploy contracts to a local Anvil fork or testnet.
2. Fund maker wallet.
3. Create two positions.
4. Execute the demo script from `FULL_EXECUTION.md` Section 9.

### Hash Integrity

```bash
forge test --match-test test_aqua_strategy_hash_matches_router_order_hash -vvv
```

## Phase 5 — The Graph (Secondary Sponsor)

Only after Gate 2 passes.

### 5.1 Event to emit from Activeness.sol

```solidity
event ActivenessApplied(
    bytes32 indexed orderHash,
    address indexed maker,
    bytes32 indexed groupId,
    address token,
    uint256 effectiveActive,
    uint256 totalReserve,
    uint256 groupRemaining,
    uint256 blockNumber
);
```

### 5.2 Subgraph entities

```
ActivePosition    — per-order active reserves per block
GroupEnvelope     — per-maker per-group remaining capacity
CoverageSnapshot  — balance/allowance readings
```

### 5.3 Subgraph purpose

Solvers query the subgraph to discover which positions have remaining capacity before routing. This avoids wasted gas on positions that will revert.

## Phase 6 — Documentation

After contracts compile and tests pass, generate or update:

```
README.md
FULL_EXECUTION.md
PITCH.md
TEST_PLAN.md
docs/diagrams/*.mmd
```

### Required diagrams (Mermaid source)

```
docs/diagrams/01_architecture.mmd
docs/diagrams/02_execution_sequence.mmd
docs/diagrams/03_state_machine.mmd
docs/diagrams/04_failure_paths.mmd
docs/diagrams/05_sponsor_layers.mmd
docs/diagrams/06_demo_flow.mmd
```

### Mermaid style

Use dark theme with colored classDefs:

```mermaid
%%{init: {
  "theme": "dark",
  "themeVariables": {
    "background": "#0b0f14",
    "primaryColor": "#1f2937",
    "primaryTextColor": "#f8fafc",
    "primaryBorderColor": "#64748b",
    "lineColor": "#94a3b8",
    "fontFamily": "Inter, ui-sans-serif, system-ui, sans-serif"
  }
}}%%
```

```mermaid
classDef sponsor fill:#312e81,stroke:#818cf8,color:#ffffff,stroke-width:2px;
classDef core fill:#064e3b,stroke:#34d399,color:#ffffff,stroke-width:2px;
classDef risk fill:#7f1d1d,stroke:#f87171,color:#ffffff,stroke-width:2px;
classDef data fill:#164e63,stroke:#22d3ee,color:#ffffff,stroke-width:2px;
classDef user fill:#3f3f46,stroke:#d4d4d8,color:#ffffff,stroke-width:2px;
```

### Status labels

Every feature in docs must use one of:

- `Implemented` — code exists and tests pass (with command output proof)
- `In progress` — code exists, tests not yet green
- `Planned` — no code yet
- `Stretch` — depends on core being green first

## Phase 7 — Sponsor Mapping

Each sponsor must own a distinct structural layer:

```
1inch / SwapVM  → execution primitive (ACTIVENESS_XD)    — mandatory
Aqua            → shared wallet position layer            — mandatory
The Graph       → live capacity discovery layer           — preferred secondary
World           → human step-up for exposure relaxation   — stretch only
Ledger          → hardware approval for exposure increase — stretch only
Chainlink CRE   → private runtime headroom policy        — stretch only
Uniswap v4      → portability proof for local λ          — stretch only
```

Do not add stretch sponsors until Gate 2 passes.

## Cut Lines

If **Gate 2 fails** by deadline → ship local-λ only:

```
ACTIVENESS_XD + Decay composition + benchmark
```

Do not ship half-working Γ.

If **Decay composition fails** → ship:

```
ACTIVENESS_XD + local λ + shared Γ + failure-path tests
```

## Forbidden

- Do not claim tests pass without `forge test` output.
- Do not hard-code opcode `0x92`.
- Do not reimplement order-hash off-chain.
- Do not claim AquaValve guarantees solvency.
- Do not use World ID to secure swaps.
- Do not add sponsors as stickers.
- Do not use transient storage for group state.
- Do not ship half-working Γ.

## Quality Bar

The build is complete when:

- `forge build` compiles with zero errors.
- Gate 1 (local λ) has 7 green tests with output.
- Gate 2 (shared Γ) has 4 green tests with output.
- Gate 3 (decay composition) runs 4 pipeline configurations.
- README reflects actual implementation status, not aspirational claims.
- Every diagram has Mermaid `.mmd` source.
- Demo can be rehearsed from the README alone.

## Execution Command

After following this skill:

```bash
forge build && forge test -vvv
```
