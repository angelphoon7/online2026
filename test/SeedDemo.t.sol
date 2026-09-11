// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SeedDemo} from "../script/SeedDemo.s.sol";
import {TicketNFT} from "../src/TicketNFT.sol";
import {Escrow} from "../src/Escrow.sol";
import {IntentRegistry} from "../src/IntentRegistry.sol";
import {Settlement} from "../src/Settlement.sol";
import {MockUSDC} from "./helpers/MockUSDC.sol";

contract SeedHarness is SeedDemo {
    function prepare(Plan memory plan, uint256[3] memory keys, TicketNFT nft, Escrow escrow, IntentRegistry registry, Settlement settlement)
        external returns (IntentRegistry.Intent[] memory)
    { return _seed(plan, keys, nft, escrow, registry, settlement); }
}

contract SeedDemoTest is Test {
    SeedHarness seed;
    TicketNFT nft;
    Escrow escrow;
    IntentRegistry registry;
    Settlement settlement;
    MockUSDC usdc;
    uint256[3] keys = [uint256(0xA11CE), uint256(0xB0B), uint256(0xC0C)];
    SeedDemo.Plan plan;

    function setUp() public {
        vm.chainId(5042002);
        seed = new SeedHarness();
        nft = new TicketNFT();
        escrow = new Escrow(address(nft));
        registry = new IntentRegistry();
        usdc = MockUSDC(0x3600000000000000000000000000000000000000);
        vm.etch(address(usdc), address(new MockUSDC()).code);
        settlement = new Settlement(address(registry), address(escrow), address(nft), address(usdc));
        registry.setSettlement(address(settlement));
        escrow.setSettlement(address(settlement));
        nft.registerIssuer(vm.addr(keys[0]));
        plan.deadline = uint64(block.timestamp + 30 days);
        plan.mintNew = true;
        for (uint256 i; i < 3; i++) {
            plan.owners.push(vm.addr(keys[i]));
            plan.nonces.push(0);
            vm.deal(plan.owners[i], 5 ether);
            usdc.mint(plan.owners[i], 10e6);
        }
        for (uint256 i; i < 12; i++) plan.ids.push(i);
    }

    function prepare() internal returns (IntentRegistry.Intent[] memory) {
        return seed.prepare(plan, keys, nft, escrow, registry, settlement);
    }

    function assertReady(IntentRegistry.Intent[] memory intents) internal view {
        assertEq(nft.nextTokenId(), 12);
        assertEq(intents.length, 3);
        for (uint256 i; i < 3; i++) {
            assertEq(registry.state(registry.hashIntent(intents[i])), registry.LIVE());
            for (uint256 j; j < 4; j++) {
                assertEq(nft.ownerOf(intents[i].offered[j]), address(escrow));
                assertEq(escrow.depositor(intents[i].offered[j]), plan.owners[i]);
            }
        }
    }

    function test_seed_is_live_then_settles_without_participants() public {
        IntentRegistry.Intent[] memory intents = prepare();
        assertReady(intents);
        Settlement.Leg[] memory legs = new Settlement.Leg[](3);
        for (uint256 i; i < 3; i++) legs[i] = Settlement.Leg(registry.hashIntent(intents[i]), intents[(i + 1) % 3].offered, intents[i].maxNetPay);
        vm.prank(address(0x501));
        settlement.settle(intents, legs);
        for (uint256 i; i < 3; i++) {
            assertEq(registry.state(legs[i].intentHash), registry.SETTLED());
            for (uint256 j; j < 4; j++) assertEq(nft.ownerOf(legs[i].receives[j]), plan.owners[i]);
        }
        assertEq(usdc.balanceOf(plan.owners[0]), 9900000);
        assertEq(usdc.balanceOf(plan.owners[2]), 10100000);
        // A second recording reuses the same twelve tickets with new signed nonces.
        plan.mintNew = false;
        for (uint256 i; i < 3; i++) {
            plan.nonces[i] = 1;
            for (uint256 j; j < 4; j++) plan.ids[i * 4 + j] = legs[i].receives[j];
        }
        assertReady(prepare());
    }

    function test_seed_rerun_does_not_mint_or_commit_duplicates() public {
        IntentRegistry.Intent[] memory before = prepare();
        IntentRegistry.Intent[] memory afterRun = prepare();
        assertReady(afterRun);
        for (uint256 i; i < 3; i++) assertEq(registry.hashIntent(before[i]), registry.hashIntent(afterRun[i]));
    }

    function test_seed_resumes_partial_mint_and_deposit() public {
        vm.startPrank(plan.owners[0]);
        nft.mint(plan.owners[0], 1, 0, 0, 1, 1);
        nft.mint(plan.owners[0], 1, 0, 0, 1, 2);
        nft.setApprovalForAll(address(escrow), true);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 0;
        escrow.deposit(ids);
        vm.stopPrank();
        assertReady(prepare());
    }

    function test_seed_rejects_changed_mint_inventory() public {
        vm.prank(plan.owners[0]);
        nft.mint(plan.owners[0], 1, 0, 0, 1, 9);
        vm.expectRevert(abi.encodeWithSelector(SeedDemo.SeedTicketUnavailable.selector, 0));
        prepare();
    }

    function test_seed_rejects_wrong_network() public {
        vm.chainId(31337);
        vm.expectRevert(SeedDemo.WrongSeedNetwork.selector);
        seed.run();
    }

    function test_seed_replaces_old_live_intents_with_new_nonces() public {
        IntentRegistry.Intent[] memory old = prepare();
        plan.mintNew = false;
        for (uint256 i; i < 3; i++) {
            plan.previous.push(registry.hashIntent(old[i]));
            plan.nonces[i] = 1;
        }
        IntentRegistry.Intent[] memory next = prepare();
        assertReady(next);
        for (uint256 i; i < 3; i++) {
            assertEq(registry.state(registry.hashIntent(old[i])), registry.REVOKED());
            assertTrue(registry.usedNonce(plan.owners[i], 0));
            assertTrue(registry.usedNonce(plan.owners[i], 1));
        }
        // A partially completed replacement can resume with the same plan.
        assertReady(prepare());
    }
}
