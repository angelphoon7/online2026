// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { Context, ContextLib } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode, OpcodeOps } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { MemoryPtr, MemoryPtrLib } from "@1inch/swap-vm/src/libs/MemoryPtr.sol";
import { InstructionBuilder } from "@1inch/swap-vm/src/libs/InstructionBuilder.sol";
import { InstructionArgs } from "@1inch/swap-vm/src/libs/InstructionArgs.sol";

/// @notice Instruction builder for CROSS_XD
library CrossBuilder {
    using OpcodeOps for Opcode;
    using MemoryPtrLib for MemoryPtr;
    using InstructionBuilder for MemoryPtr;

    Opcode constant opcode = Opcode._92;

    function build(uint64 groupId) internal pure returns (bytes memory) {
        uint256 size = InstructionBuilder.sizeOf() + 8;
        MemoryPtr ptrStart = MemoryPtrLib.alloc(size);
        MemoryPtr ptr = ptrStart.pushHeader(opcode);
        ptr = ptr.push(uint256(groupId), 8);
        ptrStart.patchLength(ptr);
        return ptrStart.resolve();
    }

    function build(uint64 groupId, uint16 headroomBps) internal pure returns (bytes memory) {
        uint256 size = InstructionBuilder.sizeOf() + 10;
        MemoryPtr ptrStart = MemoryPtrLib.alloc(size);
        MemoryPtr ptr = ptrStart.pushHeader(opcode);
        ptr = ptr.push(uint256(groupId), 8);
        ptr = ptr.push(uint256(headroomBps), 2);
        ptrStart.patchLength(ptr);
        return ptrStart.resolve();
    }
}

/// @notice CROSS_XD — shared-inventory reconciliation for sibling Aqua strategies
/// @dev Scales balanceIn/balanceOut so sibling strategies quote against one shared real inventory.
///      State is ordinary persistent storage keyed by (maker, groupId, token) — NOT transient, NOT per-orderHash.
abstract contract Cross {
    using InstructionArgs for bytes;
    using InstructionArgs for bytes32;
    using ContextLib for Context;

    address internal immutable _aqua;

    error InsufficientSharedInventory(uint256 requested, uint256 available);

    event SharedInventoryConsumed(
        address indexed maker,
        uint64 indexed groupId,
        address indexed tokenOut,
        uint256 realisedAmountOut,
        uint256 remaining
    );

    struct GroupEpoch {
        uint64  lastBlock;
        uint96  openingCoverage;
        uint96  consumed;
    }

    mapping(address maker => mapping(uint64 groupId => mapping(address token => GroupEpoch))) internal _groups;

    constructor(address aqua) {
        _aqua = aqua;
    }

    /// @notice Objectively verifiable executable balance: min(wallet balance, allowance to Aqua)
    function coverage(address maker, address token) public view returns (uint256) {
        return Math.min(
            IERC20(token).balanceOf(maker),
            IERC20(token).allowance(maker, _aqua)
        );
    }

    /// @dev CROSS_XD execution — spec §5.4 steps 1-9
    function _crossXD(Context memory ctx, bytes calldata args) internal {
        // Parse
        uint64 groupId = args.at(0).asU64();
        uint16 headroomBps;
        if (args.length > 8) {
            headroomBps = args.at(8).asU16();
        }

        // Step 1: Validate
        require(headroomBps == 0 || headroomBps <= 10_000);

        address maker = ctx.query.maker;
        address tokenOut = ctx.query.tokenOut;

        // Step 2: Epoch resolution
        uint256 currentCov = coverage(maker, tokenOut);
        GroupEpoch storage group = _groups[maker][groupId][tokenOut];

        uint256 openingCov;
        uint256 effectiveConsumed;

        if (block.number > group.lastBlock) {
            openingCov = currentCov;
            effectiveConsumed = 0;
        } else {
            openingCov = uint256(group.openingCoverage);
            effectiveConsumed = uint256(group.consumed);
        }

        // Step 3: Envelope ceiling — tightens only
        uint256 cap = Math.min(openingCov, currentCov);
        if (headroomBps != 0) {
            cap = cap * headroomBps / 10_000;
        }

        // Step 4: Remaining envelope — saturating subtraction
        uint256 remaining = cap > effectiveConsumed ? cap - effectiveConsumed : 0;

        // Step 5: Zero-envelope short circuit
        if (remaining == 0) {
            if (ctx.query.isExactIn) {
                ctx.swap.amountOut = 0;
                ctx.setNextPC(ctx.program().length);
                return;
            } else {
                revert InsufficientSharedInventory(ctx.swap.amountOut, 0);
            }
        }

        // Step 6: Proportional scaling — both sides, same factor
        if (remaining < ctx.swap.balanceOut) {
            ctx.swap.balanceIn = ctx.swap.balanceIn * remaining / ctx.swap.balanceOut;
            ctx.swap.balanceOut = remaining;
        }

        // Step 7: Exact-out guard — against post-scaling balanceOut
        if (!ctx.query.isExactIn && ctx.swap.amountOut >= ctx.swap.balanceOut) {
            revert InsufficientSharedInventory(ctx.swap.amountOut, ctx.swap.balanceOut);
        }

        // Step 8: Run downstream instructions (Decay, XYC, etc.)
        (, uint256 amountOut) = ctx.runLoop();

        // Step 9: Persist on real execution path only
        if (!ctx.vm.isStaticContext) {
            group.openingCoverage = uint96(openingCov);
            group.consumed = uint96(effectiveConsumed + amountOut);
            group.lastBlock = uint64(block.number);

            emit SharedInventoryConsumed(maker, groupId, tokenOut, amountOut, remaining);
        }
    }
}
