// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Order} from "./lib/SwapVMTypes.sol";
import {AquaValveRouter} from "./AquaValveRouter.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/// @notice Test helper that fills two orders in one transaction to prove shared Γ.
contract DemoTaker {
    AquaValveRouter public immutable router;

    constructor(address _router) {
        router = AquaValveRouter(_router);
    }

    function fillTwoOrders(
        Order calldata orderA,
        uint256 amountInA,
        Order calldata orderB,
        uint256 amountInB
    ) external returns (uint256 outA, uint256 outB) {
        // Approve router to pull taker's tokenIn
        IERC20(orderA.tokenIn).approve(address(router), amountInA + amountInB);

        outA = router.swap(orderA, amountInA);
        outB = router.swap(orderB, amountInB);
    }

    function fillSingleOrder(Order calldata order, uint256 amountIn)
        external
        returns (uint256 amountOut)
    {
        IERC20(order.tokenIn).approve(address(router), amountIn);
        amountOut = router.swap(order, amountIn);
    }
}
