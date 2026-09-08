// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode, OpcodeOps } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { Opcodes } from "@1inch/swap-vm/src/opcodes/Opcodes.sol";

import { Cross } from "./Cross.sol";

/// @notice Extended opcode set: all stock SwapVM instructions + CROSS_XD
contract CrossOpcodes is Opcodes, Cross {
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
