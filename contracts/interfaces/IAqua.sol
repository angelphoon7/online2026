// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAqua {
    function safeBalances(
        address maker,
        bytes32 orderHash,
        address tokenIn,
        address tokenOut
    ) external view returns (uint256 reserveIn, uint256 reserveOut);

    function settle(
        address maker,
        address taker,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        bytes32 orderHash
    ) external;
}
