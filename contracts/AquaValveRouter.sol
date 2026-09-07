// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";

import { AquaValveOpcodes } from "./AquaValveOpcodes.sol";

/// @title AquaValveRouter
/// @notice Aqua SwapVM Router extended with ACTIVENESS_XD for programmable live liquidity
contract AquaValveRouter is Simulator, SwapVM, AquaValveOpcodes {
    constructor(
        address aqua,
        address weth,
        address owner,
        string memory name,
        string memory version
    ) SwapVM(aqua, weth, owner, name, version) {}

    function _dispatch(Context memory ctx, uint256 opcode_, bytes calldata args) internal override {
        _runOpcode(ctx, opcode_, args);
    }
}
