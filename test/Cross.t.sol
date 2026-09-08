// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { TokenMock } from "@1inch/solidity-utils/contracts/mocks/TokenMock.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";
import { XYCSwap } from "@1inch/swap-vm/src/instructions/XYCSwap.sol";
import { Salt } from "@1inch/swap-vm/src/instructions/Controls.sol";

import { CrossRouter } from "../contracts/CrossRouter.sol";
import { CrossBuilder } from "../contracts/Cross.sol";

contract CrossTest is Test {
    Aqua public aqua;
    CrossRouter public router;

    TokenMock public tokenA;
    TokenMock public tokenB;

    address public maker = makeAddr("maker");
    address public taker = makeAddr("taker");

    uint256 constant VIRTUAL_BALANCE = 10e18;
    uint256 constant REAL_WALLET = 6e18;
    // Sized so XYCSwap output exceeds real wallet:
    // amountOut = 20 * 10 / (10 + 20) = 6.67 > 6
    uint256 constant TAKER_AMOUNT = 20e18;

    uint256 private orderNonce;

    function setUp() public {
        aqua = new Aqua();
        router = new CrossRouter(address(aqua), address(0), address(this), "Cross", "1.0.0");

        tokenA = new TokenMock("Token A", "TKA");
        tokenB = new TokenMock("Token B", "TKB");
        if (address(tokenA) > address(tokenB)) (tokenA, tokenB) = (tokenB, tokenA);

        // Maker: limited tokenB is the whole premise
        TokenMock(tokenA).mint(maker, 100e18);
        TokenMock(tokenB).mint(maker, REAL_WALLET);
        vm.startPrank(maker);
        TokenMock(tokenA).approve(address(aqua), type(uint256).max);
        TokenMock(tokenB).approve(address(aqua), type(uint256).max);
        vm.stopPrank();

        // Taker: approve router for the useTransferFromAndAquaPush path
        TokenMock(tokenA).mint(taker, 100e18);
        TokenMock(tokenB).mint(taker, 100e18);
        vm.startPrank(taker);
        TokenMock(tokenA).approve(address(router), type(uint256).max);
        TokenMock(tokenB).approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    // ==================== Helpers ====================

    function _buildAndShipOrder(bytes memory programBytes)
        internal returns (ISwapVM.Order memory order)
    {
        order = MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: maker,
            tokenA: address(tokenA),
            tokenB: address(tokenB),
            shouldUnwrapWeth: false,
            useAquaInsteadOfSignature: true,
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

        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = VIRTUAL_BALANCE;
        amounts[1] = VIRTUAL_BALANCE;

        vm.prank(maker);
        aqua.ship(address(router), abi.encode(order), tokens, amounts);
    }

    function _buildTakerData() internal pure returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: address(0),
            isExactIn: true,
            shouldUnwrapWeth: false,
            isStrictThresholdAmount: false,
            isFirstTransferFromTaker: true,
            useTransferFromAndAquaPush: true,
            isAToB: true,
            // Required: Cross lowers amountIn when it resizes. Without this flag
            // TakerTraits.validate enforces takerAmount == amountIn on exact-in and
            // the resized fill reverts on validation, not on anything Cross did.
            allowPartialFill: true,
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
            signature: ""
        }));
    }

    // ==================== Gate 0 — Plumbing ====================

    function test_crossOpcodeViewMatchesDispatchedSlot() public view {
        assertEq(router.crossOpcode(), 0x92, "crossOpcode() must return 0x92");
    }

    // ==================== Gate 0.5 — From Revert to Resize ====================

    function test_fromRevertToResize() public {
        // CONTROL — no CROSS_XD. XYCSwap trusts Aqua's virtual depth (10).
        // With TAKER_AMOUNT=20, XYCSwap computes amountOut ≈ 6.67 > REAL_WALLET (6).
        // Aqua.pull tries safeTransferFrom(maker, taker, 6.67) but maker only has 6 → REVERT.
        bytes memory controlProgram = bytes.concat(
            XYCSwap.build(),
            Salt.build(uint32(0x1000 + orderNonce++))
        );
        ISwapVM.Order memory controlOrder = _buildAndShipOrder(controlProgram);
        bytes memory takerData = _buildTakerData();

        vm.prank(taker);
        vm.expectRevert();
        router.swap(controlOrder, TAKER_AMOUNT, takerData);

        // TREATMENT — with CROSS_XD. Reads coverage = 6, resizes reserves to 6/6.
        // XYCSwap computes amountOut ≈ 4.62 ≤ 6 → settlement succeeds.
        bytes memory treatmentProgram = bytes.concat(
            CrossBuilder.build(),
            XYCSwap.build(),
            Salt.build(uint32(0x1000 + orderNonce++))
        );
        ISwapVM.Order memory treatmentOrder = _buildAndShipOrder(treatmentProgram);

        uint256 makerBBefore = tokenB.balanceOf(maker);
        uint256 takerBBefore = tokenB.balanceOf(taker);

        vm.prank(taker);
        (uint256 amountIn, uint256 amountOut,) = router.swap(treatmentOrder, TAKER_AMOUNT, takerData);

        assertLe(amountOut, REAL_WALLET, "output exceeds real coverage");
        assertGt(amountOut, 0, "output must be non-zero");
        assertEq(makerBBefore - tokenB.balanceOf(maker), amountOut, "maker delta");
        assertEq(tokenB.balanceOf(taker) - takerBBefore, amountOut, "taker delta");

        emit log("+------------------------------------+");
        emit log("|       FROM REVERT TO RESIZE        |");
        emit log("+------------------------------------+");
        emit log_named_uint("virtual depth (Aqua)", VIRTUAL_BALANCE);
        emit log_named_uint("real coverage  (wallet)", REAL_WALLET);
        emit log_named_string("control result", "REVERT");
        emit log_named_uint("treatment amountIn", amountIn);
        emit log_named_uint("treatment amountOut", amountOut);
    }
}
