# Traps

Each entry cost real time on this project or was caught only by reading source. Cited so a
future reader can re-verify rather than trusting this file.

---

## Version differences are not cosmetic

Tagged releases and `main` differ in whether the mechanism exists.

At `v1.0.2` and `0.0.4`, `XYCConcentrate.sol` contains only
`_xycConcentrateGrowLiquidity2D` — a balance transform. There is no `exec`, no `isExactIn`
branch, no output cap. Pricing is left to `XYCSwap`, which has no cap in any version. So on
those tags there is no partial fill on this path at all, and REVERT → RESIZE is unbuildable.

Those tags also have no `src/libs/OpcodeList.sol`, so `Opcode._92` does not compile, and no
`allowPartialFill` in `TakerTraits`.

On `main` (0.0.6, commit `f09a41e`, 2026-09-03) all three are present.

**Consequence:** run `scripts/preflight.sh` on the resolved dependency before writing code, and
re-run it whenever the pin changes. Never infer a capability from this document.

---

## `allowPartialFill` is load-bearing on exact-in

`TakerTraits.validate` (main):

```solidity
if (traits.isExactIn()) {
    if (traits.allowPartialFill()) {
        require(takerAmount >= amountIn, TakerTraitsTakerAmountInExceed(...));
    } else {
        require(takerAmount == amountIn, TakerTraitsTakerAmountInMismatch(...));
    }
```

Cross lowers `amountIn` when it resizes. Without the flag the equality branch applies and the
resized fill reverts on validation — a failure that looks like "Cross does not work" but is
entirely the taker's configuration.

Comment the flag at the point it is set. Three days later it reads like boilerplate and gets
deleted.

---

## `amountOut == 0` always reverts, in quote as well as swap

```solidity
function validate(...) internal view {
    require(amountOut > 0, TakerTraitsAmountOutMustBeGreaterThanZero(amountOut));
```

`SwapVM.quote()` and `SwapVM.swap()` both call it. A successful zero-amount fill therefore
cannot be represented at any layer, regardless of `allowPartialFill`.

So an exhausted envelope must revert with a named error. "Exact-in returns zero without
reverting" is not implementable.

This does not make the position brittle: Cross persists nothing that outlives the condition, so
the strategy is executable again once coverage returns. That is the difference from the
`_decayXD` underflow, where persisted offsets disable the order permanently.

---

## A bare `return` does not halt the program

```solidity
ctx.vm.nextPC = pcs;                  // advanced BEFORE dispatch
ctx.vm.dispatch(ctx, opcode, args);
pcs = ctx.vm.nextPC;                  // re-read AFTER
```

Returning from an instruction leaves `nextPC` pointing at the next one, and the loop continues
into downstream pricing. To stop, call `ctx.setNextPC(ctx.program().length)` (`VM.sol:105`).

Cross's normal path calls `ctx.runLoop()`, which consumes the remainder and leaves `nextPC` at
the end — the same pattern `Decay` uses.

---

## Saturating arithmetic, always

OpenZeppelin's audit of SwapVM records that `_decayXD` subtracts a persisted offset from a
balance with a checked subtraction. When the balance falls independently, the subtraction
underflows and reverts, disabling both `swap()` and `quote()` for that order. Status:
acknowledged, not resolved.

Cross reads two externally mutable quantities — wallet balance and allowance. Any checked
subtraction against them reproduces the same permanent brick.

At Gate 1, saturation applies to `openingCoverage - consumed`, never to live coverage. Live
coverage enters only through the `min`.

---

## The double-count, at Gate 1

```
remaining = min(openingCoverage - consumed, currentCoverage)     correct
remaining = min(openingCoverage, currentCoverage) - consumed     wrong
```

With wallet 10 and a 4 ETH fill: `currentCoverage` is already 6, so subtracting `consumed`
from it charges the same tokens twice and yields 2 where the answer is 6.

The wrong form reads perfectly natural, which is why it was written in the first place. It
would have presented as a SwapVM or Aqua integration fault.

Not reachable at Gate 0.5, which has no `consumed`.

---

## Scale both reserves

Scaling only `balanceOut` changes `balanceIn / balanceOut`, which is the implied spot price.
The maker ends up quoting a rate they never chose. Scaling both by the same factor reduces
depth and leaves the ratio intact — the difference between "shallower" and "wrong".

Assert the ratio in the test. Without an assertion, a later refactor drops back to the
one-sided form and every other test still passes.

---

## Assert the control's revert reason

`Aqua.pull()`:

```solidity
balance.store(prevBalance - amount.toUint248(), tokensCount);
IERC20(token).safeTransferFrom(maker, to, amount);
```

The virtual decrement happens first and 10 minus 8 is legal, so the control's revert must come
from the transfer finding the wallet short.

A bare `vm.expectRevert()` passes on a misconfigured taker, wrong price bounds, or a bad opcode
index. You would record a green Gate 0.5 for a failure that came from somewhere else entirely.

---

## Price bounds decide whether the control arm reverts at all

`XYCConcentrate` computes output against `virtualOut` (real reserves plus a liquidity-derived
term) but caps against `balanceOut`. If the bounds make the control arm produce under 10 by
itself, it caps itself, never reaches settlement, and never reverts. Both arms succeed and the
contrast is gone — with no error message pointing at the cause.

Sweep the bounds in a scratch script first.

---

## `safeBalances` does not clamp — this is the whole premise

```solidity
function safeBalances(...) external view returns (uint256 balance0, uint256 balance1) {
    (uint248 amount0, uint8 tokensCount0) = _balances[maker][app][strategyHash][token0].load();
    require(tokensCount0 > 0 && tokensCount0 != _DOCKED, SafeBalancesForTokenNotInActiveStrategy(...));
    balance0 = amount0;
```

"Safe" means the strategy is active and not docked. It returns the virtual balance with no
reference to what the wallet holds.

If it clamped to real coverage, the control arm would not revert and Cross would be redundant.
Re-verify this whenever the Aqua pin changes — it is the single assumption the project rests
on.

---

## Constructor and imports

`AquaOpcodes` takes `aqua` in its own constructor. `SwapVM(...)` alone leaves it
uninitialised — the official `AquaSwapVMRouter` invokes both.

`Simulator` is in `@1inch/solidity-utils`, a different package from `@1inch/swap-vm`. A missing
remapping is the most common first-hour compile failure and produces an unhelpful error.
