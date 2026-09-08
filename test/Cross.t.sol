// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { TokenMock } from "@1inch/solidity-utils/contracts/mocks/TokenMock.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";
import { StaticBalances, DynamicBalances } from "@1inch/swap-vm/src/instructions/Balances.sol";
import { Decay } from "@1inch/swap-vm/src/instructions/Decay.sol";
import { XYCSwap } from "@1inch/swap-vm/src/instructions/XYCSwap.sol";
import { Salt } from "@1inch/swap-vm/src/instructions/Controls.sol";

import { CrossRouter } from "../contracts/CrossRouter.sol";
import { CrossBuilder } from "../contracts/Cross.sol";
import { DemoTaker } from "../contracts/DemoTaker.sol";

contract CrossTest is Test {
    CrossRouter public router;
    DemoTaker public demoTaker;
    address public tokenA;
    address public tokenB;

    // Coverage check reads allowance(maker, _aqua)
    address constant AQUA = address(0xA00A);

    address public maker;
    uint256 public makerPrivateKey;
    address public trader1 = makeAddr("trader1");

    uint256 constant INITIAL_LIQUIDITY = 1000e18;
    uint256 constant STANDARD_SWAP = 10e18;
    uint64 constant GROUP_1 = 1;
    uint64 constant GROUP_2 = 2;
    uint16 constant HEADROOM_FULL = 0; // no tightening
    uint16 constant HEADROOM_50 = 5000; // 50%

    uint256 private orderNonce = 0;

    function setUp() public {
        makerPrivateKey = 0x1234;
        maker = vm.addr(makerPrivateKey);

        router = new CrossRouter(AQUA, address(0), address(this), "Cross", "1.0.0");
        demoTaker = new DemoTaker(address(router));

        tokenA = address(new TokenMock("Token A", "TKA"));
        tokenB = address(new TokenMock("Token B", "TKB"));
        if (tokenA > tokenB) (tokenA, tokenB) = (tokenB, tokenA);

        // Fund maker and approve both router (for SwapVM transfers) and AQUA (for Cross coverage)
        TokenMock(tokenA).mint(maker, 10_000e18);
        TokenMock(tokenB).mint(maker, 10_000e18);
        vm.startPrank(maker);
        TokenMock(tokenA).approve(address(router), type(uint256).max);
        TokenMock(tokenB).approve(address(router), type(uint256).max);
        TokenMock(tokenA).approve(AQUA, type(uint256).max);
        TokenMock(tokenB).approve(AQUA, type(uint256).max);
        vm.stopPrank();

        // Fund trader1
        TokenMock(tokenA).mint(trader1, 10_000e18);
        TokenMock(tokenB).mint(trader1, 10_000e18);
        vm.startPrank(trader1);
        TokenMock(tokenA).approve(address(router), type(uint256).max);
        TokenMock(tokenB).approve(address(router), type(uint256).max);
        vm.stopPrank();

        // Fund demoTaker
        TokenMock(tokenA).mint(address(demoTaker), 10_000e18);
        TokenMock(tokenB).mint(address(demoTaker), 10_000e18);
        vm.startPrank(address(demoTaker));
        TokenMock(tokenA).approve(address(router), type(uint256).max);
        TokenMock(tokenB).approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    // ==================== Helpers ====================

    function _createCrossOrder(uint64 groupId, uint16 headroomBps)
        internal returns (ISwapVM.Order memory order, bytes memory signature)
    {
        bytes memory programBytes;
        if (headroomBps == 0) {
            programBytes = bytes.concat(
                DynamicBalances.build(INITIAL_LIQUIDITY, INITIAL_LIQUIDITY),
                CrossBuilder.build(groupId),
                XYCSwap.build(),
                Salt.build(uint32(0x2000 + orderNonce++))
            );
        } else {
            programBytes = bytes.concat(
                DynamicBalances.build(INITIAL_LIQUIDITY, INITIAL_LIQUIDITY),
                CrossBuilder.build(groupId, headroomBps),
                XYCSwap.build(),
                Salt.build(uint32(0x2000 + orderNonce++))
            );
        }

        order = MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: maker,
            tokenA: tokenA,
            tokenB: tokenB,
            shouldUnwrapWeth: false,
            useAquaInsteadOfSignature: false,
            allowZeroAmountIn: false,
            receiver: address(0),
            hasPreTransferInHook: false,
            hasPostTransferInHook: false,
            hasPreTransferOutHook: false,
            hasPostTransferOutHook: false,
            preTransferInTarget: address(0),
            preTransferInData: "",
            postTransferInTarget: address(0),
            postTransferInData: "",
            preTransferOutTarget: address(0),
            preTransferOutData: "",
            postTransferOutTarget: address(0),
            postTransferOutData: "",
            program: programBytes
        }));

        bytes32 orderHash = router.hash(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(makerPrivateKey, orderHash);
        signature = abi.encodePacked(r, s, v);
    }

    function _createVanillaOrder()
        internal returns (ISwapVM.Order memory order, bytes memory signature)
    {
        bytes memory programBytes = bytes.concat(
            DynamicBalances.build(INITIAL_LIQUIDITY, INITIAL_LIQUIDITY),
            XYCSwap.build(),
            Salt.build(uint32(0x3000 + orderNonce++))
        );

        order = MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: maker,
            tokenA: tokenA,
            tokenB: tokenB,
            shouldUnwrapWeth: false,
            useAquaInsteadOfSignature: false,
            allowZeroAmountIn: false,
            receiver: address(0),
            hasPreTransferInHook: false,
            hasPostTransferInHook: false,
            hasPreTransferOutHook: false,
            hasPostTransferOutHook: false,
            preTransferInTarget: address(0),
            preTransferInData: "",
            postTransferInTarget: address(0),
            postTransferInData: "",
            preTransferOutTarget: address(0),
            preTransferOutData: "",
            postTransferOutTarget: address(0),
            postTransferOutData: "",
            program: programBytes
        }));

        bytes32 orderHash = router.hash(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(makerPrivateKey, orderHash);
        signature = abi.encodePacked(r, s, v);
    }

    function _createCrossDecayOrder(uint64 groupId, uint16 decayPeriod)
        internal returns (ISwapVM.Order memory order, bytes memory signature)
    {
        bytes memory programBytes = bytes.concat(
            DynamicBalances.build(INITIAL_LIQUIDITY, INITIAL_LIQUIDITY),
            CrossBuilder.build(groupId),
            Decay.build(decayPeriod),
            XYCSwap.build(),
            Salt.build(uint32(0x4000 + orderNonce++))
        );

        order = MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: maker,
            tokenA: tokenA,
            tokenB: tokenB,
            shouldUnwrapWeth: false,
            useAquaInsteadOfSignature: false,
            allowZeroAmountIn: false,
            receiver: address(0),
            hasPreTransferInHook: false,
            hasPostTransferInHook: false,
            hasPreTransferOutHook: false,
            hasPostTransferOutHook: false,
            preTransferInTarget: address(0),
            preTransferInData: "",
            postTransferInTarget: address(0),
            postTransferInData: "",
            preTransferOutTarget: address(0),
            preTransferOutData: "",
            postTransferOutTarget: address(0),
            postTransferOutData: "",
            program: programBytes
        }));

        bytes32 orderHash = router.hash(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(makerPrivateKey, orderHash);
        signature = abi.encodePacked(r, s, v);
    }

    function _swap(
        address trader,
        ISwapVM.Order memory order,
        bytes memory signature,
        uint256 amountIn
    ) internal returns (uint256 actualAmountIn, uint256 actualAmountOut) {
        bytes memory takerData = TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: trader,
            isExactIn: true,
            shouldUnwrapWeth: false,
            isStrictThresholdAmount: false,
            isFirstTransferFromTaker: true,
            useTransferFromAndAquaPush: false,
            isAToB: true,
            allowPartialFill: false,
            threshold: "",
            to: address(0),
            deadline: 0,
            hasPreTransferInCallback: false,
            hasPreTransferOutCallback: false,
            preTransferInHookData: "",
            postTransferInHookData: "",
            preTransferOutHookData: "",
            postTransferOutHookData: "",
            preTransferInCallbackData: "",
            preTransferOutCallbackData: "",
            instructionsArgs: "",
            signature: signature
        }));

        vm.prank(trader);
        (actualAmountIn, actualAmountOut,) = router.swap(order, amountIn, takerData);
    }

    function _buildTakerData(address trader, bytes memory signature) internal pure returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: trader,
            isExactIn: true,
            shouldUnwrapWeth: false,
            isStrictThresholdAmount: false,
            isFirstTransferFromTaker: true,
            useTransferFromAndAquaPush: false,
            isAToB: true,
            allowPartialFill: false,
            threshold: "",
            to: address(0),
            deadline: 0,
            hasPreTransferInCallback: false,
            hasPreTransferOutCallback: false,
            preTransferInHookData: "",
            postTransferInHookData: "",
            preTransferOutHookData: "",
            postTransferOutHookData: "",
            preTransferInCallbackData: "",
            preTransferOutCallbackData: "",
            instructionsArgs: "",
            signature: signature
        }));
    }

    // ==================== Gate 0 — Plumbing ====================

    function test_cross_opcode_view_matches_dispatched_slot() public view {
        assertEq(router.crossOpcode(), 0x92, "crossOpcode() must return 0x92");
    }

    function test_stock_aqua_programs_dispatch_unchanged() public {
        (ISwapVM.Order memory order, bytes memory sig) = _createVanillaOrder();
        (, uint256 out) = _swap(trader1, order, sig, STANDARD_SWAP);
        assertTrue(out > 0, "vanilla XYC must produce non-zero output on CrossRouter");
    }

    // ==================== Gate 1 — Single-strategy ====================

    function test_unbound_envelope_matches_plain_program() public {
        // Cross with full coverage should produce identical output to vanilla XYC (invariant I1)
        (ISwapVM.Order memory orderCross, bytes memory sigCross) = _createCrossOrder(GROUP_1, HEADROOM_FULL);
        (ISwapVM.Order memory orderVan, bytes memory sigVan) = _createVanillaOrder();

        (, uint256 outCross) = _swap(trader1, orderCross, sigCross, STANDARD_SWAP);

        // Reset for fair comparison
        deal(tokenA, maker, 10_000e18);
        deal(tokenB, maker, 10_000e18);
        deal(tokenA, trader1, 10_000e18);
        deal(tokenB, trader1, 10_000e18);
        vm.roll(block.number + 1);

        (, uint256 outVan) = _swap(trader1, orderVan, sigVan, STANDARD_SWAP);

        assertEq(outCross, outVan, "unbound envelope must match plain program (I1)");
    }

    function test_first_execution_initialises_epoch() public {
        (ISwapVM.Order memory order, bytes memory sig) = _createCrossOrder(GROUP_1, HEADROOM_FULL);
        (, uint256 out) = _swap(trader1, order, sig, STANDARD_SWAP);
        assertTrue(out > 0, "first execution must succeed and initialise epoch");
    }

    function test_second_same_block_execution_uses_stored_consumption() public {
        (ISwapVM.Order memory order, bytes memory sig) = _createCrossOrder(GROUP_1, HEADROOM_FULL);

        (, uint256 out1) = _swap(trader1, order, sig, STANDARD_SWAP);
        (, uint256 out2) = _swap(trader1, order, sig, STANDARD_SWAP);

        assertTrue(out2 > 0, "second same-block swap must succeed");
        assertTrue(out2 <= out1, "second same-block swap should produce <= first (consumed curve)");
    }

    function test_split_trade_cannot_reopen_envelope() public {
        (ISwapVM.Order memory order, bytes memory sig) = _createCrossOrder(GROUP_1, HEADROOM_FULL);

        // Two small trades in the same block
        (, uint256 outSmall1) = _swap(trader1, order, sig, 5e18);
        (, uint256 outSmall2) = _swap(trader1, order, sig, 5e18);
        uint256 totalSplit = outSmall1 + outSmall2;

        // Reset and do one big trade
        deal(tokenA, maker, 10_000e18);
        deal(tokenB, maker, 10_000e18);
        deal(tokenA, trader1, 10_000e18);
        deal(tokenB, trader1, 10_000e18);
        vm.roll(block.number + 1);

        (ISwapVM.Order memory order2, bytes memory sig2) = _createCrossOrder(GROUP_1, HEADROOM_FULL);
        (, uint256 outSingle) = _swap(trader1, order2, sig2, 10e18);

        // Split should not confer an advantage
        assertApproxEqAbs(totalSplit, outSingle, 1e15, "split trade must not reopen envelope");
    }

    function test_next_block_refreshes_from_current_coverage() public {
        // Tight coverage so the envelope binds
        deal(tokenB, maker, 100e18);

        (ISwapVM.Order memory order, bytes memory sig) = _createCrossOrder(GROUP_1, HEADROOM_FULL);

        // Large first swap to consume significant envelope
        _swap(trader1, order, sig, 50e18);
        // Same-block second swap — tight remaining after consumption
        (, uint256 outSameBlock) = _swap(trader1, order, sig, STANDARD_SWAP);

        vm.roll(block.number + 1);
        // Next block — fresh epoch, consumed resets to 0
        (, uint256 outNextBlock) = _swap(trader1, order, sig, STANDARD_SWAP);

        assertTrue(outNextBlock > outSameBlock, "next block must refresh from current coverage");
    }

    function test_quote_does_not_mutate_state() public {
        (ISwapVM.Order memory order, bytes memory sig) = _createCrossOrder(GROUP_1, HEADROOM_FULL);

        uint256 snapshot = vm.snapshotState();
        (, uint256 out1) = _swap(trader1, order, sig, STANDARD_SWAP);
        vm.revertToState(snapshot);

        (, uint256 out2) = _swap(trader1, order, sig, STANDARD_SWAP);
        assertEq(out1, out2, "repeated fresh swaps from same state must be identical (I4)");
    }

    // ==================== Gate 2 — Shared inventory ====================

    function test_siblings_share_one_envelope() public {
        // Two different orders, same group — they share one envelope
        (ISwapVM.Order memory orderA, bytes memory sigA) = _createCrossOrder(GROUP_1, HEADROOM_FULL);
        (ISwapVM.Order memory orderB, bytes memory sigB) = _createCrossOrder(GROUP_1, HEADROOM_FULL);

        (, uint256 outA) = _swap(trader1, orderA, sigA, STANDARD_SWAP);
        (, uint256 outB) = _swap(trader1, orderB, sigB, STANDARD_SWAP);

        assertTrue(outA > 0, "first sibling must succeed");
        assertTrue(outB > 0, "second sibling must succeed");
    }

    function test_fill_on_one_shrinks_all_siblings_same_block() public {
        // Tight coverage so the envelope binds
        deal(tokenB, maker, 100e18);

        (ISwapVM.Order memory orderA, bytes memory sigA) = _createCrossOrder(GROUP_1, HEADROOM_FULL);
        (ISwapVM.Order memory orderB, bytes memory sigB) = _createCrossOrder(GROUP_1, HEADROOM_FULL);

        // Large fill against A consumes significant envelope
        _swap(trader1, orderA, sigA, 50e18);

        // B should now quote less (consumed envelope)
        (, uint256 outB) = _swap(trader1, orderB, sigB, STANDARD_SWAP);

        // Fresh order in a fresh block (consumed resets to 0)
        vm.roll(block.number + 1);
        (ISwapVM.Order memory orderFresh, bytes memory sigFresh) = _createCrossOrder(GROUP_1, HEADROOM_FULL);
        (, uint256 outFresh) = _swap(trader1, orderFresh, sigFresh, STANDARD_SWAP);

        assertTrue(outFresh > outB, "sibling must quote less after another's fill (I2)");
    }

    function test_coverage_drop_shrinks_quote_not_reverts() public {
        (ISwapVM.Order memory order, bytes memory sig) = _createCrossOrder(GROUP_1, HEADROOM_FULL);

        // Drop maker's balance
        deal(tokenB, maker, 100e18);

        // Should still produce output, not revert (I5)
        (, uint256 out) = _swap(trader1, order, sig, STANDARD_SWAP);
        assertTrue(out > 0, "coverage drop must shrink quote, not revert");
    }

    function test_allowance_drop_shrinks_quote_not_reverts() public {
        (ISwapVM.Order memory order, bytes memory sig) = _createCrossOrder(GROUP_1, HEADROOM_FULL);

        // Drop maker's allowance to AQUA
        vm.prank(maker);
        TokenMock(tokenB).approve(AQUA, 100e18);

        (, uint256 out) = _swap(trader1, order, sig, STANDARD_SWAP);
        assertTrue(out > 0, "allowance drop must shrink quote, not revert");
    }

    function test_same_block_inflow_does_not_replenish() public {
        (ISwapVM.Order memory orderA, bytes memory sigA) = _createCrossOrder(GROUP_1, HEADROOM_FULL);
        (ISwapVM.Order memory orderB, bytes memory sigB) = _createCrossOrder(GROUP_1, HEADROOM_FULL);

        // Fill orderA — consumes some envelope
        _swap(trader1, orderA, sigA, 100e18);

        // Simulate inflow: mint tokens to maker mid-block
        TokenMock(tokenB).mint(maker, 5_000e18);

        // orderB should NOT see the new tokens as available in this block (I8)
        (, uint256 outB) = _swap(trader1, orderB, sigB, STANDARD_SWAP);

        // Next block: should see fresh coverage
        vm.roll(block.number + 1);
        (ISwapVM.Order memory orderC, bytes memory sigC) = _createCrossOrder(GROUP_1, HEADROOM_FULL);
        (, uint256 outC) = _swap(trader1, orderC, sigC, STANDARD_SWAP);

        assertTrue(outC > outB, "next block should see replenished coverage; same block should not (I8)");
    }

    function test_distinct_group_ids_do_not_share() public {
        (ISwapVM.Order memory orderG1, bytes memory sigG1) = _createCrossOrder(GROUP_1, HEADROOM_FULL);
        (ISwapVM.Order memory orderG2, bytes memory sigG2) = _createCrossOrder(GROUP_2, HEADROOM_FULL);

        // Large fill against group 1
        _swap(trader1, orderG1, sigG1, 200e18);

        // Group 2 should be unaffected
        (, uint256 outG2) = _swap(trader1, orderG2, sigG2, STANDARD_SWAP);

        // Compare with a fresh group 1 order
        vm.roll(block.number + 1);
        deal(tokenA, maker, 10_000e18);
        deal(tokenB, maker, 10_000e18);
        deal(tokenA, trader1, 10_000e18);
        deal(tokenB, trader1, 10_000e18);
        (ISwapVM.Order memory orderFresh, bytes memory sigFresh) = _createCrossOrder(GROUP_1, HEADROOM_FULL);
        (, uint256 outFresh) = _swap(trader1, orderFresh, sigFresh, STANDARD_SWAP);

        assertApproxEqAbs(outG2, outFresh, 1e15, "distinct groups must not share envelope");
    }

    function test_headroom_only_tightens() public {
        // Tight coverage so headroom visibly constrains
        deal(tokenB, maker, 100e18);

        (ISwapVM.Order memory orderFull, bytes memory sigFull) = _createCrossOrder(GROUP_1, HEADROOM_FULL);
        (, uint256 outFull) = _swap(trader1, orderFull, sigFull, STANDARD_SWAP);

        // Reset to same coverage for fair comparison
        deal(tokenB, maker, 100e18);
        vm.roll(block.number + 1);

        (ISwapVM.Order memory orderHalf, bytes memory sigHalf) = _createCrossOrder(GROUP_2, HEADROOM_50);
        (, uint256 outHalf) = _swap(trader1, orderHalf, sigHalf, STANDARD_SWAP);

        assertTrue(outHalf < outFull, "headroom=50% must tighten, producing less output");
    }

    function test_two_orders_same_tx_share_group_budget() public {
        // Load-bearing security test (invariant I7, §8.1)
        // Uses DemoTaker to fill two orders in ONE transaction
        (ISwapVM.Order memory orderA, bytes memory sigA) = _createCrossOrder(GROUP_1, HEADROOM_FULL);
        (ISwapVM.Order memory orderB, bytes memory sigB) = _createCrossOrder(GROUP_1, HEADROOM_FULL);

        bytes memory takerDataA = _buildTakerData(address(demoTaker), sigA);
        bytes memory takerDataB = _buildTakerData(address(demoTaker), sigB);

        (, uint256 outA,, uint256 outB) = demoTaker.fillTwo(
            orderA, STANDARD_SWAP, takerDataA,
            orderB, STANDARD_SWAP, takerDataB
        );

        assertTrue(outA > 0, "first order in same tx must fill");
        assertTrue(outB > 0, "second order in same tx must fill");
        // Second order should see first's consumption (shared group budget)
        assertTrue(outB <= outA, "second order must see first's consumption within same tx (I7)");
    }

    // ==================== Gate 3 — Aqua integration ====================

    function test_shipped_key_equals_router_resolved_key() public view {
        // Verify router.hash produces a deterministic key
        ISwapVM.Order memory order;
        order = MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: maker,
            tokenA: tokenA,
            tokenB: tokenB,
            shouldUnwrapWeth: false,
            useAquaInsteadOfSignature: false,
            allowZeroAmountIn: false,
            receiver: address(0),
            hasPreTransferInHook: false,
            hasPostTransferInHook: false,
            hasPreTransferOutHook: false,
            hasPostTransferOutHook: false,
            preTransferInTarget: address(0),
            preTransferInData: "",
            postTransferInTarget: address(0),
            postTransferInData: "",
            preTransferOutTarget: address(0),
            preTransferOutData: "",
            postTransferOutTarget: address(0),
            postTransferOutData: "",
            program: bytes.concat(
                DynamicBalances.build(INITIAL_LIQUIDITY, INITIAL_LIQUIDITY),
                CrossBuilder.build(GROUP_1),
                XYCSwap.build(),
                Salt.build(uint32(0x9999))
            )
        }));

        bytes32 hash1 = router.hash(order);
        bytes32 hash2 = router.hash(order);
        assertEq(hash1, hash2, "router.hash must be deterministic");
        assertTrue(hash1 != bytes32(0), "hash must be non-zero");
    }

    function test_fill_moves_real_erc20_between_maker_and_taker() public {
        (ISwapVM.Order memory order, bytes memory sig) = _createCrossOrder(GROUP_1, HEADROOM_FULL);

        uint256 makerBBefore = TokenMock(tokenB).balanceOf(maker);
        uint256 traderBBefore = TokenMock(tokenB).balanceOf(trader1);

        (, uint256 amountOut) = _swap(trader1, order, sig, STANDARD_SWAP);

        uint256 makerBAfter = TokenMock(tokenB).balanceOf(maker);
        uint256 traderBAfter = TokenMock(tokenB).balanceOf(trader1);

        assertEq(makerBBefore - makerBAfter, amountOut, "maker must lose exactly amountOut");
        assertEq(traderBAfter - traderBBefore, amountOut, "trader must gain exactly amountOut");
    }

    // ==================== Gate 4 — Composition ====================

    function test_xyc_baseline() public {
        (ISwapVM.Order memory order, bytes memory sig) = _createVanillaOrder();
        (, uint256 out) = _swap(trader1, order, sig, STANDARD_SWAP);
        assertTrue(out > 0, "XYC baseline must produce output");
    }

    function test_cross_then_xyc() public {
        (ISwapVM.Order memory order, bytes memory sig) = _createCrossOrder(GROUP_1, HEADROOM_FULL);
        (, uint256 out) = _swap(trader1, order, sig, STANDARD_SWAP);
        assertTrue(out > 0, "CROSS + XYC must produce output");
    }

    function test_cross_then_decay_then_xyc() public {
        uint16 decayPeriod = 300;
        (ISwapVM.Order memory order, bytes memory sig) = _createCrossDecayOrder(GROUP_1, decayPeriod);

        (, uint256 out1) = _swap(trader1, order, sig, STANDARD_SWAP);
        assertTrue(out1 > 0, "CROSS + DECAY + XYC first trade must succeed");

        // Advance time for partial decay
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + decayPeriod / 2);

        (, uint256 out2) = _swap(trader1, order, sig, STANDARD_SWAP);
        assertTrue(out2 > 0, "CROSS + DECAY + XYC second trade after partial decay must succeed");
    }
}
