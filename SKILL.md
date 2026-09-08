---
name: aquavalve-build
summary: Build and test AquaValve — a custom 1inch Aqua + SwapVM extension with programmable live liquidity.
description: Use this skill to build AquaValve against the real 1inch Aqua and SwapVM sources. Covers Foundry setup, ACTIVENESS_XD, local λ, shared Γ wallet envelope, quote-time capacity, coverage-drop quote shrinking, Decay composition, The Graph capacity layer, diagrams, and hackathon demo discipline.
---

# AquaValve Build Skill — M0-Safe Verified Version

## Accuracy Contract

This skill is written against the currently inspected public 1inch sources:

- `1inch/aqua`
- `1inch/swap-vm`
- `1inch/sdks/tree/master/typescript/aqua`

Do not treat GitHub `main` as stable. At the start of implementation, record the exact commit SHAs used for `aqua`, `swap-vm`, `solidity-utils`, and `openzeppelin-contracts` in `README.md` or `IMPLEMENTATION_STATUS.md`.

Do **not** claim compile, test, deploy, or demo success unless command output proves it.

License note: the Aqua and SwapVM sources use custom Degensoft license identifiers. ETHOnline's 1inch track allows official Aqua/SwapVM usage and modified SwapVM redeployments for the submission, but do not make broader licensing claims beyond the hackathon use case.

## Mission

Build a working AquaValve: a custom Aqua app and SwapVM extension where liquidity liveness is programmable.

Core claim:

> Liquidity doesn't have to be all-in. AquaValve lets a maker decide how much goes live each block.

Technical claim:

> AMMs made price programmable. AquaValve makes liveness programmable.

## First Actions

Before writing code:

1. Read `AGENTS.md` for non-negotiable project semantics and test gates.
2. Check Foundry:
   ```bash
   forge --version
   ```
3. Check the repo tree and identify existing frontend/docs/contracts/tests.
4. Install real dependencies or verify they already exist:
   ```bash
   forge install foundry-rs/forge-std --no-git --no-commit
   forge install 1inch/swap-vm --no-git --no-commit
   forge install 1inch/aqua --no-git --no-commit
   forge install 1inch/solidity-utils --no-git --no-commit
   forge install OpenZeppelin/openzeppelin-contracts --no-git --no-commit
   ```

   If `forge install` fails for the 1inch repos, use the npm packages instead:

   ```bash
   yarn add @1inch/swap-vm @1inch/aqua @1inch/solidity-utils @openzeppelin/contracts
   ```

   Then update remappings to the equivalent `node_modules/` paths. Do not continue until `forge build` can resolve the official imports.
5. Inspect the exact local source files before coding:
   ```text
   lib/aqua/src/interfaces/IAqua.sol
   lib/aqua/src/Aqua.sol
   lib/swap-vm/src/SwapVM.sol
   lib/swap-vm/src/libs/VM.sol
   lib/swap-vm/src/libs/OpcodeList.sol
   lib/swap-vm/src/opcodes/AquaOpcodes.sol
   lib/swap-vm/src/routers/AquaSwapVMRouter.sol
   lib/swap-vm/src/instructions/Decay.sol
   lib/swap-vm/src/instructions/XYCSwap.sol
   ```
6. Do not redesign the project during M0. The first objective is `forge build`.

## Phase 1 — Foundry Setup

### 1.1 Initialize Foundry beside an existing Next.js app

```bash
forge init --no-git --no-commit
```

If the repo already has Foundry files, do not reinitialize. Merge configuration instead.

### 1.2 Configure `foundry.toml`

Use Solidity `0.8.30` and `via_ir = true` because the current Aqua and SwapVM sources use Solidity `0.8.30`.

```toml
[profile.default]
src = "contracts"
out = "out"
libs = ["lib", "node_modules"]
solc = "0.8.30"
optimizer = true
optimizer_runs = 700
via_ir = true

[profile.default.fuzz]
runs = 256

[fmt]
single_line_statement_blocks = "multi"
multiline_func_header = "all"
override_spacing = false
bracket_spacing = true
int_types = "long"
number_underscore = "thousands"
```

Notes:

- `optimizer_runs = 700` follows the current SwapVM project style. Aqua may use a different optimizer run count. Do not claim bytecode equivalence to official deployments unless the exact compiler settings and commits match.
- If the starter generated `src/`, either move it to `contracts/` or change `src = "src"` consistently.

### 1.3 Configure remappings

Use package-root remappings, not `/src` remappings. The official imports include paths such as `@1inch/aqua/src/interfaces/IAqua.sol`.

`remappings.txt`:

```text
forge-std/=lib/forge-std/src/
@1inch/swap-vm/=lib/swap-vm/
@1inch/aqua/=lib/aqua/
@1inch/solidity-utils/=lib/solidity-utils/
@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
```

If using npm packages instead of `lib/`, equivalent remappings:

```text
@1inch/swap-vm/=node_modules/@1inch/swap-vm/
@1inch/aqua/=node_modules/@1inch/aqua/
@1inch/solidity-utils/=node_modules/@1inch/solidity-utils/
@openzeppelin/contracts/=node_modules/@openzeppelin/contracts/
```

### 1.4 Verify baseline

```bash
forge build
```

If this fails before adding AquaValve code, fix dependency/remapping/compiler issues first.

## Phase 2 — Real Aqua / SwapVM Integration

### 2.1 Use official Aqua functions

Do not invent a fake `settle()` API as the core implementation. Aqua uses:

```solidity
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
```

Relevant functions in the official interface:

```solidity
function rawBalances(
    address maker, address app, bytes32 strategyHash, address token
) external view returns (uint248 balance, uint8 tokensCount);

function safeBalances(
    address maker, address app, bytes32 strategyHash, address token0, address token1
) external view returns (uint256 balance0, uint256 balance1);

function ship(
    address app, bytes calldata strategy, address[] calldata tokens, uint256[] calldata amounts
) external returns (bytes32 strategyHash);

function dock(
    address app, bytes32 strategyHash, address[] calldata tokens
) external;

function pull(
    address maker, bytes32 strategyHash, address token, uint256 amount, address to
) external;

function push(
    address maker, address app, bytes32 strategyHash, address token, uint256 amount
) external;
```

Aqua stores virtual balances by `maker → app/router → strategyHash/orderHash → token`. Aqua `ship()` stores the virtual balances and returns `keccak256(strategy)`. Token transfer happens through `pull()` and `push()`.

### 2.2 Use official SwapVM order/hash semantics

Import official SwapVM types where possible:

```solidity
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { Context, ContextLib } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { AquaOpcodes } from "@1inch/swap-vm/src/opcodes/AquaOpcodes.sol";
import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";
```

For Aqua-mode orders, `router.hash(order)` is the canonical hash. Use it as the source of truth.

Hash preflight test:

```solidity
bytes32 expected = router.hash(order);
bytes32 shipped = aqua.ship(address(router), abi.encode(order), tokens, amounts);
assertEq(shipped, expected);
```

This works because in Aqua mode, `router.hash()` returns `keccak256(abi.encode(order))`, and `aqua.ship()` also returns `keccak256(strategy)` where `strategy = abi.encode(order)`.

Do not independently reimplement order hashing off-chain.

### 2.3 Correct SwapVM context facts

`quote()` sets `ctx.vm.isStaticContext = true`. `swap()` sets it `false`.

- `true` = quote/static execution path, do not persist state.
- `false` = swap/state-changing path, may persist local and group state.

Your custom instruction must obey `isStaticContext` and never write during quote.

### 2.4 Real SwapVM instruction pattern

Current instructions are libraries with `exec/build/sizeOf`, wired through opcode dispatchers. Study `lib/swap-vm/src/instructions/Decay.sol` — it is the closest pattern to what Activeness needs (stateful, per-order, per-token storage, wraps `ctx.runLoop()`).

The opcode dispatcher compares the opcode to enum values and calls the corresponding library `exec()`.

## Phase 3 — Core Contracts

Build in this order. Each contract must compile before starting the next.

### 3.1 `Activeness.sol` — ACTIVENESS_XD

`ACTIVENESS_XD` is a balances-tuning wrapper instruction. It must run before downstream pricing computes the missing swap amount.

Recommended opcode slot:

```solidity
Opcode constant opcode = Opcode._92;
```

Current `OpcodeList.sol` places `_92` in the `0x90-0xaf` Balances tuning bank. Do not hard-code raw numeric `0x92` or `146`. Expose:

```solidity
function activenessOpcode() external pure returns (uint8);
```

If the installed SwapVM version changes, re-check `OpcodeList.sol` before using `_92`.

#### Args encoding

```text
args = abi.encodePacked(lambdaBps, headroomBps, groupId)
```

Where:

```text
lambdaBps   uint16, 1..10000
headroomBps uint16, 1..10000  (10000 = no extra tightening)
groupId     bytes32
```

#### Required errors

```solidity
error ActivenessArgsInvalidLength(uint256 length);
error ActivenessLambdaOutOfRange(uint256 lambdaBps);
error ActivenessHeadroomOutOfRange(uint256 headroomBps);
error ActivenessShouldBeBeforeSwapAmountComputation(uint256 amountIn, uint256 amountOut);
error ActiveLiquidityExceeded(uint256 requestedOut, uint256 effectiveActiveOut);
error ActivenessNoExecutableLiquidity(address tokenOut);
```

#### Local λ state

Track per-order, per-token active reserves:

```solidity
struct LocalTokenState {
    uint256 blockNumber;
    uint256 activeReserve;
}
mapping(bytes32 orderHash => mapping(address token => LocalTokenState)) internal _localState;
```

Rules:

- `lambdaBps = 10000` must behave like vanilla XYC.
- `lambdaBps < 10000` creates a shallower effective reserve curve.
- Same-block trades continue along the consumed active curve; they never get a fresh slice.
- Next block repartitions from current Aqua virtual balances.
- Reverse direction must read the same per-token state.

On a new block:

```text
active = floor(totalReserve × lambdaBps / 10000)
if totalReserve > 0 and active == 0, active = 1   // dust liveness exception
```

#### Shared Γ / group envelope

Group state is per maker, group, and maker-outflow token:

```solidity
struct GroupState {
    uint256 blockNumber;
    uint256 openingCoverage;
    uint256 remaining;
}
mapping(bytes32 groupKey => GroupState) internal _groupState;

function _groupKey(address maker, bytes32 groupId, address token) internal pure returns (bytes32) {
    return keccak256(abi.encode(maker, groupId, token));
}
```

The group envelope applies to `ctx.query.tokenOut` (maker outflow). Do not consume group budget for `tokenIn`.

Executable coverage:

```solidity
uint256 coverage = Math.min(
    IERC20(tokenOut).balanceOf(ctx.query.maker),
    IERC20(tokenOut).allowance(ctx.query.maker, address(AQUA))
);
```

The envelope is objective coverage. `headroomBps` can only tighten it:

```text
positionHeadroom = floor(currentCoverage × headroomBps / 10000)
```

Rules:

- Coverage drops shrink quotes; they must not brick `quote()`.
- Same-block inflows do not reopen the envelope until the next block.
- Group state uses ordinary storage, not transient storage.
- Different order hashes in the same outer transaction must share group consumption.

#### Scaling after group/coverage clamp

Compute local active reserves first. Then compute final effective output:

```text
effectiveOut = min(localActiveOut, groupRemaining, currentCoverage, positionHeadroom)
```

If `localActiveOut == 0`, return no executable liquidity or revert before any division.

If `effectiveOut < localActiveOut`, scale both sides proportionally to preserve the spot reserve ratio:

```text
effectiveIn = floor(localActiveIn × effectiveOut / localActiveOut)
```

Do not clamp only `balanceOut` — that changes the implied spot price.

#### ExactOut guard

```solidity
if (!ctx.query.isExactIn && ctx.swap.amountOut >= effectiveOut) {
    revert ActiveLiquidityExceeded(ctx.swap.amountOut, effectiveOut);
}
```

#### Wrapper execution pattern

Follow the Decay wrapper pattern:

1. Check that swap amounts have not already been computed.
2. Load/initialize local active reserves.
3. Load/initialize group envelope for `tokenOut`.
4. Compute final effective reserves (with proportional scaling).
5. Set `ctx.swap.balanceIn` and `ctx.swap.balanceOut`.
6. Call `ctx.runLoop()` so downstream instructions run.
7. If `!ctx.vm.isStaticContext`, persist:
   - post-trade local active reserves,
   - group remaining reduced by `ctx.swap.amountOut`.

State writes must not happen during quote.

### 3.2 `AquaValveOpcodes.sol`

Extend the opcode set and add Activeness dispatch:

```solidity
function _runOpcode(Context memory ctx, uint256 opcode_, bytes calldata args) internal virtual override {
    if (opcode_ == Activeness.opcode.asU8()) Activeness.exec(ctx, args);
    else super._runOpcode(ctx, opcode_, args);
}
```

### 3.3 `AquaValveRouter.sol`

Mirror the official `AquaSwapVMRouter` constructor and dispatch structure. Expose `activenessOpcode()`.

### 3.4 `AquaValveOrderBuilder.sol`

The builder only encodes program bytes. It does not call `router.hash()` and it does not ship. Hash preflight belongs in tests/scripts.

### 3.5 `DemoTaker.sol`

Fills two different Aqua orders in one outer transaction. Mandatory for proving group state persistence across order hashes.

## Phase 4 — Test Gates

Run gates in order. Do not skip ahead.

### Gate 0 — Compile

```bash
forge build
```

Zero errors. If warnings exist, document them and fix any touching core contracts.

### Gate 1 — Local λ

File: `test/ActivenessSinglePosition.t.sol`

```text
test_lambda_100_equals_XYC
test_same_block_does_not_refresh_lambda
test_split_trade_does_not_reactivate_liquidity
test_next_block_repartitions
test_exact_in_continues_on_consumed_curve
test_exact_out_above_effective_active_reverts
test_quote_does_not_mutate_state
test_reverse_direction_uses_same_local_token_state
```

For local λ epoch tests, `vm.roll` is sufficient because the epoch key is `block.number`. For Decay composition tests, also use `vm.warp` because `Decay` uses `block.timestamp`.

Run: `forge test --match-contract ActivenessSinglePosition -vvv`

### Gate 2 — Shared Γ

File: `test/ActivenessGroupEnvelope.t.sol`

```text
test_two_orders_same_tx_share_group_budget
test_coverage_drop_shrinks_quote_not_reverts
test_allowance_drop_shrinks_quote_not_reverts
test_same_block_inflow_does_not_reopen_envelope
test_group_applies_to_tokenOut_only
```

Use tight coverage so the group envelope is binding.

Run: `forge test --match-contract ActivenessGroupEnvelope -vvv`

### Gate 3 — Hash integrity

```text
test_aqua_strategy_hash_matches_router_order_hash
```

The test must ship `abi.encode(order)` through Aqua and assert:

```solidity
assertEq(aqua.ship(address(router), abi.encode(order), tokens, amounts), router.hash(order));
```

The order must set Aqua mode in `MakerTraits`. This works because in Aqua mode, `router.hash()` returns `keccak256(abi.encode(order))`, matching `aqua.ship()`'s `keccak256(strategy)`.

### Gate 4 — Decay composition

File: `test/ActivenessDecayComposition.t.sol`

```text
XYC only
DECAY + XYC
ACTIVENESS + XYC
ACTIVENESS + DECAY + XYC
```

When asserting Decay behavior over time, advance both block and timestamp:

```solidity
vm.roll(block.number + 1);
vm.warp(block.timestamp + decayPeriod / 2);
```

Using only `vm.roll` in decay tests will silently produce zero-decay results (timestamp unchanged).

Run: `forge test --match-contract ActivenessDecayComposition -vvv`

### Gate 5 — Demo

Requires prior gates green. Must show:

```text
real Aqua ship
real token transfer
local λ visualization
shared Γ failure path
coverage-drop quote shrink
optional Decay composition
```

## Phase 5 — The Graph Secondary Layer

Only after Gate 2 passes.

```solidity
event ActivenessApplied(
    bytes32 indexed orderHash,
    address indexed maker,
    bytes32 indexed groupId,
    address tokenOut,
    uint256 effectiveActiveOut,
    uint256 localActiveOut,
    uint256 groupRemaining,
    uint256 blockNumber
);
```

The Graph is a discovery/prefilter layer, not the source of truth. The authoritative executable amount is still `router.quote()` at current chain state.

## Phase 6 — Documentation

After actual command output proves status, update:

```text
README.md
FULL_EXECUTION.md
PITCH.md
TEST_PLAN.md
docs/diagrams/*.mmd
```

Every feature must be labelled:

- `Implemented` — code exists and tests pass with command output
- `In progress` — code exists, tests not yet green
- `Planned` — no code yet
- `Stretch` — depends on core being green first

## Sponsor Priority

```text
1inch / SwapVM  → execution primitive ACTIVENESS_XD       — mandatory
Aqua            → shared wallet position layer             — mandatory
The Graph       → live capacity discovery / prefiltering   — preferred secondary
World           → human step-up for exposure relaxation    — stretch only
Ledger          → hardware approval for exposure increase  — stretch only
Chainlink CRE   → private runtime headroom policy          — stretch only
Uniswap v4      → portability proof for local λ            — stretch only
```

Do not add stretch sponsors until Gate 2 passes.

## Cut Lines

If Gate 2 fails by the deadline, ship local λ only:

```text
ACTIVENESS_XD + Decay composition + benchmark
```

Do not ship half-working Γ.

If Decay composition fails, ship:

```text
ACTIVENESS_XD + local λ + shared Γ + failure-path tests
```

## Forbidden

- Do not claim tests pass without `forge test` output.
- Do not hard-code raw opcode `0x92` / `146` in builders, frontend, or tests.
- Do not rely on an `_instructions()` array; current SwapVM uses enum-based opcode dispatch.
- Do not reimplement order hash off-chain.
- Do not claim AquaValve guarantees solvency.
- Do not use World ID to secure swaps.
- Do not add sponsors as stickers.
- Do not use transient storage for group state.
- Do not ship half-working Γ.
- Do not describe `settle()` as the Aqua interface.
- Do not let `headroomBps` increase executable capacity beyond wallet coverage.
- Do not mutate Activeness state during quote/static execution.

## Completion Bar

The build is complete only when:

```text
forge build                              green
Gate 1 local λ tests                     green
Gate 2 shared Γ tests                    green
Hash integrity test                      green
Gate 4 Decay composition                 green or explicitly documented fallback
README status                            matches command output
Mermaid diagrams                         checked into repo as .mmd source
Demo script                              runnable from README/FULL_EXECUTION
```

Final command:

```bash
forge build && forge test -vvv
```
