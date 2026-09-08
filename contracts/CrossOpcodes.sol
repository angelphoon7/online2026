// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode, OpcodeOps } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { AquaOpcodes } from "@1inch/swap-vm/src/opcodes/AquaOpcodes.sol";

import { Cross } from "./Cross.sol";

/// @notice AquaOpcodes + CROSS_XD dispatch
contract CrossOpcodes is AquaOpcodes, Cross {
    using OpcodeOps for Opcode;

    constructor(address aqua) Cross(aqua) {}

    function _runOpcode(Context memory ctx, uint256 opcode_, bytes calldata args)
        internal
        virtual
        override
    {
        if (opcode_ == Opcode._92.asU8()) _crossXD(ctx, args);
        else super._runOpcode(ctx, opcode_, args);
    }
}
