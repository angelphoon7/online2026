// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode, OpcodeOps } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";

import { CrossOpcodes } from "./CrossOpcodes.sol";

/// @title CrossRouter
/// @notice SwapVM Router extended with CROSS_XD for shared-inventory market making
contract CrossRouter is Simulator, SwapVM, CrossOpcodes {
    using OpcodeOps for Opcode;

    constructor(
        address aqua,
        address weth,
        address owner,
        string memory name,
        string memory version
    )
        SwapVM(aqua, weth, owner, name, version)
        CrossOpcodes(aqua)
    {}

    function _dispatch(Context memory ctx, uint256 opcode_, bytes calldata args) internal override {
        _runOpcode(ctx, opcode_, args);
    }

    /// @notice Returns the opcode index used by CROSS_XD. Read from tests and frontend.
    function crossOpcode() external pure returns (uint256) {
        return Opcode._92.asU8();
    }
}
