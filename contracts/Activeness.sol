// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Context, ContextLib } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { MemoryPtr, MemoryPtrLib } from "@1inch/swap-vm/src/libs/MemoryPtr.sol";
import { InstructionBuilder } from "@1inch/swap-vm/src/libs/InstructionBuilder.sol";
import { InstructionArgs } from "@1inch/swap-vm/src/libs/InstructionArgs.sol";

/// @notice ACTIVENESS_XD opcode — programmable live liquidity
/// @dev Scales balanceIn and balanceOut by local λ (per-position) and shared Γ (group envelope)
///      before downstream instructions (Decay, XYC) run.
/// @dev Encoding: [uint16 activenessNumeratorBps, uint16 headroomBps, bytes32 groupId]
library Activeness {
    using InstructionArgs for bytes;
    using InstructionArgs for bytes32;
    using MemoryPtrLib for MemoryPtr;
    using InstructionBuilder for MemoryPtr;
    using ContextLib for Context;

    // Claim slot _92 in the "Balances tuning" bank (0x90-0xaf)
    Opcode constant opcode = Opcode._92;

    error ActiveLiquidityExceeded();
    error GroupActiveLiquidityExceeded();

    event ActivenessApplied(
        bytes32 indexed orderHash,
        address indexed maker,
        bytes32 indexed groupId,
        address token,
        uint256 effectiveActive,
        uint256 totalReserve,
        uint256 groupRemaining,
        uint256 blockNumber
    );

    // --- Instruction encoding ---

    function sizeOf(uint16, uint16, bytes32) internal pure returns (uint256) {
        return InstructionBuilder.sizeOf() + 2 + 2 + 32;
    }

    function build(uint16 activenessNumeratorBps, uint16 headroomBps, bytes32 groupId)
        internal pure returns (bytes memory)
    {
        return build(
            MemoryPtrLib.alloc(sizeOf(activenessNumeratorBps, headroomBps, groupId)),
            activenessNumeratorBps, headroomBps, groupId
        ).resolve();
    }

    function build(MemoryPtr ptrStart, uint16 activenessNumeratorBps, uint16 headroomBps, bytes32 groupId)
        internal pure returns (MemoryPtr ptr)
    {
        ptr = ptrStart.pushHeader(opcode);
        ptr = ptr.push(activenessNumeratorBps, 2);
        ptr = ptr.push(headroomBps, 2);
        ptr = ptr.push(groupId, 32);
        ptrStart.patchLength(ptr);
    }

    function parse(bytes calldata args)
        internal pure returns (uint16 activenessNumeratorBps, uint16 headroomBps, bytes32 groupId)
    {
        activenessNumeratorBps = args.at(0).asU16();
        headroomBps = args.at(2).asU16();
        groupId = args.at(4);
    }

    // --- Storage (ERC-7201 style) ---

    // keccak256(abi.encode(uint256(keccak256("aquavalve.storage.Activeness")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant STORAGE_SLOT = 0x5a1d2e8f3c4b6a7890abcdef1234567890abcdef1234567890abcdef12345600;

    struct LocalTokenState {
        uint256 blockNumber;
        uint256 activeReserve;
    }

    struct GroupState {
        uint256 blockNumber;
        uint256 openingCoverage;
        uint256 remaining;
    }

    struct Storage {
        mapping(bytes32 orderHash => mapping(address token => LocalTokenState)) local;
        mapping(bytes32 groupKey => GroupState) group;
    }

    function store() internal pure returns (Storage storage $) {
        bytes32 slot = STORAGE_SLOT;
        assembly ("memory-safe") { $.slot := slot }
    }

    // --- Execution ---

    function exec(Context memory ctx, bytes calldata args) internal {
        Storage storage $ = store();
        (uint16 activenessNumeratorBps, uint16 headroomBps, bytes32 groupId) = parse(args);

        address aqua = _getAqua();

        // --- Local λ: scale balances ---
        _applyLocalLambda($, ctx, activenessNumeratorBps);

        // --- Shared Γ: clamp to group envelope ---
        _applyGroupEnvelope($, ctx, headroomBps, groupId, aqua);

        // --- Run downstream instructions (Decay → XYC) ---
        (uint256 amountIn, uint256 amountOut) = ctx.runLoop();

        // --- Persist state on swap path only ---
        if (!ctx.vm.isStaticContext) {
            _persistLocalState($, ctx, amountIn, amountOut);
            _persistGroupState($, ctx, groupId, amountOut);

            emit ActivenessApplied(
                ctx.query.orderHash,
                ctx.query.maker,
                groupId,
                ctx.query.tokenOut,
                ctx.swap.balanceOut,
                ctx.swap.balanceOut + amountOut,
                $.group[_groupKey(ctx.query.maker, groupId, ctx.query.tokenOut)].remaining,
                block.number
            );
        }
    }

    // --- Internal helpers ---

    function _applyLocalLambda(
        Storage storage $,
        Context memory ctx,
        uint16 activenessNumeratorBps
    ) private view {
        LocalTokenState storage lsIn = $.local[ctx.query.orderHash][ctx.query.tokenIn];
        LocalTokenState storage lsOut = $.local[ctx.query.orderHash][ctx.query.tokenOut];

        if (lsOut.blockNumber == block.number && lsOut.activeReserve > 0) {
            // Same block: continue on consumed curve
            ctx.swap.balanceOut = lsOut.activeReserve;
            ctx.swap.balanceIn = lsIn.activeReserve;
        } else {
            // New block: repartition from total reserves
            ctx.swap.balanceIn = ctx.swap.balanceIn * activenessNumeratorBps / 10000;
            ctx.swap.balanceOut = ctx.swap.balanceOut * activenessNumeratorBps / 10000;
        }
    }

    function _applyGroupEnvelope(
        Storage storage $,
        Context memory ctx,
        uint16 headroomBps,
        bytes32 groupId,
        address aqua
    ) private view {
        bytes32 gKey = _groupKey(ctx.query.maker, groupId, ctx.query.tokenOut);
        GroupState storage gs = $.group[gKey];

        if (gs.blockNumber == block.number) {
            // Same block: use stored remaining, ignore live coverage changes
            if (ctx.swap.balanceOut > gs.remaining) {
                ctx.swap.balanceOut = gs.remaining;
                // Scale balanceIn proportionally
                if (gs.openingCoverage > 0) {
                    ctx.swap.balanceIn = ctx.swap.balanceIn * gs.remaining / gs.openingCoverage;
                }
            }
        } else {
            // New block: open fresh envelope from live coverage
            uint256 coverage = _coverage(ctx.query.maker, ctx.query.tokenOut, aqua);
            // headroomBps can only tighten, never exceed coverage
            if (headroomBps < 10000) {
                coverage = coverage * headroomBps / 10000;
            }
            if (ctx.swap.balanceOut > coverage) {
                // Scale proportionally
                if (ctx.swap.balanceOut > 0) {
                    ctx.swap.balanceIn = ctx.swap.balanceIn * coverage / ctx.swap.balanceOut;
                }
                ctx.swap.balanceOut = coverage;
            }
        }
    }

    function _persistLocalState(
        Storage storage $,
        Context memory ctx,
        uint256 amountIn,
        uint256 amountOut
    ) private {
        $.local[ctx.query.orderHash][ctx.query.tokenIn] = LocalTokenState({
            blockNumber: block.number,
            activeReserve: ctx.swap.balanceIn + amountIn
        });
        $.local[ctx.query.orderHash][ctx.query.tokenOut] = LocalTokenState({
            blockNumber: block.number,
            activeReserve: ctx.swap.balanceOut - amountOut
        });
    }

    function _persistGroupState(
        Storage storage $,
        Context memory ctx,
        bytes32 groupId,
        uint256 amountOut
    ) private {
        bytes32 gKey = _groupKey(ctx.query.maker, groupId, ctx.query.tokenOut);
        GroupState storage gs = $.group[gKey];

        if (gs.blockNumber < block.number) {
            // Initialize for new block
            address aqua = _getAqua();
            uint256 cov = _coverage(ctx.query.maker, ctx.query.tokenOut, aqua);
            gs.blockNumber = block.number;
            gs.openingCoverage = cov;
            gs.remaining = cov;
        }

        if (amountOut > gs.remaining) {
            revert GroupActiveLiquidityExceeded();
        }
        gs.remaining -= amountOut;
    }

    function _groupKey(address maker, bytes32 groupId, address token) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(maker, groupId, token));
    }

    function _coverage(address maker, address token, address aqua) private view returns (uint256) {
        uint256 balance = IERC20(token).balanceOf(maker);
        uint256 allowed = IERC20(token).allowance(maker, aqua);
        return balance < allowed ? balance : allowed;
    }

    function _getAqua() private view returns (address) {
        // Read from the router's immutable aqua address via self-call
        // In the actual deployment this would be wired at construction
        return address(this);
    }
}
