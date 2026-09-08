// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";

/// @notice Helper contract that fills two Aqua orders in one transaction.
///         Mandatory for proving group state persistence across order hashes (invariant I7, test 2.10).
contract DemoTaker {
    ISwapVM public immutable router;

    constructor(address router_) {
        router = ISwapVM(router_);
    }

    function fillTwo(
        ISwapVM.Order calldata orderA,
        uint256 amountA,
        bytes calldata takerDataA,
        ISwapVM.Order calldata orderB,
        uint256 amountB,
        bytes calldata takerDataB
    ) external returns (
        uint256 inA, uint256 outA,
        uint256 inB, uint256 outB
    ) {
        (inA, outA,) = router.swap(orderA, amountA, takerDataA);
        (inB, outB,) = router.swap(orderB, amountB, takerDataB);
    }
}
