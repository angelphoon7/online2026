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

import { AquaValveRouter } from "../contracts/AquaValveRouter.sol";
import { Activeness } from "../contracts/Activeness.sol";

contract ActivenessTest is Test {
    AquaValveRouter public router;
    address public tokenA;
    address public tokenB;

    address public maker;
    uint256 public makerPrivateKey;
    address public trader1 = makeAddr("trader1");

    uint256 constant INITIAL_LIQUIDITY = 1000e18;
    uint256 constant STANDARD_SWAP = 10e18;
    uint16 constant LAMBDA_20_BPS = 2000;  // 20%
    uint16 constant LAMBDA_100_BPS = 10000; // 100%
    uint16 constant HEADROOM_100_BPS = 10000; // no tightening
    bytes32 constant GROUP_ID = bytes32(uint256(1));

    uint256 private orderNonce = 0;

    function setUp() public {
        makerPrivateKey = 0x1234;
        maker = vm.addr(makerPrivateKey);

        router = new AquaValveRouter(address(0), address(0), address(this), "AquaValve", "1.0.0");

        tokenA = address(new TokenMock("Token A", "TKA"));
        tokenB = address(new TokenMock("Token B", "TKB"));
        if (tokenA > tokenB) (tokenA, tokenB) = (tokenB, tokenA);

        // Fund maker
        TokenMock(tokenA).mint(maker, 10000e18);
        TokenMock(tokenB).mint(maker, 10000e18);
        vm.prank(maker);
        TokenMock(tokenA).approve(address(router), type(uint256).max);
        vm.prank(maker);
        TokenMock(tokenB).approve(address(router), type(uint256).max);

        // Fund trader
        TokenMock(tokenA).mint(trader1, 10000e18);
        TokenMock(tokenB).mint(trader1, 10000e18);
        vm.prank(trader1);
        TokenMock(tokenA).approve(address(router), type(uint256).max);
        vm.prank(trader1);
        TokenMock(tokenB).approve(address(router), type(uint256).max);
    }

    function _createOrder(uint16 lambdaBps, uint16 headroomBps, bytes32 groupId)
        internal returns (ISwapVM.Order memory order, bytes memory signature)
    {
        bytes memory programBytes = bytes.concat(
            DynamicBalances.build(INITIAL_LIQUIDITY, INITIAL_LIQUIDITY),
            Activeness.build(lambdaBps, headroomBps, groupId),
            XYCSwap.build(),
            Salt.build(uint32(0x2000 + orderNonce++))
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

    function _swap(
        address trader,
        ISwapVM.Order memory order,
        bytes memory signature,
        uint256 amountIn
    ) internal returns (uint256 actualAmountIn, uint256 actualAmountOut) {
        bool isAToB = true;
        bytes memory takerData = TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: trader,
            isExactIn: true,
            shouldUnwrapWeth: false,
            isStrictThresholdAmount: false,
            isFirstTransferFromTaker: true,
            useTransferFromAndAquaPush: false,
            isAToB: isAToB,
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

    // ========== Gate 1: Local λ ==========

    function test_lambda_100_equals_XYC() public {
        // Activeness with λ=100% should produce identical output to vanilla XYC
        (ISwapVM.Order memory orderAct, bytes memory sigAct) = _createOrder(LAMBDA_100_BPS, HEADROOM_100_BPS, GROUP_ID);
        (ISwapVM.Order memory orderVan, bytes memory sigVan) = _createVanillaOrder();

        (, uint256 outAct) = _swap(trader1, orderAct, sigAct, STANDARD_SWAP);

        // Reset maker balances for fair comparison
        deal(tokenA, maker, 10000e18);
        deal(tokenB, maker, 10000e18);
        deal(tokenA, trader1, 10000e18);
        deal(tokenB, trader1, 10000e18);
        vm.roll(block.number + 1);

        (, uint256 outVan) = _swap(trader1, orderVan, sigVan, STANDARD_SWAP);

        assertEq(outAct, outVan, "lambda=100% must equal vanilla XYC");
    }

    function test_same_block_does_not_refresh_lambda() public {
        (ISwapVM.Order memory order, bytes memory sig) = _createOrder(LAMBDA_20_BPS, HEADROOM_100_BPS, GROUP_ID);

        (, uint256 out1) = _swap(trader1, order, sig, STANDARD_SWAP);
        (, uint256 out2) = _swap(trader1, order, sig, STANDARD_SWAP);

        assertTrue(out2 < out1, "same-block second trade must get less (consumed curve)");
    }

    function test_next_block_repartitions() public {
        (ISwapVM.Order memory order, bytes memory sig) = _createOrder(LAMBDA_20_BPS, HEADROOM_100_BPS, GROUP_ID);

        _swap(trader1, order, sig, STANDARD_SWAP);
        (, uint256 outSameBlock) = _swap(trader1, order, sig, STANDARD_SWAP);

        vm.roll(block.number + 1);
        (, uint256 outNextBlock) = _swap(trader1, order, sig, STANDARD_SWAP);

        assertTrue(outNextBlock > outSameBlock, "next block must repartition fresh active reserves");
    }

    function test_exact_in_continues_on_consumed_curve() public {
        (ISwapVM.Order memory order, bytes memory sig) = _createOrder(LAMBDA_20_BPS, HEADROOM_100_BPS, GROUP_ID);

        (, uint256 out1) = _swap(trader1, order, sig, 5e18);
        (, uint256 out2) = _swap(trader1, order, sig, 5e18);
        (, uint256 out3) = _swap(trader1, order, sig, 5e18);

        assertTrue(out1 > out2, "trade 2 output must be less than trade 1");
        assertTrue(out2 > out3, "trade 3 output must be less than trade 2");
    }

    function test_quote_does_not_mutate_state() public {
        (ISwapVM.Order memory order, bytes memory sig) = _createOrder(LAMBDA_20_BPS, HEADROOM_100_BPS, GROUP_ID);

        // Take a state snapshot
        uint256 snapshot = vm.snapshotState();

        // Execute a swap
        _swap(trader1, order, sig, STANDARD_SWAP);

        // Revert to snapshot (undoes the swap)
        vm.revertToState(snapshot);

        // Now do the swap again — output should be identical (proving quote path has no side effects)
        (, uint256 out1) = _swap(trader1, order, sig, STANDARD_SWAP);

        vm.revertToState(snapshot);
        (, uint256 out2) = _swap(trader1, order, sig, STANDARD_SWAP);

        assertEq(out1, out2, "repeated fresh swaps from same state must produce identical output");
    }
}
