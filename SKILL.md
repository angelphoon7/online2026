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

## Mission

Build a working AquaValve: a custom Aqua app and SwapVM extension where liquidity liveness is programmable.

Core claim:

> Liquidity doesn't have to be all-in. AquaValve lets a maker decide how much goes live each block.

Technical claim:

> AMMs made price programmable. AquaValve makes liveness programmable.

## Scope Guard

Whenever this skill is active, if the user proposes any feature not in the gates below, respond with:

> "Noted in IDEAS.md. Not doing it before Gate N+1."

Do not analyze the merit of the proposal. Do not start exploratory code. Log it and move on.

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
5. **Log the resolved versions before pinning.** Record the actual commit SHAs and opcode count:
   ```bash
   git -C lib/swap-vm rev-parse HEAD
   git -C lib/aqua rev-parse HEAD
   grep -c "Opcode\." lib/swap-vm/src/libs/OpcodeList.sol
   ```
   From this point on, read the opcode table from **that installed source**, not from docs or READMEs.
6. Inspect the exact local source files before coding:
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
7. Do not redesign the project during M0. The first objective is `forge build`.

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

- `optimizer_runs = 700` follows the current SwapVM project style. Do not claim bytecode equivalence to official deployments unless the exact compiler settings and commits match.
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

Aqua stores virtual balances by `maker → app/router → strategyHash/orderHash → token`. Token transfer happens through `pull()` (maker→taker) and `push()` (taker→maker). Tokens never sit in the Aqua contract.

### 2.2 Use official SwapVM order/hash semantics

Import official SwapVM types:

```solidity
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { Context, ContextLib } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { AquaOpcodes } from "@1inch/swap-vm/src/opcodes/AquaOpcodes.sol";
import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";
```

For Aqua-mode orders, `router.hash(order)` is the canonical hash. Use it as the source of truth. Do not independently reimplement order hashing off-chain.

### 2.3 SwapVM context semantics

`quote()` sets `ctx.vm.isStaticContext = true`. `swap()` sets it `false`.

- `true` = quote/static execution path, do not persist state.
- `false` = swap/state-changing path, may persist local and group state.

Your custom instruction must obey `isStaticContext` and never write during quote.

### 2.4 Real SwapVM instruction pattern

Study `lib/swap-vm/src/instructions/Decay.sol` — it is the closest pattern to what Activeness needs (stateful, per-order, per-token storage, wraps `ctx.runLoop()`).

Instructions are wired through `_runOpcode(...)` in the opcode dispatcher, dispatching by comparing the opcode to `Opcode.X`.

## Invariants

These are non-negotiable. Every invariant must have at least one Foundry test that fails if violated.

**Invariant 1 — λ = 100% is a no-op.** Output must match vanilla XYC exactly.

**Invariant 2 — Same-block trades never get a fresh active slice.** They continue on the consumed curve.

**Invariant 3 — Coverage drops shrink quotes, never brick them.** `quote()` must return a smaller amount, not revert.

**Invariant 4 — Same-block inflows do not reopen the group envelope.** New deposits in the same block are ignored until next block.

**Invariant 5 — Group state is shared across order hashes in the same transaction.** Order B must see Order A's consumption within the same outer tx. Group state is keyed by `maker + groupId + token` in ordinary storage (not by orderHash, not transient). In M0, `groupId` defaults to `orderHash` — each position has its own envelope. Explicit cross-position grouping (multiple positions sharing one `groupId`) is a post-M4 feature.

**Invariant 6 — quote() has zero state side effects.** All state slots must be unchanged after any number of quote calls.

**Invariant 7 — Proportional scaling preserves spot ratio.** When Γ, coverage, or headroom clamps `effectiveOut` below `localActiveOut`, scale `effectiveIn` proportionally: `effectiveIn = floor(localActiveIn × effectiveOut / localActiveOut)`. Clamping only the output side silently distorts the spot price and forces the maker to quote at a wrong ratio.

**Invariant 8 — Tightening is unconditional; relaxation is a permission upgrade.** `headroomBps` can only tighten the envelope, never increase it beyond wallet coverage. Any relaxation path (λ increase, Γ expansion, groupId change) is not implemented in V1 — it requires Aqua `dock()` + `ship()`. The router cannot intercept or implement relaxation. Do not attempt to add relaxation logic to the router.

**Invariant 9 — Foundry tests are the only proof.** The `two_orders_same_tx_share_group_budget` test and all other gate tests must pass in Foundry against the pinned source. Model tests, JS tests, and "the logic looks right" do not count as green.

## Phase 3 — Core Contracts

Build in this order. Each contract must compile before starting the next.

### 3.1 `Activeness.sol` — ACTIVENESS_XD

`ACTIVENESS_XD` is a balances-tuning wrapper instruction. It must run before downstream pricing computes the missing swap amount.

Recommended opcode slot for the vendored source:

```solidity
uint256 internal constant ACTIVENESS_OPCODE = uint256(Opcode._92);
```

Current `OpcodeList.sol` places `_92` and `_93` in the `0x90-0xaf` Balances tuning bank. Do not hard-code raw numeric `0x92` or `146` in builders/tests. Expose:

```solidity
function activenessOpcode() external pure returns (uint8) {
    return uint8(ACTIVENESS_OPCODE);
}
```

If the installed SwapVM version changes, re-check `OpcodeList.sol` before using `_92`.

#### Args encoding

Use compact BPS values:

```text
args = abi.encodePacked(lambdaBps, headroomBps, groupId)
```

Where:

```text
lambdaBps   uint16, 1..10000
headroomBps uint16, 1..10000  (10000 = no tightening)
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
```

The group envelope applies to `ctx.query.tokenOut` (the token the maker sends out). Do not consume group budget for `tokenIn`.

Executable coverage:

```solidity
uint256 coverage = Math.min(
    IERC20(tokenOut).balanceOf(ctx.query.maker),
    IERC20(tokenOut).allowance(ctx.query.maker, address(AQUA))
);
```

`headroomBps` can only tighten:

```text
positionHeadroom = floor(currentCoverage × headroomBps / 10000)
```

Rules:

- Coverage drops shrink quotes; they must not brick `quote()`.
- Same-block inflows do not reopen the envelope until the next block.
- Group state uses ordinary storage, not transient storage.
- Different order hashes in the same outer transaction must share group consumption.

#### Scaling after group/coverage clamp (Invariant 7)

Compute local active reserves first. Then compute final effective output:

```text
effectiveOut = min(localActiveOut, groupRemaining, currentCoverage, positionHeadroom)
```

If `effectiveOut < localActiveOut`, scale both sides proportionally:

```text
effectiveIn = floor(localActiveIn × effectiveOut / localActiveOut)
```

Do not clamp only `balanceOut` — that changes the implied spot price.

If the final reserves are zero, return no executable liquidity or revert with a named error; do not underflow or panic.

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
function _runOpcode(Context memory ctx, uint256 opcode, bytes calldata args) internal virtual override {
    if (opcode == ACTIVENESS_OPCODE) _activenessXD(ctx, args);
    else super._runOpcode(ctx, opcode, args);
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

**"Green" for Gate 2 means:** `test_two_orders_same_tx_share_group_budget` passes in Foundry against the pinned template. Not model tests. Not "the logic looks right." If this test is not green by the deadline, delete all Γ-related code and update the pitch to local-only version. No middle state.

Run: `forge test --match-contract ActivenessGroupEnvelope -vvv`

### Gate 3 — Hash integrity

```text
test_aqua_strategy_hash_matches_router_order_hash
```

`router.hash(order)` is the **only** source of truth. It uses EIP-712 structured encoding (ORDER_TYPEHASH + maker + traits + keccak256(data)), NOT `abi.encode(order)`.

The correct test flow:

1. Compute `bytes32 orderHash = router.hash(order)`.
2. Use `orderHash` as the key when shipping to Aqua.
3. Assert that `router.swap()` can fill the position — proving the hash the router uses at swap time matches the hash used at ship time.

Do **not** independently recompute the hash formula. Do **not** pass `abi.encode(order)` as `strategy` to `aqua.ship()` and compare with `router.hash()` — they use different encoding and will never match. A wrong hash silently produces a position no one can ever fill while tests appear green.

### Gate 4 — Decay composition

File: `test/ActivenessDecayComposition.t.sol`

```text
XYC only
DECAY + XYC
ACTIVENESS + XYC
ACTIVENESS + DECAY + XYC
```

**Block vs time advancement:** λ epoch uses `block.number` — use `vm.roll`. Decay uses `block.timestamp` — use `vm.warp`. In composition tests, advance both:

```solidity
vm.roll(block.number + 1);
vm.warp(block.timestamp + decayPeriod);
```

Using only `vm.roll` in decay tests will silently produce zero-decay results (timestamp unchanged), making it look like decay has no effect.

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
- Do not implement relaxation paths (λ increase, Γ expand) in the router. V1 relaxation goes through Aqua dock+reship.
- Do not cite unverifiable paper references. Base claims on code and test output only.

## Completion Bar

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
