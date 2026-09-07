// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode, OpcodeOps } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { AquaOpcodes } from "@1inch/swap-vm/src/opcodes/AquaOpcodes.sol";

import { Activeness } from "./Activeness.sol";

/// @notice Extended Aqua opcodes with ACTIVENESS_XD
contract AquaValveOpcodes is AquaOpcodes {
    using OpcodeOps for Opcode;

    function _runOpcode(Context memory ctx, uint256 opcode_, bytes calldata args) internal virtual override {
        if (opcode_ == Activeness.opcode.asU8()) Activeness.exec(ctx, args);
        else super._runOpcode(ctx, opcode_, args);
    }
}
