---
name: cross-build
summary: Build and test Cross — shared-inventory market making on 1inch Aqua via a custom SwapVM instruction.
description: Use this skill to build Cross against the real 1inch Aqua and SwapVM sources. Covers Foundry setup, CROSS_XD instruction, group envelope, coverage-based quote scaling, same-tx group budget sharing, Decay composition, The Graph capacity layer, diagrams, and hackathon demo discipline.
---

# Cross Build Skill

## Accuracy Contract

This skill is written against the currently inspected public 1inch sources:

- `1inch/aqua`
- `1inch/swap-vm`
- `1inch/sdks/tree/master/typescript/aqua`

Do not treat GitHub `main` as stable. At the start of implementation, record the exact commit SHAs used for `aqua`, `swap-vm`, `solidity-utils`, and `openzeppelin-contracts` in `README.md` or `IMPLEMENTATION_STATUS.md`.

Do **not** claim compile, test, deploy, or demo success unless command output proves it.

## Mission

Build a working Cross: a custom Aqua app and SwapVM extension where multiple strategies share one real inventory envelope.

Core claim:

> Cross margin for DeFi: one balance behind every position, enforced inside the swap.

Technical claim:

> AMMs made price programmable. Cross makes inventory programmable.

## First Actions

Before writing code:

1. Read `AGENTS.md` for non-negotiable project semantics and test gates.
2. Read `CROSS_SPEC.md` for the full technical specification.
3. Check Foundry:
   ```bash
   forge --version
   ```
4. Check the repo tree and identify existing frontend/docs/contracts/tests.
5. Install real dependencies or verify they already exist:
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
6. Inspect the exact local source files before coding:
   ```text
   lib/aqua/src/interfaces/IAqua.sol
   lib/aqua/src/Aqua.sol
   lib/swap-vm/src/SwapVM.sol
   lib/swap-vm/src/libs/VM.sol
   lib/swap-vm/src/libs/OpcodeList.sol
   lib/swap-vm/src/opcodes/AquaOpcodes.sol
   lib/swap-vm/src/opcodes/Opcodes.sol
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

### 1.3 Configure remappings

Use package-root remappings. The official imports include paths such as `@1inch/aqua/src/interfaces/IAqua.sol`.

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

If this fails before adding Cross code, fix dependency/remapping/compiler issues first.

## Phase 2 — Real Aqua / SwapVM Integration

### 2.1 Use official Aqua functions

```solidity
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
```

Relevant functions in the official interface:

```solidity
function ship(address app, bytes calldata strategy, address[] calldata tokens, uint256[] calldata amounts) external returns (bytes32 strategyHash);
function dock(address app, bytes32 strategyHash, address[] calldata tokens) external;
function pull(address maker, bytes32 strategyHash, address token, uint256 amount, address to) external;
function push(address maker, address app, bytes32 strategyHash, address token, uint256 amount) external;
```

### 2.2 Use official SwapVM order/hash semantics

Import official SwapVM types:

```solidity
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { Context, ContextLib } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { Opcodes } from "@1inch/swap-vm/src/opcodes/Opcodes.sol";
import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";
```

For Aqua-mode orders, `router.hash(order)` is the canonical hash. Use it as the source of truth. Do not independently reimplement order hashing off-chain.

### 2.3 Correct SwapVM context facts

`quote()` sets `ctx.vm.isStaticContext = true`. `swap()` sets it `false`.

Your custom instruction must obey `isStaticContext` and never write during quote.

### 2.4 Real SwapVM instruction pattern

Study `lib/swap-vm/src/instructions/Decay.sol` — it is the closest pattern to what Cross needs (stateful, per-order per-token storage, wraps `ctx.runLoop()`).

The opcode dispatcher compares the opcode to enum values and calls the corresponding handler.

## Phase 3 — Core Contracts

Build in this order. Each contract must compile before starting the next.

### 3.1 `Cross.sol` — CROSS_XD

`CROSS_XD` is a balances-tuning wrapper instruction. It must run before downstream pricing computes the missing swap amount.

Opcode slot:

```solidity
Opcode constant opcode = Opcode._92;
```

#### Args encoding

```text
Ungrouped:  [ groupId : 8 ]
With headroom: [ groupId : 8 ][ headroomBps : 2 ]
```

Where:
- `groupId` — uint64, identifies the shared inventory group
- `headroomBps` — uint16, 0 = no tightening, 1-10000 = tighten access

#### State

```solidity
struct GroupEpoch {
    uint64  lastBlock;
    uint96  openingCoverage;
    uint96  consumed;
}

mapping(address maker => mapping(uint64 groupId => mapping(address token => GroupEpoch))) internal _groups;
```

Storage class is normative. MUST be ordinary persistent storage. MUST NOT be transient storage. MUST NOT be keyed by `orderHash`.

#### Coverage

```solidity
function coverage(address maker, address token) public view returns (uint256) {
    return Math.min(
        IERC20(token).balanceOf(maker),
        IERC20(token).allowance(maker, _aqua)
    );
}
```

#### Execution semantics (spec §5.4 steps 1-9)

1. Parse and validate arguments.
2. Epoch resolution: snapshot openingCoverage on first execution in a block.
3. Envelope ceiling: `cap = min(openingCoverage, currentCoverage)`, apply headroom.
4. Remaining envelope: saturating `cap - consumed`.
5. Zero-envelope short circuit: exact-in returns 0, exact-out reverts named.
6. Proportional scaling: both sides by the same factor.
7. Exact-out guard: against post-scaling balanceOut.
8. Run downstream instructions via `ctx.runLoop()`.
9. Persist consumed on real execution path only.

#### Required error

```solidity
error InsufficientSharedInventory(uint256 requested, uint256 available);
```

#### Required event

```solidity
event SharedInventoryConsumed(
    address indexed maker,
    uint64 indexed groupId,
    address indexed tokenOut,
    uint256 realisedAmountOut,
    uint256 remaining
);
```

### 3.2 `CrossOpcodes.sol`

Extend the opcode set and add Cross dispatch:

```solidity
contract CrossOpcodes is Opcodes, Cross {
    constructor(address aqua) Cross(aqua) {}

    function _runOpcode(Context memory ctx, uint256 opcode_, bytes calldata args) internal virtual override {
        if (opcode_ == Opcode._92.asU8()) _crossXD(ctx, args);
        else super._runOpcode(ctx, opcode_, args);
    }
}
```

### 3.3 `CrossRouter.sol`

Mirror the official `AquaSwapVMRouter` constructor and dispatch structure. Expose `crossOpcode()`.

### 3.4 `DemoTaker.sol`

Fills two different Aqua orders in one outer transaction. Mandatory for proving group state persistence across order hashes (invariant I7, test 2.10).

## Phase 4 — Test Gates

Run gates in order. Do not skip ahead.

### Gate 0 — Compile

```bash
forge build
```

Zero errors. If warnings exist, document them and fix any touching core contracts.

### Gate 1 — Single-strategy

File: `test/Cross.t.sol`

```text
test_unbound_envelope_matches_plain_program
test_first_execution_initialises_epoch
test_second_same_block_execution_uses_stored_consumption
test_split_trade_cannot_reopen_envelope
test_next_block_refreshes_from_current_coverage
test_quote_does_not_mutate_state
```

For envelope epoch tests, `vm.roll` is sufficient because the epoch key is `block.number`. For Decay composition tests, also use `vm.warp` because Decay uses `block.timestamp`.

### Gate 2 — Shared inventory

```text
test_siblings_share_one_envelope
test_fill_on_one_shrinks_all_siblings_same_block
test_coverage_drop_shrinks_quote_not_reverts
test_allowance_drop_shrinks_quote_not_reverts
test_same_block_inflow_does_not_replenish
test_distinct_group_ids_do_not_share
test_headroom_only_tightens
test_two_orders_same_tx_share_group_budget
```

Test `two_orders_same_tx_share_group_budget` uses `DemoTaker` with real Solidity helper contract.

### Gate 3 — Aqua integration / Hash integrity

```text
test_shipped_key_equals_router_resolved_key
test_fill_moves_real_erc20_between_maker_and_taker
```

### Gate 4 — Decay composition

```text
test_xyc_baseline
test_cross_then_xyc
test_cross_then_decay_then_xyc
```

When asserting Decay behavior over time, advance both block and timestamp:

```solidity
vm.roll(block.number + 1);
vm.warp(block.timestamp + decayPeriod / 2);
```

## Phase 5 — The Graph Secondary Layer

Only after Gate 2 passes.

```solidity
event SharedInventoryConsumed(
    address indexed maker,
    uint64 indexed groupId,
    address indexed tokenOut,
    uint256 realisedAmountOut,
    uint256 remaining
);
```

The Graph is a discovery/prefilter layer, not the source of truth. The authoritative executable amount is `router.quote()` at current chain state.

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
1inch / SwapVM  → execution primitive CROSS_XD              — mandatory
Aqua            → shared wallet position layer               — mandatory
The Graph       → live capacity discovery / prefiltering     — preferred secondary
Ledger          → stretch only
Chainlink CRE   → stretch only
Uniswap v4      → stretch only
```

Do not add stretch sponsors until Gate 2 passes.

## Cut Lines

If Gate 2 fails by the deadline, the grouped envelope is removed and CROSS_XD ships as a single-strategy wrapper, with the pitch reduced accordingly.

Do not ship half-working group state.

## Forbidden

- Do not claim tests pass without `forge test` output.
- Do not hard-code raw opcode `0x92` / `146` in builders, frontend, or tests.
- Do not rely on an `_instructions()` array; current SwapVM uses enum-based opcode dispatch.
- Do not reimplement order hash off-chain.
- Do not claim Cross guarantees solvency.
- Do not use transient storage for group state.
- Do not key group state by `orderHash`.
- Do not ship half-working group state.
- Do not describe `settle()` as the Aqua interface.
- Do not let `headroomBps` increase executable capacity beyond wallet coverage.
- Do not mutate Cross state during quote/static execution.
- Do not scale only `balanceOut` without `balanceIn` — that changes the spot ratio.
- Do not pass zero reserves to downstream XYC — use the zero-envelope short circuit.

## Completion Bar

The build is complete only when:

```text
forge build                              green
Gate 1 single-strategy tests             green
Gate 2 shared inventory tests            green
Gate 3 hash/integration tests            green
Gate 4 Decay composition                 green or explicitly documented fallback
README status                            matches command output
Mermaid diagrams                         checked into repo as .mmd source
Demo script                              runnable from README/FULL_EXECUTION
```

Final command:

```bash
forge build && forge test -vvv
```
