# Scaffold

Templates for the Gate 0.5 build. Written against `main` (0.0.6). If preflight reported
adjustments, adapt to what the resolved version actually provides rather than forcing these.

## Layout

```
src/
  Cross.sol            library — instruction body
  CrossOpcodes.sol     AquaOpcodes + dispatch override
  CrossRouter.sol      Simulator + SwapVM + CrossOpcodes
test/
  helpers/
    CrossFixture.sol   maker, taker, tokens, Aqua wiring
    HelperTaker.sol    multi-call-in-one-transaction taker (needed at Gate 1)
  Gate05_RevertToResize.t.sol
scripts/
  preflight.sh
  calibrate.s.sol      price-bound sweep
```

## Remappings

`Simulator` is in a separate package:

```solidity
import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";
```

```
@1inch/swap-vm/=lib/swap-vm/
@1inch/aqua/=lib/aqua/
@1inch/solidity-utils/=lib/solidity-utils/
@openzeppelin/=lib/openzeppelin-contracts/
```

Adjust to `node_modules/...` if installed through yarn.

## Router

```solidity
contract CrossOpcodes is AquaOpcodes, Cross {
    constructor(address aqua) AquaOpcodes(aqua) {}

    function _runOpcode(Context memory ctx, uint256 opcode, bytes calldata args)
        internal virtual override
    {
        if (opcode == uint256(Opcode._92)) _crossXD(ctx, args);
        else super._runOpcode(ctx, opcode, args);
    }
}

contract CrossRouter is Simulator, SwapVM, CrossOpcodes {
    constructor(
        address aqua, address weth, address owner,
        string memory name, string memory version
    )
        SwapVM(aqua, weth, owner, name, version)
        CrossOpcodes(aqua)          // both paths required
    {}

    function _dispatch(Context memory ctx, uint256 opcode, bytes calldata args)
        internal override
    { _runOpcode(ctx, opcode, args); }

    /// Read this from tests and frontend. Never hardcode the numeric value.
    function crossOpcode() external pure returns (uint256) {
        return uint256(Opcode._92);
    }
}
```

`AquaOpcodes._runOpcode` is `virtual`; delegating to `super` keeps every stock Aqua program
dispatching byte-identically. The extension is strictly additive.

## Walking skeleton first

Before any Cross logic, make `_crossXD` a pass-through:

```solidity
function _crossXD(Context memory ctx, bytes calldata) internal {
    ctx.runLoop();
}
```

Then prove a stock Aqua strategy executes a real ERC-20 transfer through `CrossRouter`. This
isolates every plumbing failure — remappings, constructor wiring, opcode dispatch, Aqua
addresses — from every logic failure. Do not skip it; debugging both classes at once is what
turns an hour into a day.

## CROSS_XD — Gate 0.5 minimal

Coverage read and proportional resize. No group state, no `openingCoverage`, no `maxFillBps`.

```solidity
error InsufficientSharedInventory(uint256 requested, uint256 available);

function _crossXD(Context memory ctx, bytes calldata) internal {
    address maker    = /* resolve from ctx / order */;
    address tokenOut = ctx.query.tokenOut;

    uint256 coverage = Math.min(
        IERC20(tokenOut).balanceOf(maker),
        IERC20(tokenOut).allowance(maker, address(AQUA))
    );

    // A zero fill is not representable: TakerTraits.validate opens with
    // require(amountOut > 0) and is called by both quote() and swap().
    // Revert with our own name so the reason is legible.
    if (coverage == 0) {
        revert InsufficientSharedInventory(ctx.swap.amountOut, 0);
    }

    // Scale BOTH sides by the same factor. Scaling only balanceOut moves the
    // implied spot ratio and makes the maker quote a price they did not choose.
    if (coverage < ctx.swap.balanceOut) {
        ctx.swap.balanceIn  = ctx.swap.balanceIn * coverage / ctx.swap.balanceOut;
        ctx.swap.balanceOut = coverage;
    }

    ctx.runLoop();
}
```

Reading the maker's address: take it from the execution context rather than instruction args.
Passing it in args would let a misconfigured program point Cross at the wrong wallet, and the
resize would silently be computed against someone else's balance.

## Fixture

```
maker wallet:    6 ETH  (real, approved to Aqua)
Aqua strategy:  10 ETH  (virtual, shipped)

control program:    XYCConcentrateSwap
treatment program:  CROSS_XD -> XYCConcentrateSwap

taker: exact-in
       allowPartialFill = true        <- load-bearing, see below
       realistic minOut (not zero)
       amountIn sized so pricing wants about 8 out against balanceOut = 10
```

```solidity
// Required: Cross lowers amountIn when it resizes. Without this flag
// TakerTraits.validate enforces takerAmount == amountIn on exact-in and
// the resized fill reverts on validation, not on anything Cross did.
takerTraits = takerTraits.withAllowPartialFill(true);
```

Both arms use identical taker parameters. A difference anywhere else invalidates the contrast.

## Calibrating the price bounds

Do this in a scratch script before writing the test.

`XYCConcentrate` computes `liquidity` from both balances and the bounds, then forms
`virtualIn`/`virtualOut` as the real reserves plus a liquidity-derived term. Output is computed
against `virtualOut`; the cap compares against `balanceOut`. Choose bounds badly and the
control arm produces under 10 by itself, caps itself, never reaches settlement, and never
reverts — the whole demo collapses with no error to point at.

Sweep `sqrtPriceMin`/`sqrtPriceMax` until the control arm reliably wants roughly 8 out of a
10 reserve, then hardcode the chosen pair with a comment recording the sweep.

## The test

```solidity
function test_fromRevertToResize() public {
    // CONTROL — no CROSS_XD.
    // Assert the SPECIFIC revert. pull() decrements the virtual balance first
    // (10 - 8 is legal), so the failure must come from the ERC-20 transfer.
    vm.expectRevert(/* ERC-20 insufficient balance selector or message */);
    router.swap(controlOrder, takerAmount, takerTraitsAndData);

    // TREATMENT — with CROSS_XD.
    uint256 makerBefore = weth.balanceOf(maker);
    uint256 takerBefore = weth.balanceOf(taker);

    (uint256 amountIn, uint256 amountOut,) =
        router.swap(treatmentOrder, takerAmount, takerTraitsAndData);

    assertLe(amountOut, 6 ether,                 "output exceeds real coverage");
    assertLt(amountOut, controlAttemptedOut,     "not actually resized");
    assertLt(amountIn,  takerAmount,             "taker input not reduced");
    assertEq(makerBefore - weth.balanceOf(maker), amountOut, "maker delta");
    assertEq(weth.balanceOf(taker) - takerBefore, amountOut, "taker delta");

    // Ratio preserved within integer rounding — this is what makes the demo
    // claim "depth falls, price does not" true rather than aspirational.
    assertApproxEqRel(
        resizedBalanceIn * 1e18 / resizedBalanceOut,
        originalBalanceIn * 1e18 / originalBalanceOut,
        1e12,
        "spot ratio moved"
    );

    emit log("+------------------------------------+");
    emit log("|       FROM REVERT TO RESIZE        |");
    emit log("+------------------------------------+");
    // virtual depth, real coverage, control result, treatment result, output
}
```

The summary block becomes a README screenshot. Emit it from the test rather than
reconstructing it by hand later.
