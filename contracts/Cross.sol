// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { Context, ContextLib } from "@1inch/swap-vm/src/libs/VM.sol";

/// @notice CROSS_XD — Gate 0.5 minimal: coverage read + proportional resize
/// @dev No group state, no openingCoverage, no maxFillBps. Those come at Gate 1.
abstract contract Cross {
    using ContextLib for Context;

    address internal immutable _aqua;

    error InsufficientSharedInventory(uint256 requested, uint256 available);

    constructor(address aqua) {
        _aqua = aqua;
    }

    /// @notice Executable coverage: min(wallet balance, allowance to Aqua)
    function coverage(address maker, address token) public view returns (uint256) {
        return Math.min(
            IERC20(token).balanceOf(maker),
            IERC20(token).allowance(maker, _aqua)
        );
    }

    /// @dev CROSS_XD execution — coverage read and proportional resize only
    function _crossXD(Context memory ctx, bytes calldata) internal {
        address maker = ctx.query.maker;
        address tokenOut = ctx.query.tokenOut;

        uint256 cov = coverage(maker, tokenOut);

        // A zero fill is not representable: TakerTraits.validate opens with
        // require(amountOut > 0) and is called by both quote() and swap().
        if (cov == 0) {
            revert InsufficientSharedInventory(ctx.swap.amountOut, 0);
        }

        // Scale BOTH sides by the same factor. Scaling only balanceOut moves the
        // implied spot ratio and makes the maker quote a price they did not choose.
        if (cov < ctx.swap.balanceOut) {
            ctx.swap.balanceIn = ctx.swap.balanceIn * cov / ctx.swap.balanceOut;
            ctx.swap.balanceOut = cov;
        }

        ctx.runLoop();
    }
}
