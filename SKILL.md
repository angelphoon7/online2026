---
name: cross-gate05
description: Scaffold and run Gate 0.5 for Cross, a custom SwapVM instruction on 1inch Aqua that resizes stale virtual reserves into truthful executable reserves before pricing. Use this skill whenever the user mentions Cross, CROSS_XD, Gate 0.5, "revert to resize", executable coverage, stale sibling depth, or any work on the Aqua/SwapVM contracts, router, or Foundry tests for this project. Also use it before writing any Cross contract code, because the pinned @1inch/swap-vm version determines whether the mechanism is buildable at all.
---

# Cross — Gate 0.5

Cross is one custom SwapVM instruction. It reads the maker's real executable coverage, resizes
the strategy's reserves before downstream pricing runs, and lets a partial-fill-capable pricing
instruction settle a smaller fill instead of failing at settlement.

Gate 0.5 proves exactly one thing:

```
Aqua virtual depth 10 / real wallet coverage 6, same taker parameters both sides

  without CROSS_XD:  pricing trusts 10 → oversized Aqua.pull → REVERT
  with    CROSS_XD:  reserves resized to 6 → native partial fill → SETTLE
```

Nothing else in the project matters until this is green.

## Preflight is mandatory and blocking

**The mechanism does not exist in every version of `@1inch/swap-vm`.** Tagged releases and
`main` differ in ways that decide whether Gate 0.5 is possible at all. Run
`scripts/preflight.sh` and act on its verdict before writing a single line of contract code.

| Capability | `main` (0.0.6, Sept 2026) | `v1.0.2` / `0.0.4` |
|---|---|---|
| `XYCConcentrate` has `exec` with an output cap | **yes** | **no** — it is only a balance transform |
| `TakerTraits.allowPartialFill` | yes | no |
| Threshold scales on partial fill | yes | no |
| `libs/OpcodeList.sol`, `Opcode._92` | yes | file does not exist |

If the resolved version lacks the `XYCConcentrate` cap branch, there is no partial fill on this
path and REVERT → RESIZE is unbuildable. Repin to a version that has it — the hackathon rules
permit redeploying a modified SwapVM, so the choice of pin is free — or stop and tell the user
before building anything.

**Never assume a capability from documentation, from this skill, or from memory. Grep the
resolved source.** The version differences above were discovered only by checking out tags and
diffing them.

## Order of work

1. `scripts/preflight.sh` — resolve, pin, verify, record. Blocking.
2. Walking skeleton — router with a pass-through opcode, one real ERC-20 swap through it.
3. `CROSS_XD` minimal — coverage read and proportional resize only.
4. Fixture calibration — sweep price bounds so the control arm genuinely overshoots.
5. `test_fromRevertToResize` — the A/B test.

Do not fold group state, `openingCoverage`, sibling accounting, or `maxFillBps` into Gate 0.5.
A multi-variable test cannot diagnose its own failure.

## Traps

Each of these has already cost real time on this project. `references/traps.md` has the full
reasoning; the short version:

- **Opcode literals.** Reference `Opcode._92`, never `0x92` or `146`. Expose `crossOpcode()`
  on the router and read it from tests and frontend.
- **Constructor.** `CrossOpcodes` must invoke `AquaOpcodes(aqua)` as well as `SwapVM(...)`.
  Supplying only `SwapVM(...)` leaves `AquaOpcodes` uninitialised.
- **`allowPartialFill`.** Without it, `TakerTraits.validate` enforces `takerAmount == amountIn`
  on exact-in, so a resize that lowers `amountIn` reverts. Set it in the fixture and comment
  why.
- **`amountOut == 0` always reverts.** `TakerTraits.validate` opens with
  `require(amountOut > 0)` and is called by both `quote()` and `swap()`. A zero fill is not
  representable — an exhausted envelope must revert with a named error, never return zero.
- **A bare `return` does not halt the program.** `runLoop` sets `ctx.vm.nextPC` before dispatch
  and re-reads it after. To stop, call `ctx.setNextPC(ctx.program().length)`. The normal path
  uses `ctx.runLoop()`, matching `Decay`.
- **Saturating arithmetic only.** Never a checked subtraction against externally mutable
  balances. OpenZeppelin's audit records this exact shape in `_decayXD` as
  acknowledged-not-resolved: a persisted offset against a falling balance underflows and bricks
  both `swap()` and `quote()` permanently.
- **Scale both reserves by the same factor.** Scaling only `balanceOut` silently moves the spot
  ratio and forces the maker to quote a price they did not choose.
- **Assert the control's revert reason.** `pull()` decrements the virtual balance first — 10
  minus 8 is legal — so the revert must come from the ERC-20 transfer. A bare
  `vm.expectRevert()` passes on a misconfigured taker, a bad price bound, or a wrong opcode
  index, and you would be celebrating a failure from somewhere else.
- **Calibrate price bounds before writing the test.** `XYCConcentrate` computes output against
  `virtualOut` but caps against `balanceOut`. Bad bounds make the control arm cap itself, never
  reach settlement, and never revert — the contrast collapses.
- **`Simulator` lives in `@1inch/solidity-utils`.** A missing remapping is the most likely
  first-hour compile failure.

## Files

- `scripts/preflight.sh` — run first, every time the dependency changes
- `references/scaffold.md` — contract and test templates
- `references/traps.md` — why each trap exists, with source citations
- `references/gate05.md` — fixture, pass criteria, diagnosis order

## Reporting

When Gate 0.5 runs, report the full `forge test --match-test test_fromRevertToResize -vvvv`
output, not a summary. A bare PASS is not evidence. The log must show: the control reverting
from the ERC-20 transfer specifically; the coverage Cross read; the resized reserves and that
their ratio is preserved within rounding; and `amountIn` genuinely smaller than the taker
supplied.

If it fails, diagnose in this order: opcode index, `allowPartialFill`, price bounds, coverage
read, scaling arithmetic. Report the failure rather than working around it.
