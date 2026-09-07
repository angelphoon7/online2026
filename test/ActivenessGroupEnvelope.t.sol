// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {Activeness} from "../contracts/Activeness.sol";
import {AquaValveRouter} from "../contracts/AquaValveRouter.sol";
import {DemoTaker} from "../contracts/DemoTaker.sol";
import {Order} from "../contracts/lib/SwapVMTypes.sol";
import {MockERC20} from "./MockERC20.sol";

contract ActivenessGroupEnvelopeTest is Test {
    Activeness activeness;
    AquaValveRouter router;
    DemoTaker demoTaker;
    MockERC20 tokenIn;
    MockERC20 tokenOut;

    address maker = address(0x1111);
    address aquaAddr = address(0x3333);

    uint256 constant RESERVE_IN = 100 ether;
    uint256 constant RESERVE_OUT = 400_000 ether;
    uint256 constant PRECISION = 1e18;
    bytes32 constant GROUP_ID = bytes32(uint256(1));

    function setUp() public {
        tokenIn = new MockERC20("ETH", "ETH");
        tokenOut = new MockERC20("USDC", "USDC");

        activeness = new Activeness(aquaAddr);
        router = new AquaValveRouter(aquaAddr, address(activeness));
        demoTaker = new DemoTaker(address(router));

        // Fund maker — use TIGHT coverage so group envelope is binding
        tokenOut.mint(maker, 100_000 ether);
        vm.prank(maker);
        tokenOut.approve(aquaAddr, 100_000 ether);
        vm.prank(maker);
        tokenOut.approve(address(router), type(uint256).max);

        // Fund demoTaker with tokenIn
        tokenIn.mint(address(demoTaker), 1000 ether);
    }

    function _makeOrder(uint256 lambda, bytes32 groupId, bytes memory extraBytes) internal view returns (Order memory) {
        return Order({
            maker: maker,
            tokenIn: address(tokenIn),
            tokenOut: address(tokenOut),
            reserveIn: RESERVE_IN,
            reserveOut: RESERVE_OUT,
            groupId: groupId,
            activenessNumerator: lambda,
            strategyBytes: extraBytes
        });
    }

    // --- Gate 2 Tests ---

    function test_two_orders_same_tx_share_group_budget() public {
        // λ = 50% → effective out = 200k, but coverage is only 100k
        // So group envelope caps effective out to 100k
        Order memory orderA = _makeOrder(0.5e18, GROUP_ID, "A");
        Order memory orderB = _makeOrder(0.5e18, GROUP_ID, "B");

        uint256 amountIn = 5 ether;

        // Init group state for this block
        activeness.initGroupState(maker, GROUP_ID, address(tokenOut));

        // Quote B before any trade
        uint256 quoteBBefore = router.quote(orderB, amountIn);

        // Fill A — consumes group budget
        vm.prank(address(demoTaker));
        tokenIn.approve(address(router), amountIn);
        vm.prank(address(demoTaker));
        router.swap(orderA, amountIn);

        // Quote B after A consumed group budget (same block)
        uint256 quoteBAfter = router.quote(orderB, amountIn);

        assertTrue(quoteBAfter < quoteBBefore, "B's quote must shrink after A consumed group budget");
    }

    function test_coverage_drop_shrinks_quote_not_reverts() public {
        // λ = 80% → effective out = 320k, but coverage is only 100k → capped to 100k
        Order memory order = _makeOrder(0.8e18, GROUP_ID, "");
        uint256 amountIn = 1 ether;

        // Init group state
        activeness.initGroupState(maker, GROUP_ID, address(tokenOut));

        // Quote with full coverage (100k)
        uint256 quoteFull = router.quote(order, amountIn);

        // Reduce maker's balance to 50k
        tokenOut.burn(maker, 50_000 ether);

        // Advance block so group state refreshes with new coverage
        vm.roll(block.number + 1);
        activeness.initGroupState(maker, GROUP_ID, address(tokenOut));

        // Quote with reduced coverage — must not revert, must be smaller
        uint256 quoteReduced = router.quote(order, amountIn);

        assertTrue(quoteReduced < quoteFull, "quote must shrink with reduced coverage");
        assertTrue(quoteReduced > 0, "quote must not be zero (not bricked)");
    }

    function test_allowance_drop_shrinks_quote_not_reverts() public {
        // λ = 80% → effective out = 320k, but coverage is only 100k → capped to 100k
        Order memory order = _makeOrder(0.8e18, GROUP_ID, "");
        uint256 amountIn = 1 ether;

        // Init group state
        activeness.initGroupState(maker, GROUP_ID, address(tokenOut));

        // Quote with full allowance (100k)
        uint256 quoteFull = router.quote(order, amountIn);

        // Reduce maker's allowance to 30k
        tokenOut.setAllowance(maker, aquaAddr, 30_000 ether);

        // Advance block so group refreshes
        vm.roll(block.number + 1);
        activeness.initGroupState(maker, GROUP_ID, address(tokenOut));

        // Quote with reduced allowance — must not revert, must be smaller
        uint256 quoteReduced = router.quote(order, amountIn);

        assertTrue(quoteReduced < quoteFull, "quote must shrink with reduced allowance");
        assertTrue(quoteReduced > 0, "quote must not be zero (not bricked)");
    }

    function test_same_block_inflow_does_not_reopen_envelope() public {
        // λ = 80% → effective = 320k, but coverage = 100k → capped to 100k
        Order memory order = _makeOrder(0.8e18, GROUP_ID, "");
        uint256 amountIn = 2 ether;

        // Init group state and do a swap to consume some budget
        activeness.initGroupState(maker, GROUP_ID, address(tokenOut));

        vm.prank(address(demoTaker));
        tokenIn.approve(address(router), amountIn);
        vm.prank(address(demoTaker));
        router.swap(order, amountIn);

        // Quote after first swap
        uint256 quoteAfterSwap = router.quote(order, amountIn);

        // Deposit more tokens to maker in same block
        tokenOut.mint(maker, 200_000 ether);

        // Quote again — should NOT improve (same block, no reopen)
        uint256 quoteAfterInflow = router.quote(order, amountIn);

        assertEq(quoteAfterInflow, quoteAfterSwap, "same-block inflow must not reopen envelope");
    }
}
