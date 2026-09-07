// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

struct Order {
    address maker;
    address tokenIn;
    address tokenOut;
    uint256 reserveIn;
    uint256 reserveOut;
    bytes32 groupId;
    uint256 activenessNumerator; // λ as fraction of 1e18 (1e18 = 100%)
    bytes   strategyBytes;
}

struct LocalState {
    uint256 blockNumber;
    uint256 activeReserveIn;
    uint256 activeReserveOut;
}

struct GroupState {
    uint256 blockNumber;
    uint256 openingCoverage;
    uint256 remaining;
}
