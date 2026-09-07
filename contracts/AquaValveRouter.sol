// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAqua} from "./interfaces/IAqua.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {Order} from "./lib/SwapVMTypes.sol";
import {Activeness} from "./Activeness.sol";

contract AquaValveRouter {
    IAqua public immutable aquaProtocol;
    Activeness public immutable activeness;

    error ZeroAmount();

    constructor(address _aqua, address _activeness) {
        aquaProtocol = IAqua(_aqua);
        activeness = Activeness(_activeness);
    }

    function hash(Order calldata order) external pure returns (bytes32) {
        return keccak256(abi.encode(
            order.maker,
            order.tokenIn,
            order.tokenOut,
            order.reserveIn,
            order.reserveOut,
            order.groupId,
            order.activenessNumerator,
            order.strategyBytes
        ));
    }

    /// @notice Quote path — returns expected output with no state mutation.
    function quote(Order calldata order, uint256 amountIn)
        external
        view
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert ZeroAmount();

        bytes32 orderHash = keccak256(abi.encode(
            order.maker, order.tokenIn, order.tokenOut,
            order.reserveIn, order.reserveOut, order.groupId,
            order.activenessNumerator, order.strategyBytes
        ));

        // ACTIVENESS_XD: compute effective reserves (read-only)
        (uint256 effectiveIn, uint256 effectiveOut) = activeness.computeEffectiveReserves(
            orderHash,
            order.maker,
            order.tokenIn,
            order.tokenOut,
            order.reserveIn,
            order.reserveOut,
            order.activenessNumerator,
            order.groupId
        );

        // XYC_SWAP: constant-product pricing
        amountOut = _xycSwap(effectiveIn, effectiveOut, amountIn);
    }

    /// @notice Swap path — applies activeness, persists state, executes settlement.
    function swap(Order calldata order, uint256 amountIn)
        external
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert ZeroAmount();

        bytes32 orderHash = keccak256(abi.encode(
            order.maker, order.tokenIn, order.tokenOut,
            order.reserveIn, order.reserveOut, order.groupId,
            order.activenessNumerator, order.strategyBytes
        ));

        // Initialize group state for this block if needed
        activeness.initGroupState(order.maker, order.groupId, order.tokenOut);

        // ACTIVENESS_XD: compute effective reserves (read-only first for pricing)
        (uint256 effectiveIn, uint256 effectiveOut) = activeness.computeEffectiveReserves(
            orderHash,
            order.maker,
            order.tokenIn,
            order.tokenOut,
            order.reserveIn,
            order.reserveOut,
            order.activenessNumerator,
            order.groupId
        );

        // XYC_SWAP: constant-product pricing
        amountOut = _xycSwap(effectiveIn, effectiveOut, amountIn);

        // ACTIVENESS_XD: persist state (reverts if liquidity exceeded)
        activeness.applyActiveness(
            orderHash,
            order.maker,
            order.tokenIn,
            order.tokenOut,
            order.reserveIn,
            order.reserveOut,
            order.activenessNumerator,
            order.groupId,
            amountIn,
            amountOut
        );

        // Settlement: transfer tokens
        IERC20(order.tokenIn).transferFrom(msg.sender, order.maker, amountIn);
        IERC20(order.tokenOut).transferFrom(order.maker, msg.sender, amountOut);
    }

    /// @notice XYC constant-product swap: amountOut = (reserveOut * amountIn) / (reserveIn + amountIn)
    function _xycSwap(uint256 reserveIn, uint256 reserveOut, uint256 amountIn)
        internal
        pure
        returns (uint256)
    {
        return (reserveOut * amountIn) / (reserveIn + amountIn);
    }
}
