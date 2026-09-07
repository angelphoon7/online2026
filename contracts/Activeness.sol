// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {LocalState, GroupState} from "./lib/SwapVMTypes.sol";

contract Activeness {
    uint256 internal constant PRECISION = 1e18;

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

    // localState[orderHash][token]
    mapping(bytes32 => mapping(address => LocalState)) public localState;

    // groupState[keccak256(maker, groupId, token)]
    mapping(bytes32 => GroupState) public groupState;

    address public immutable aqua;

    constructor(address _aqua) {
        aqua = _aqua;
    }

    function _groupKey(address maker, bytes32 groupId, address token) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(maker, groupId, token));
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _coverage(address maker, address token) internal view returns (uint256) {
        uint256 balance = IERC20(token).balanceOf(maker);
        uint256 allowed = IERC20(token).allowance(maker, aqua);
        return _min(balance, allowed);
    }

    /// @notice Compute effective active reserves for a position.
    ///         Pure read — no state writes. Used by quote path.
    function computeEffectiveReserves(
        bytes32 orderHash,
        address maker,
        address tokenIn,
        address tokenOut,
        uint256 totalReserveIn,
        uint256 totalReserveOut,
        uint256 activenessNumerator,
        bytes32 groupId
    )
        external
        view
        returns (uint256 effectiveIn, uint256 effectiveOut)
    {
        (effectiveIn, effectiveOut) = _computeEffective(
            orderHash, maker, tokenIn, tokenOut,
            totalReserveIn, totalReserveOut,
            activenessNumerator, groupId,
            false // isSwap = false → no state writes
        );
    }

    /// @notice Apply activeness, persist state. Used by swap path only.
    function applyActiveness(
        bytes32 orderHash,
        address maker,
        address tokenIn,
        address tokenOut,
        uint256 totalReserveIn,
        uint256 totalReserveOut,
        uint256 activenessNumerator,
        bytes32 groupId,
        uint256 amountIn,
        uint256 amountOut
    )
        external
        returns (uint256 effectiveIn, uint256 effectiveOut)
    {
        (effectiveIn, effectiveOut) = _computeEffective(
            orderHash, maker, tokenIn, tokenOut,
            totalReserveIn, totalReserveOut,
            activenessNumerator, groupId,
            true // isSwap = true → persist state
        );

        if (amountOut >= effectiveOut) {
            revert ActiveLiquidityExceeded();
        }

        // Persist consumed curve for local λ
        LocalState storage ls = localState[orderHash][tokenOut];
        ls.blockNumber = block.number;
        ls.activeReserveIn = effectiveIn + amountIn;
        ls.activeReserveOut = effectiveOut - amountOut;

        LocalState storage lsIn = localState[orderHash][tokenIn];
        lsIn.blockNumber = block.number;
        lsIn.activeReserveIn = effectiveIn + amountIn;
        lsIn.activeReserveOut = effectiveOut - amountOut;

        // Persist group consumption
        bytes32 gKey = _groupKey(maker, groupId, tokenOut);
        GroupState storage gs = groupState[gKey];
        if (amountOut > gs.remaining) {
            revert GroupActiveLiquidityExceeded();
        }
        gs.remaining -= amountOut;

        emit ActivenessApplied(
            orderHash, maker, groupId, tokenOut,
            effectiveOut, totalReserveOut,
            gs.remaining, block.number
        );
    }

    function _computeEffective(
        bytes32 orderHash,
        address maker,
        address tokenIn,
        address tokenOut,
        uint256 totalReserveIn,
        uint256 totalReserveOut,
        uint256 activenessNumerator,
        bytes32 groupId,
        bool isSwap
    )
        internal
        view
        returns (uint256 effectiveIn, uint256 effectiveOut)
    {
        // --- Local λ ---
        LocalState storage ls = localState[orderHash][tokenOut];

        if (ls.blockNumber == block.number) {
            // Same block: continue on consumed curve
            effectiveIn = ls.activeReserveIn;
            effectiveOut = ls.activeReserveOut;
        } else {
            // New block: repartition from total state
            effectiveIn = (totalReserveIn * activenessNumerator) / PRECISION;
            effectiveOut = (totalReserveOut * activenessNumerator) / PRECISION;
        }

        // --- Shared Γ (group envelope) ---
        bytes32 gKey = _groupKey(maker, groupId, tokenOut);
        GroupState storage gs = groupState[gKey];

        if (gs.blockNumber == block.number) {
            // Same block: use stored remaining directly.
            // The remaining field already tracks consumption from swaps.
            // Live coverage changes (drops from transfers, inflows from mints)
            // are ignored until the next block opens a fresh envelope.
            effectiveOut = _min(effectiveOut, gs.remaining);
        } else {
            // New block: open fresh envelope from current live coverage
            uint256 currentCoverage = _coverage(maker, tokenOut);
            effectiveOut = _min(effectiveOut, currentCoverage);
        }

        // Scale effectiveIn proportionally if effectiveOut was clamped
        if (totalReserveOut > 0) {
            uint256 rawEffectiveOut = (totalReserveOut * activenessNumerator) / PRECISION;
            if (effectiveOut < rawEffectiveOut && rawEffectiveOut > 0) {
                effectiveIn = (effectiveIn * effectiveOut) / rawEffectiveOut;
            }
        }
    }

    /// @notice Initialize or refresh group state for a new block. Called by the router.
    function initGroupState(
        address maker,
        bytes32 groupId,
        address token
    ) external {
        bytes32 gKey = _groupKey(maker, groupId, token);
        GroupState storage gs = groupState[gKey];

        if (gs.blockNumber < block.number) {
            uint256 cov = _coverage(maker, token);
            gs.blockNumber = block.number;
            gs.openingCoverage = cov;
            gs.remaining = cov;
        }
    }
}
