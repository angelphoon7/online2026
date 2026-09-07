---
name: aquavalve-build
summary: Build and test AquaValve — a custom 1inch Aqua SwapVM extension with programmable live liquidity (local λ + shared Γ).
description: Use this skill to build the AquaValve Solidity contracts, run test gates, generate documentation, and prepare a hackathon demo. Covers Foundry setup, real Aqua/SwapVM integration, ACTIVENESS_XD instruction, local λ scaling, shared Γ wallet envelope, coverage-drop quote shrinking, Decay composition, The Graph subgraph, and all required diagrams.
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
4. Install the **real** 1inch repos as Foundry dependencies:
   ```bash
   forge install 1inch/swap-vm --no-git --no-commit
   forge install 1inch/aqua --no-git --no-commit
   ```
5. Read `lib/swap-vm/src/instructions/Decay.sol` and `lib/swap-vm/src/instructions/XYCSwap.sol` to understand the instruction pattern before writing `Activeness.sol`.
6. Do **not** claim compile/test/deploy success unless command output proves it.

## Phase 1 — Foundry Setup

### 1.1 Initialize Foundry (alongside existing Next.js)

```bash
forge init --no-git --no-commit
```

### 1.2 Configure foundry.toml

```toml
[profile.default]
src = "contracts"
out = "out"
libs = ["lib"]
solc = "0.8.30"
optimizer = true
optimizer_runs = 200
via_ir = true

[profile.default.fuzz]
runs = 256
```

Use `solc = "0.8.30"` to match the official SwapVM contracts.

### 1.3 Install dependencies

```bash
forge install foundry-rs/forge-std --no-git --no-commit
forge install 1inch/swap-vm --no-git --no-commit
forge install 1inch/aqua --no-git --no-commit
```

### 1.4 Configure remappings

In `foundry.toml` or `remappings.txt`:

```
@1inch/swap-vm/=lib/swap-vm/src/
@1inch/aqua/=lib/aqua/src/
```

### 1.5 Verify

```bash
forge build
```

Must compile with zero errors before proceeding.

## Phase 2 — Aqua Interface

Aqua and SwapVM are open-source. Use the **real** repos installed in `lib/`.

### 2.1 Real Aqua interface

The official Aqua core uses `ship`, `dock`, `pull`, `push` — **not** a single `settle()` call.

```solidity
interface IAqua {
    function safeBalances(
        address maker,
        address app,
        bytes32 strategyHash,
        address token0,
        address token1
    ) external view returns (uint256 balance0, uint256 balance1);

    function ship(
        address app,
        bytes calldata strategy,
        address[] calldata tokens,
        uint256[] calldata amounts
    ) external returns (bytes32 strategyHash);

    function dock(
        address app,
        bytes32 strategyHash,
        address[] calldata tokens
    ) external;

    function pull(
        address maker,
        bytes32 strategyHash,
        address token,
        uint256 amount,
        address to
    ) external;

    function push(
        address maker,
        address app,
        bytes32 strategyHash,
        address token,
        uint256 amount
    ) external;
}
```

Token movement goes through `pull()` / `push()`, not a single `settle()`. If writing mock tests, a `MockAqua.settle()` convenience is fine, but **never describe it as the Aqua interface**.

### 2.2 SwapVM instruction pattern

Every SwapVM instruction is a **library** with:

```solidity
library MyInstruction {
    Opcode constant opcode = Opcode.SomeSlot;

    function exec(Context memory ctx, bytes calldata args) internal { ... }
    function build(...) internal pure returns (bytes memory) { ... }
    function sizeOf(...) internal pure returns (uint256) { ... }
}
```

Instructions modify `ctx.swap.balanceIn / balanceOut` (to scale reserves) or compute `ctx.swap.amountIn / amountOut`. State persistence is gated by `ctx.vm.isStaticContext` (false = quote, true = swap).

Study `lib/swap-vm/src/instructions/Decay.sol` — it is the closest pattern to what Activeness needs (stateful, per-order, per-token storage).

### 2.3 Key types from SwapVM

```solidity
// from lib/swap-vm/src/libs/VM.sol
struct Context {
    VM vm;
    SwapQuery query;       // orderHash, maker, taker, tokenIn, tokenOut, isExactIn
    SwapRegisters swap;    // balanceIn, balanceOut, amountIn, amountOut
    ProtocolFee fee;
}
```

`ACTIVENESS_XD` scales `ctx.swap.balanceIn` and `ctx.swap.balanceOut` before downstream instructions (Decay, XYC) run.

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
struct LocalTokenState {
    uint256 blockNumber;
    uint256 activeReserve;
}
mapping(bytes32 orderHash => mapping(address token => LocalTokenState)) public localState;
```

Each token's active reserve is tracked independently. Both directions (ETH→USDC and USDC→ETH) read the same per-token state.

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

Group envelope is **objective coverage**. The `headroomBps` parameter can only tighten it, never increase executable capacity:

```solidity
uint256 headroomBps; // optional tightening cap, <= 10000 (100%)
```

If `headroomBps < 10000`, the effective envelope is `coverage * headroomBps / 10000`. A position cannot use `headroomBps` to exceed the wallet's actual coverage.

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

Use a free slot in the "Balances tuning" bank (0x90-0xaf). The real `OpcodeList.sol` has `_92` through `_93` free. Do not hard-code — claim a `_XX` slot from the enum and expose:

```solidity
function activenessOpcode() external pure returns (uint8);
```

**State persistence gate:**

Follow the Decay pattern — only write state when `!ctx.vm.isStaticContext`:

```solidity
if (!ctx.vm.isStaticContext) {
    // persist local and group state
}
```

### 3.2 AquaValveOpcodes.sol — extended opcode dispatcher

Extend `AquaOpcodes` to add the Activeness instruction:

```solidity
contract AquaValveOpcodes is AquaOpcodes {
    function _runOpcode(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        if (opcode == Activeness.opcode.asU8()) Activeness.exec(ctx, args);
        else super._runOpcode(ctx, opcode, args);
    }
}
```

### 3.3 AquaValveRouter.sol — extended router

Extend `AquaSwapVMRouter` pattern with our custom opcodes:

```solidity
contract AquaValveRouter is Simulator, SwapVM, AquaValveOpcodes {
    constructor(address aqua, address weth, address owner, string memory name, string memory version)
        SwapVM(aqua, weth, owner, name, version) { }

    function _dispatch(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        _runOpcode(ctx, opcode, args);
    }
}
```

### 3.4 AquaValveOrderBuilder.sol — strategy builder

Encodes activeness parameters into strategy bytes:

```solidity
function buildStrategy(
    uint256 activenessNumerator,
    bytes32 groupId,
    uint256 headroomBps
) external pure returns (bytes memory strategyBytes);
```

The builder is `pure` — it only encodes bytes. Hash preflight belongs in tests/scripts:

```solidity
// In test or script — NOT in the builder
bytes32 strategyHash = router.hash(order);
bytes32 shippedHash = aqua.ship(address(router), abi.encode(order), tokens, amounts);
assertEq(shippedHash, strategyHash);
```

### 3.5 DemoTaker.sol — multi-order test helper

A contract that fills two orders in a single transaction to prove shared Γ works:

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

Use **tight coverage** (maker balance close to effective reserves) so group envelope is binding.

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
3. Ship two positions via `aqua.ship()`.
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

### 5.3 Subgraph role

The Graph provides **live-capacity discovery and prefiltering**. It helps solvers avoid obviously exhausted sibling positions.

**The subgraph is not the source of truth.** It may have block-level lag. The authoritative executable amount is always `router.quote()` at the current chain state. SwapVM quote path reads Aqua balances and runs the full instruction program; settlement goes through `pull()` / `push()`.

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
- Do not describe `settle()` as the Aqua interface. Aqua uses `ship / dock / pull / push`.
- Do not let `headroomBps` increase executable capacity beyond wallet coverage.

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
