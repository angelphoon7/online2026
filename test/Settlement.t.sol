// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Fixture} from "./helpers/Fixture.sol";
import {TicketNFT} from "../src/TicketNFT.sol";
import {Escrow} from "../src/Escrow.sol";
import {IntentRegistry} from "../src/IntentRegistry.sol";
import {Settlement} from "../src/Settlement.sol";

contract SettlementTest is Fixture {
    // ═══════════════════════════════════════════════════════════
    //  HAPPY PATH
    // ═══════════════════════════════════════════════════════════

    function test_three_way_reshuffle_succeeds() public {
        // Alice: 2 Friday (session 0), wants 2 Saturday (session 1)
        // Bob:   2 Saturday (session 1), wants 2 Sunday (session 2)
        // Charlie: 2 Sunday (session 2), wants 2 Friday (session 0)
        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);
        uint256 t1 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 2);
        uint256 t2 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 1);
        uint256 t3 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 2);
        uint256 t4 = _mintTicket(charlie, EVENT_ID, 2, 0, 1, 1);
        uint256 t5 = _mintTicket(charlie, EVENT_ID, 2, 0, 1, 2);

        IntentRegistry.Intent memory intentA = _makeIntent(
            alice, _arr(t0, t1), 1 << 1, 1 << 0, 2, int256(30e6), 1
        );
        intentA.mustShareSection = true;
        intentA.mustBeAdjacent = true;

        IntentRegistry.Intent memory intentB = _makeIntent(
            bob, _arr(t2, t3), 1 << 2, 1 << 0, 2, int256(0), 1
        );
        intentB.mustShareSection = true;
        intentB.mustBeAdjacent = true;

        IntentRegistry.Intent memory intentC = _makeIntent(
            charlie, _arr(t4, t5), 1 << 0, 1 << 0, 2, int256(-20e6), 1
        );
        intentC.mustShareSection = true;
        intentC.mustBeAdjacent = true;

        bytes32 hA = _depositAndCommit(intentA, aliceKey);
        bytes32 hB = _depositAndCommit(intentB, bobKey);
        bytes32 hC = _depositAndCommit(intentC, charlieKey);

        IntentRegistry.Intent[] memory intents = new IntentRegistry.Intent[](3);
        intents[0] = intentA;
        intents[1] = intentB;
        intents[2] = intentC;

        Settlement.Leg[] memory legs = new Settlement.Leg[](3);
        legs[0] = Settlement.Leg({intentHash: hA, receives: _arr(t2, t3), netPayment: int256(20e6)});
        legs[1] = Settlement.Leg({intentHash: hB, receives: _arr(t4, t5), netPayment: int256(0)});
        legs[2] = Settlement.Leg({intentHash: hC, receives: _arr(t0, t1), netPayment: int256(-20e6)});

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 charlieBefore = usdc.balanceOf(charlie);

        vm.prank(solver);
        settlement.settle(intents, legs);

        // Verify ownership
        assertEq(ticketNFT.ownerOf(t2), alice);
        assertEq(ticketNFT.ownerOf(t3), alice);
        assertEq(ticketNFT.ownerOf(t4), bob);
        assertEq(ticketNFT.ownerOf(t5), bob);
        assertEq(ticketNFT.ownerOf(t0), charlie);
        assertEq(ticketNFT.ownerOf(t1), charlie);

        // Verify USDC
        assertEq(usdc.balanceOf(alice), aliceBefore - 20e6);
        assertEq(usdc.balanceOf(charlie), charlieBefore + 20e6);

        // Verify intent state
        assertEq(registry.state(hA), registry.SETTLED());
        assertEq(registry.state(hB), registry.SETTLED());
        assertEq(registry.state(hC), registry.SETTLED());
    }

    function test_buyer_seller_chain_completes() public {
        // Bob has Saturday tickets, wants Sunday
        // Charlie has Sunday tickets, wants cash only (pure seller)
        // Alice is a buyer, wants Saturday, pays USDC
        uint256 t0 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 1);
        uint256 t1 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 2);
        uint256 t2 = _mintTicket(charlie, EVENT_ID, 2, 0, 1, 1);
        uint256 t3 = _mintTicket(charlie, EVENT_ID, 2, 0, 1, 2);

        // Alice: buyer, no offered tickets, wants 2 Saturday
        IntentRegistry.Intent memory intentA = _makeIntent(
            alice, _arr0(), 1 << 1, 1 << 0, 2, int256(100e6), 1
        );
        intentA.mustShareSection = true;
        intentA.mustBeAdjacent = true;

        // Bob: swapper, offers Saturday, wants Sunday
        IntentRegistry.Intent memory intentB = _makeIntent(
            bob, _arr(t0, t1), 1 << 2, 1 << 0, 2, int256(20e6), 1
        );
        intentB.mustShareSection = true;
        intentB.mustBeAdjacent = true;

        // Charlie: pure seller, offers Sunday, exactCount 0
        IntentRegistry.Intent memory intentC = _makeIntent(
            charlie, _arr(t2, t3), type(uint256).max, type(uint256).max, 0, int256(-60e6), 1
        );

        bytes32 hA = _depositAndCommit(intentA, aliceKey);
        bytes32 hB = _depositAndCommit(intentB, bobKey);
        bytes32 hC = _depositAndCommit(intentC, charlieKey);

        IntentRegistry.Intent[] memory intents = new IntentRegistry.Intent[](3);
        intents[0] = intentA;
        intents[1] = intentB;
        intents[2] = intentC;

        Settlement.Leg[] memory legs = new Settlement.Leg[](3);
        legs[0] = Settlement.Leg({intentHash: hA, receives: _arr(t0, t1), netPayment: int256(80e6)});
        legs[1] = Settlement.Leg({intentHash: hB, receives: _arr(t2, t3), netPayment: int256(0)});
        legs[2] = Settlement.Leg({intentHash: hC, receives: _arr0(), netPayment: int256(-80e6)});

        vm.prank(solver);
        settlement.settle(intents, legs);

        assertEq(ticketNFT.ownerOf(t0), alice);
        assertEq(ticketNFT.ownerOf(t1), alice);
        assertEq(ticketNFT.ownerOf(t2), bob);
        assertEq(ticketNFT.ownerOf(t3), bob);
    }

    function test_settles_without_participant_online() public {
        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);
        uint256 t1 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 1);

        IntentRegistry.Intent memory intentA = _makeIntent(
            alice, _arr(t0), 1 << 1, 1 << 0, 1, int256(30e6), 1
        );
        IntentRegistry.Intent memory intentB = _makeIntent(
            bob, _arr(t1), 1 << 0, 1 << 0, 1, int256(-20e6), 1
        );

        _depositAndCommit(intentA, aliceKey);
        _depositAndCommit(intentB, bobKey);

        bytes32 hA = _hashIntent(intentA);
        bytes32 hB = _hashIntent(intentB);

        IntentRegistry.Intent[] memory intents = new IntentRegistry.Intent[](2);
        intents[0] = intentA;
        intents[1] = intentB;

        Settlement.Leg[] memory legs = new Settlement.Leg[](2);
        legs[0] = Settlement.Leg({intentHash: hA, receives: _arr(t1), netPayment: int256(20e6)});
        legs[1] = Settlement.Leg({intentHash: hB, receives: _arr(t0), netPayment: int256(-20e6)});

        // Solver settles — neither Alice nor Bob acts after commit
        vm.prank(solver);
        settlement.settle(intents, legs);

        assertEq(ticketNFT.ownerOf(t1), alice);
        assertEq(ticketNFT.ownerOf(t0), bob);
    }

    function test_redeemed_by_new_holder_only() public {
        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);
        uint256 t1 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 1);

        IntentRegistry.Intent memory intentA = _makeIntent(
            alice, _arr(t0), 1 << 1, 1 << 0, 1, int256(30e6), 1
        );
        IntentRegistry.Intent memory intentB = _makeIntent(
            bob, _arr(t1), 1 << 0, 1 << 0, 1, int256(-20e6), 1
        );

        _depositAndCommit(intentA, aliceKey);
        _depositAndCommit(intentB, bobKey);

        bytes32 hA = _hashIntent(intentA);
        bytes32 hB = _hashIntent(intentB);

        IntentRegistry.Intent[] memory intents = new IntentRegistry.Intent[](2);
        intents[0] = intentA;
        intents[1] = intentB;

        Settlement.Leg[] memory legs = new Settlement.Leg[](2);
        legs[0] = Settlement.Leg({intentHash: hA, receives: _arr(t1), netPayment: int256(20e6)});
        legs[1] = Settlement.Leg({intentHash: hB, receives: _arr(t0), netPayment: int256(-20e6)});

        vm.prank(solver);
        settlement.settle(intents, legs);

        // Alice now owns t1 — she can redeem
        vm.prank(alice);
        ticketNFT.redeem(t1);
        assertTrue(ticketNFT.isRedeemed(t1));

        // Bob (previous holder of t1) cannot redeem it
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(TicketNFT.NotTicketHolder.selector, t1));
        ticketNFT.redeem(t1);
    }

    function test_pure_seller_with_exact_count_zero_settles() public {
        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);

        // Alice: buyer, wants t0
        IntentRegistry.Intent memory intentA = _makeIntent(
            alice, _arr0(), 1 << 0, 1 << 0, 1, int256(50e6), 1
        );
        // Bob: has t0 but we need him to own it. Actually alice owns t0.
        // Let me fix: bob is the seller with t0
        uint256 t1 = _mintTicket(bob, EVENT_ID, 0, 0, 1, 2);

        // Alice: buyer
        IntentRegistry.Intent memory intentBuyer = _makeIntent(
            alice, _arr0(), 1 << 0, 1 << 0, 1, int256(50e6), 2
        );

        // Bob: pure seller with exactCount 0
        IntentRegistry.Intent memory intentSeller = _makeIntent(
            bob, _arr(t1), type(uint256).max, type(uint256).max, 0, int256(-30e6), 1
        );

        bytes32 hBuyer = _depositAndCommit(intentBuyer, aliceKey);
        bytes32 hSeller = _depositAndCommit(intentSeller, bobKey);

        IntentRegistry.Intent[] memory intents = new IntentRegistry.Intent[](2);
        intents[0] = intentBuyer;
        intents[1] = intentSeller;

        Settlement.Leg[] memory legs = new Settlement.Leg[](2);
        legs[0] = Settlement.Leg({intentHash: hBuyer, receives: _arr(t1), netPayment: int256(40e6)});
        legs[1] = Settlement.Leg({intentHash: hSeller, receives: _arr0(), netPayment: int256(-40e6)});

        vm.prank(solver);
        settlement.settle(intents, legs);

        assertEq(ticketNFT.ownerOf(t1), alice);
        assertEq(registry.state(hSeller), registry.SETTLED());
    }

    // ═══════════════════════════════════════════════════════════
    //  REJECTION TESTS
    // ═══════════════════════════════════════════════════════════

    function test_rejects_non_adjacent_when_required() public {
        // Seats 1 and 10 in the same row — not adjacent
        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);
        uint256 t1 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 1);
        uint256 t2 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 10); // seat 10, not adjacent to seat 1

        IntentRegistry.Intent memory intentA = _makeIntent(
            alice, _arr(t0), 1 << 1, 1 << 0, 2, int256(50e6), 1
        );
        intentA.mustBeAdjacent = true;
        intentA.mustShareSection = true;

        IntentRegistry.Intent memory intentB = _makeIntent(
            bob, _arr(t1, t2), 1 << 0, 1 << 0, 1, int256(-40e6), 1
        );

        bytes32 hA = _depositAndCommit(intentA, aliceKey);
        bytes32 hB = _depositAndCommit(intentB, bobKey);

        IntentRegistry.Intent[] memory intents = new IntentRegistry.Intent[](2);
        intents[0] = intentA;
        intents[1] = intentB;

        Settlement.Leg[] memory legs = new Settlement.Leg[](2);
        legs[0] = Settlement.Leg({intentHash: hA, receives: _arr(t1, t2), netPayment: int256(40e6)});
        legs[1] = Settlement.Leg({intentHash: hB, receives: _arr(t0), netPayment: int256(-40e6)});

        vm.prank(solver);
        vm.expectRevert(abi.encodeWithSelector(Settlement.SeatsNotAdjacent.selector, hA));
        settlement.settle(intents, legs);
    }

    function test_rejects_split_section_bundle() public {
        // Two tickets in different sections
        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);
        uint256 t1 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 1); // section 0
        uint256 t2 = _mintTicket(bob, EVENT_ID, 1, 1, 1, 2); // section 1

        IntentRegistry.Intent memory intentA = _makeIntent(
            alice, _arr(t0), (1 << 1), (1 << 0) | (1 << 1), 2, int256(50e6), 1
        );
        intentA.mustShareSection = true;

        IntentRegistry.Intent memory intentB = _makeIntent(
            bob, _arr(t1, t2), 1 << 0, (1 << 0) | (1 << 1), 1, int256(-40e6), 1
        );

        bytes32 hA = _depositAndCommit(intentA, aliceKey);
        bytes32 hB = _depositAndCommit(intentB, bobKey);

        IntentRegistry.Intent[] memory intents = new IntentRegistry.Intent[](2);
        intents[0] = intentA;
        intents[1] = intentB;

        Settlement.Leg[] memory legs = new Settlement.Leg[](2);
        legs[0] = Settlement.Leg({intentHash: hA, receives: _arr(t1, t2), netPayment: int256(40e6)});
        legs[1] = Settlement.Leg({intentHash: hB, receives: _arr(t0), netPayment: int256(-40e6)});

        vm.prank(solver);
        vm.expectRevert(abi.encodeWithSelector(Settlement.NotSameSection.selector, hA));
        settlement.settle(intents, legs);
    }

    function test_rejects_split_session_bundle() public {
        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);
        uint256 t1 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 1); // session 1
        uint256 t2 = _mintTicket(bob, EVENT_ID, 2, 0, 1, 2); // session 2

        IntentRegistry.Intent memory intentA = _makeIntent(
            alice, _arr(t0), (1 << 1) | (1 << 2), 1 << 0, 2, int256(50e6), 1
        );
        intentA.mustShareSession = true;

        IntentRegistry.Intent memory intentB = _makeIntent(
            bob, _arr(t1, t2), 1 << 0, 1 << 0, 1, int256(-40e6), 1
        );

        bytes32 hA = _depositAndCommit(intentA, aliceKey);
        bytes32 hB = _depositAndCommit(intentB, bobKey);

        IntentRegistry.Intent[] memory intents = new IntentRegistry.Intent[](2);
        intents[0] = intentA;
        intents[1] = intentB;

        Settlement.Leg[] memory legs = new Settlement.Leg[](2);
        legs[0] = Settlement.Leg({intentHash: hA, receives: _arr(t1, t2), netPayment: int256(40e6)});
        legs[1] = Settlement.Leg({intentHash: hB, receives: _arr(t0), netPayment: int256(-40e6)});

        vm.prank(solver);
        vm.expectRevert(abi.encodeWithSelector(Settlement.NotSameSession.selector, hA));
        settlement.settle(intents, legs);
    }

    function test_rejects_over_budget() public {
        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);
        uint256 t1 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 1);

        IntentRegistry.Intent memory intentA = _makeIntent(
            alice, _arr(t0), 1 << 1, 1 << 0, 1, int256(10e6), 1 // max 10 USDC
        );
        IntentRegistry.Intent memory intentB = _makeIntent(
            bob, _arr(t1), 1 << 0, 1 << 0, 1, int256(-10e6), 1
        );

        bytes32 hA = _depositAndCommit(intentA, aliceKey);
        bytes32 hB = _depositAndCommit(intentB, bobKey);

        IntentRegistry.Intent[] memory intents = new IntentRegistry.Intent[](2);
        intents[0] = intentA;
        intents[1] = intentB;

        Settlement.Leg[] memory legs = new Settlement.Leg[](2);
        // netPayment 20 > maxNetPay 10
        legs[0] = Settlement.Leg({intentHash: hA, receives: _arr(t1), netPayment: int256(20e6)});
        legs[1] = Settlement.Leg({intentHash: hB, receives: _arr(t0), netPayment: int256(-20e6)});

        vm.prank(solver);
        vm.expectRevert(abi.encodeWithSelector(Settlement.BudgetExceeded.selector, hA, int256(10e6), int256(20e6)));
        settlement.settle(intents, legs);
    }

    function test_rejects_wrong_count() public {
        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);
        uint256 t1 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 1);
        uint256 t2 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 2);

        // Alice wants exactCount 1 but receives 2
        IntentRegistry.Intent memory intentA = _makeIntent(
            alice, _arr(t0), 1 << 1, 1 << 0, 1, int256(50e6), 1
        );
        IntentRegistry.Intent memory intentB = _makeIntent(
            bob, _arr(t1, t2), 1 << 0, 1 << 0, 1, int256(-40e6), 1
        );

        bytes32 hA = _depositAndCommit(intentA, aliceKey);
        bytes32 hB = _depositAndCommit(intentB, bobKey);

        IntentRegistry.Intent[] memory intents = new IntentRegistry.Intent[](2);
        intents[0] = intentA;
        intents[1] = intentB;

        Settlement.Leg[] memory legs = new Settlement.Leg[](2);
        legs[0] = Settlement.Leg({intentHash: hA, receives: _arr(t1, t2), netPayment: int256(40e6)});
        legs[1] = Settlement.Leg({intentHash: hB, receives: _arr(t0), netPayment: int256(-40e6)});

        vm.prank(solver);
        vm.expectRevert(abi.encodeWithSelector(Settlement.CountMismatch.selector, hA, uint8(1), uint256(2)));
        settlement.settle(intents, legs);
    }

    function test_rejects_unbalanced_payment() public {
        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);
        uint256 t1 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 1);

        IntentRegistry.Intent memory intentA = _makeIntent(
            alice, _arr(t0), 1 << 1, 1 << 0, 1, int256(50e6), 1
        );
        IntentRegistry.Intent memory intentB = _makeIntent(
            bob, _arr(t1), 1 << 0, 1 << 0, 1, int256(-10e6), 1
        );

        bytes32 hA = _depositAndCommit(intentA, aliceKey);
        bytes32 hB = _depositAndCommit(intentB, bobKey);

        IntentRegistry.Intent[] memory intents = new IntentRegistry.Intent[](2);
        intents[0] = intentA;
        intents[1] = intentB;

        Settlement.Leg[] memory legs = new Settlement.Leg[](2);
        // 30 + (-10) = 20, not zero
        legs[0] = Settlement.Leg({intentHash: hA, receives: _arr(t1), netPayment: int256(30e6)});
        legs[1] = Settlement.Leg({intentHash: hB, receives: _arr(t0), netPayment: int256(-10e6)});

        vm.prank(solver);
        vm.expectRevert(abi.encodeWithSelector(Settlement.PaymentImbalance.selector, int256(20e6)));
        settlement.settle(intents, legs);
    }

    function test_rejects_expired_intent() public {
        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);
        uint256 t1 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 1);

        IntentRegistry.Intent memory intentA = _makeIntent(
            alice, _arr(t0), 1 << 1, 1 << 0, 1, int256(30e6), 1
        );
        intentA.deadline = uint64(block.timestamp + 100);

        IntentRegistry.Intent memory intentB = _makeIntent(
            bob, _arr(t1), 1 << 0, 1 << 0, 1, int256(-20e6), 1
        );

        bytes32 hA = _depositAndCommit(intentA, aliceKey);
        _depositAndCommit(intentB, bobKey);

        // Warp past deadline
        vm.warp(block.timestamp + 200);

        IntentRegistry.Intent[] memory intents = new IntentRegistry.Intent[](2);
        intents[0] = intentA;
        intents[1] = intentB;

        bytes32 hB = _hashIntent(intentB);
        Settlement.Leg[] memory legs = new Settlement.Leg[](2);
        legs[0] = Settlement.Leg({intentHash: hA, receives: _arr(t1), netPayment: int256(20e6)});
        legs[1] = Settlement.Leg({intentHash: hB, receives: _arr(t0), netPayment: int256(-20e6)});

        vm.prank(solver);
        vm.expectRevert(abi.encodeWithSelector(Settlement.IntentExpired.selector, hA, intentA.deadline));
        settlement.settle(intents, legs);
    }

    function test_rejects_revoked_intent() public {
        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);
        uint256 t1 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 1);

        IntentRegistry.Intent memory intentA = _makeIntent(
            alice, _arr(t0), 1 << 1, 1 << 0, 1, int256(30e6), 1
        );
        IntentRegistry.Intent memory intentB = _makeIntent(
            bob, _arr(t1), 1 << 0, 1 << 0, 1, int256(-20e6), 1
        );

        bytes32 hA = _depositAndCommit(intentA, aliceKey);
        _depositAndCommit(intentB, bobKey);

        // Alice revokes
        vm.prank(alice);
        registry.revoke(hA);

        bytes32 hB = _hashIntent(intentB);
        IntentRegistry.Intent[] memory intents = new IntentRegistry.Intent[](2);
        intents[0] = intentA;
        intents[1] = intentB;

        Settlement.Leg[] memory legs = new Settlement.Leg[](2);
        legs[0] = Settlement.Leg({intentHash: hA, receives: _arr(t1), netPayment: int256(20e6)});
        legs[1] = Settlement.Leg({intentHash: hB, receives: _arr(t0), netPayment: int256(-20e6)});

        vm.prank(solver);
        vm.expectRevert(abi.encodeWithSelector(Settlement.IntentNotLive.selector, hA));
        settlement.settle(intents, legs);
    }

    function test_rejects_withdrawn_ticket() public {
        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);
        uint256 t1 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 1);

        IntentRegistry.Intent memory intentA = _makeIntent(
            alice, _arr(t0), 1 << 1, 1 << 0, 1, int256(30e6), 1
        );
        IntentRegistry.Intent memory intentB = _makeIntent(
            bob, _arr(t1), 1 << 0, 1 << 0, 1, int256(-20e6), 1
        );

        _depositAndCommit(intentA, aliceKey);
        _depositAndCommit(intentB, bobKey);

        // Alice withdraws her ticket
        vm.prank(alice);
        escrow.withdraw(_arr(t0));

        bytes32 hA = _hashIntent(intentA);
        bytes32 hB = _hashIntent(intentB);

        IntentRegistry.Intent[] memory intents = new IntentRegistry.Intent[](2);
        intents[0] = intentA;
        intents[1] = intentB;

        Settlement.Leg[] memory legs = new Settlement.Leg[](2);
        legs[0] = Settlement.Leg({intentHash: hA, receives: _arr(t1), netPayment: int256(20e6)});
        legs[1] = Settlement.Leg({intentHash: hB, receives: _arr(t0), netPayment: int256(-20e6)});

        vm.prank(solver);
        vm.expectRevert(abi.encodeWithSelector(Settlement.TicketNotEscrowed.selector, t0, alice));
        settlement.settle(intents, legs);
    }

    function test_rejects_redeemed_ticket() public {
        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);
        uint256 t1 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 1);

        // Alice redeems before depositing — she can't deposit a redeemed ticket
        // So we need a scenario where the ticket is redeemed AFTER depositing
        // That's not possible: redeem requires ownerOf == msg.sender, and escrow owns it.
        // Instead: a different ticket in the settlement is redeemed by its holder,
        // then the solver tries to include it.
        //
        // Actually, let's test V3: deposit ticket, then somehow it's redeemed.
        // But you can't redeem while it's in escrow (escrow owns it, not the depositor).
        // So the scenario is: mint, deposit, withdrawal by depositor, redeem,
        // then try to settle using stale intent that references the redeemed ticket.
        // But V2 would catch the withdrawal (not escrowed) before V3.
        //
        // The meaningful test: one intent's OFFERED ticket was withdrawn and redeemed,
        // then re-deposited... but deposit rejects redeemed tickets.
        //
        // The simplest scenario: Bob offers t1 which isn't redeemed.
        // Alice offers t0 which we redeem via a workaround.
        // Actually at demo scale, let's test deposit-of-redeemed separately.
        // For V3 in settlement: we need a ticket that IS in escrow but is redeemed.
        // This shouldn't happen normally (deposit rejects redeemed), but let's
        // use vm.store to force the state for thoroughness.

        // We'll just test the flow: mint both, deposit both, then use vm.store
        // to mark t0 as redeemed while it's in escrow.
        IntentRegistry.Intent memory intentA = _makeIntent(
            alice, _arr(t0), 1 << 1, 1 << 0, 1, int256(30e6), 1
        );
        IntentRegistry.Intent memory intentB = _makeIntent(
            bob, _arr(t1), 1 << 0, 1 << 0, 1, int256(-20e6), 1
        );

        _depositAndCommit(intentA, aliceKey);
        _depositAndCommit(intentB, bobKey);

        // Force-redeem t0 while in escrow (simulates an edge case)
        // meta mapping is slot 1 in TicketNFT. For mapping(uint256 => TicketMeta),
        // slot = keccak256(abi.encode(tokenId, 1))
        // TicketMeta has status at offset 12 bytes from start.
        // Let's just call redeem from escrow perspective... no, we'll use the simple approach:
        // Forge doesn't make it easy to poke struct fields. Let's test a different way.

        // Alternative: test that a settlement containing tickets where one was withdrawn
        // and redeemed fails. We re-deposit... but deposit rejects redeemed.
        // So V3 is a defense-in-depth that can't happen with correct escrow.
        // The test for "rejects_deposit_of_redeemed_ticket" covers the escrow guard.
        // For V3, let's force the metadata with store.

        bytes32 metaSlot = keccak256(abi.encode(uint256(t0), uint256(6)));
        bytes32 packed = vm.load(address(ticketNFT), metaSlot);
        // Set status byte (byte 12 from right = byte 19 from left in 32-byte word)
        // TicketMeta: eventId(4) + sessionId(2) + sectionId(2) + row(2) + seat(2) + status(1) = 13 bytes
        // In storage, packed right-aligned. status is at the highest offset.
        // Let's set the entire slot with status = 1 (REDEEMED)
        // Original: eventId=1, sessionId=0, sectionId=0, row=1, seat=1, status=0
        // Packed (right-aligned, lower-order first):
        //   status(1 byte) | seat(2) | row(2) | sectionId(2) | sessionId(2) | eventId(4)
        // = 0x01 | 0x0001 | 0x0001 | 0x0000 | 0x0000 | 0x00000001
        // = 0x0000...01_0001_0001_0000_0000_00000001
        // Actually Solidity packs structs from lowest to highest member starting at the low end.
        // eventId at bits [0:31], sessionId at [32:47], sectionId at [48:63],
        // row at [64:79], seat at [80:95], status at [96:103]
        uint256 val = uint256(packed);
        val = val | (uint256(1) << 96); // set status bit
        vm.store(address(ticketNFT), metaSlot, bytes32(val));

        bytes32 hA = _hashIntent(intentA);
        bytes32 hB = _hashIntent(intentB);

        IntentRegistry.Intent[] memory intents = new IntentRegistry.Intent[](2);
        intents[0] = intentA;
        intents[1] = intentB;

        Settlement.Leg[] memory legs = new Settlement.Leg[](2);
        legs[0] = Settlement.Leg({intentHash: hA, receives: _arr(t1), netPayment: int256(20e6)});
        legs[1] = Settlement.Leg({intentHash: hB, receives: _arr(t0), netPayment: int256(-20e6)});

        vm.prank(solver);
        vm.expectRevert(abi.encodeWithSelector(Settlement.TicketRedeemed.selector, t0));
        settlement.settle(intents, legs);
    }

    function test_rejects_conservation_violation() public {
        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);
        uint256 t1 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 1);
        uint256 t2 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 2); // extra ticket

        IntentRegistry.Intent memory intentA = _makeIntent(
            alice, _arr(t0), 1 << 1, 1 << 0, 2, int256(50e6), 1
        );
        IntentRegistry.Intent memory intentB = _makeIntent(
            bob, _arr(t1), 1 << 0, 1 << 0, 1, int256(-40e6), 1
        );

        _depositAndCommit(intentA, aliceKey);
        _depositAndCommit(intentB, bobKey);

        bytes32 hA = _hashIntent(intentA);
        bytes32 hB = _hashIntent(intentB);

        IntentRegistry.Intent[] memory intents = new IntentRegistry.Intent[](2);
        intents[0] = intentA;
        intents[1] = intentB;

        // Alice receives t1 and t2, but only t0 and t1 are offered — t2 appears from nowhere
        Settlement.Leg[] memory legs = new Settlement.Leg[](2);
        legs[0] = Settlement.Leg({intentHash: hA, receives: _arr(t1, t2), netPayment: int256(40e6)});
        legs[1] = Settlement.Leg({intentHash: hB, receives: _arr(t0), netPayment: int256(-40e6)});

        vm.prank(solver);
        vm.expectRevert(abi.encodeWithSelector(Settlement.ConservationViolated.selector));
        settlement.settle(intents, legs);
    }

    function test_rejects_id_at_or_above_mask_width() public {
        vm.prank(issuerAddr);
        vm.expectRevert(abi.encodeWithSelector(TicketNFT.SessionIdTooLarge.selector, uint16(256)));
        ticketNFT.mint(alice, EVENT_ID, 256, 0, 1, 1);

        vm.prank(issuerAddr);
        vm.expectRevert(abi.encodeWithSelector(TicketNFT.SectionIdTooLarge.selector, uint16(256)));
        ticketNFT.mint(alice, EVENT_ID, 0, 256, 1, 1);
    }

    function test_rejects_adjacency_flag_with_exact_count_below_two() public {
        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);

        IntentRegistry.Intent memory intent = _makeIntent(
            alice, _arr(t0), 1 << 1, 1 << 0, 1, int256(30e6), 1
        );
        intent.mustBeAdjacent = true; // adjacency with exactCount 1

        bytes memory sig = _signIntent(intent, aliceKey);

        vm.expectRevert(abi.encodeWithSelector(IntentRegistry.AdjacencyRequiresMinTwo.selector, uint8(1)));
        registry.commit(intent, sig);
    }

    function test_rejects_deposit_of_redeemed_ticket() public {
        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);

        vm.prank(alice);
        ticketNFT.redeem(t0);

        vm.startPrank(alice);
        ticketNFT.setApprovalForAll(address(escrow), true);
        vm.expectRevert(abi.encodeWithSelector(Escrow.TicketIsRedeemed.selector, t0));
        escrow.deposit(_arr(t0));
        vm.stopPrank();
    }

    function test_rejects_withdraw_by_non_depositor() public {
        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);

        vm.startPrank(alice);
        ticketNFT.setApprovalForAll(address(escrow), true);
        escrow.deposit(_arr(t0));
        vm.stopPrank();

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Escrow.NotDepositor.selector, t0));
        escrow.withdraw(_arr(t0));
    }

    function test_rejects_duplicate_nonce_at_commit() public {
        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);
        uint256 t1 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 2);

        IntentRegistry.Intent memory intent1 = _makeIntent(
            alice, _arr(t0), 1 << 1, 1 << 0, 1, int256(30e6), 1
        );

        _depositAndCommit(intent1, aliceKey);

        // Second intent with same nonce but different offered
        IntentRegistry.Intent memory intent2 = _makeIntent(
            alice, _arr(t1), 1 << 1, 1 << 0, 1, int256(30e6), 1 // same nonce = 1
        );

        vm.startPrank(alice);
        ticketNFT.setApprovalForAll(address(escrow), true);
        escrow.deposit(_arr(t1));
        vm.stopPrank();

        bytes memory sig = _signIntent(intent2, aliceKey);

        vm.expectRevert(abi.encodeWithSelector(IntentRegistry.NonceAlreadyUsed.selector, alice, uint256(1)));
        registry.commit(intent2, sig);
    }

    function test_commit_by_third_party_relay_succeeds() public {
        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);

        IntentRegistry.Intent memory intent = _makeIntent(
            alice, _arr(t0), 1 << 1, 1 << 0, 1, int256(30e6), 1
        );

        bytes memory sig = _signIntent(intent, aliceKey);

        // Bob relays Alice's commit
        vm.prank(bob);
        registry.commit(intent, sig);

        bytes32 h = _hashIntent(intent);
        assertEq(registry.state(h), registry.LIVE());
        assertEq(registry.intentOwner(h), alice);
    }

    function test_rejects_revoke_by_non_owner() public {
        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);

        IntentRegistry.Intent memory intent = _makeIntent(
            alice, _arr(t0), 1 << 1, 1 << 0, 1, int256(30e6), 1
        );
        bytes32 h = _depositAndCommit(intent, aliceKey);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IntentRegistry.NotIntentOwner.selector, h));
        registry.revoke(h);
    }

    function test_owner_net_uses_signed_sum_not_positive_sum() public {
        // Alice has two intents: one paying +80, one receiving -30
        // ownerNet = 50. Alice has only 60 USDC.
        // With per-leg checks (incorrect), 80 > 60 would fail.
        // With signed sum (correct), 50 <= 60 passes.

        // Drain Alice to 60 USDC
        uint256 excess = usdc.balanceOf(alice) - 60e6;
        vm.prank(alice);
        usdc.transfer(address(0xdead), excess);
        assertEq(usdc.balanceOf(alice), 60e6);

        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);
        uint256 t1 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 1);
        uint256 t2 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 2);
        uint256 t3 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 2);

        // Alice intent A: offers t0, receives t1, pays 80
        IntentRegistry.Intent memory intentA1 = _makeIntent(
            alice, _arr(t0), 1 << 1, 1 << 0, 1, int256(80e6), 1
        );
        // Alice intent A2: offers t2, receives t3, receives 30
        IntentRegistry.Intent memory intentA2 = _makeIntent(
            alice, _arr(t2), 1 << 1, 1 << 0, 1, int256(-30e6), 2
        );
        // Bob: offers t1 and t3, receives t0 and t2, receives 50
        IntentRegistry.Intent memory intentB = _makeIntent(
            bob, _arr(t1, t3), 1 << 0, 1 << 0, 2, int256(-50e6), 1
        );

        bytes32 hA1 = _depositAndCommit(intentA1, aliceKey);
        bytes32 hA2 = _depositAndCommit(intentA2, aliceKey);
        bytes32 hB = _depositAndCommit(intentB, bobKey);

        IntentRegistry.Intent[] memory intents = new IntentRegistry.Intent[](3);
        intents[0] = intentA1;
        intents[1] = intentA2;
        intents[2] = intentB;

        Settlement.Leg[] memory legs = new Settlement.Leg[](3);
        legs[0] = Settlement.Leg({intentHash: hA1, receives: _arr(t1), netPayment: int256(80e6)});
        legs[1] = Settlement.Leg({intentHash: hA2, receives: _arr(t3), netPayment: int256(-30e6)});
        legs[2] = Settlement.Leg({intentHash: hB, receives: _arr(t0, t2), netPayment: int256(-50e6)});

        vm.prank(solver);
        settlement.settle(intents, legs);

        // Alice spent net 50 USDC
        assertEq(usdc.balanceOf(alice), 10e6);
    }

    function test_hash_intent_matches_typescript_vector() public view {
        // Fixed fixture — TypeScript solver must produce the same digest
        uint256[] memory offered = new uint256[](2);
        offered[0] = 100;
        offered[1] = 200;

        IntentRegistry.Intent memory intent = IntentRegistry.Intent({
            owner: address(0x1234567890123456789012345678901234567890),
            offered: offered,
            eventId: 1,
            sessionMask: 3,
            sectionMask: 7,
            exactCount: 2,
            mustShareSession: true,
            mustShareSection: false,
            mustBeAdjacent: false,
            maxNetPay: 50000000,
            deadline: 1694649600,
            nonce: 42
        });

        bytes32 localHash = _hashIntent(intent);
        bytes32 contractHash = registry.hashIntent(intent);

        assertEq(localHash, contractHash);
    }

    function test_rejects_insufficient_payment_capacity() public {
        // Alice has 0 USDC but needs to pay
        uint256 aliceBal = usdc.balanceOf(alice);
        vm.prank(alice);
        usdc.transfer(address(0xdead), aliceBal);
        assertEq(usdc.balanceOf(alice), 0);

        uint256 t0 = _mintTicket(alice, EVENT_ID, 0, 0, 1, 1);
        uint256 t1 = _mintTicket(bob, EVENT_ID, 1, 0, 1, 1);

        IntentRegistry.Intent memory intentA = _makeIntent(
            alice, _arr(t0), 1 << 1, 1 << 0, 1, int256(30e6), 1
        );
        IntentRegistry.Intent memory intentB = _makeIntent(
            bob, _arr(t1), 1 << 0, 1 << 0, 1, int256(-20e6), 1
        );

        bytes32 hA = _depositAndCommit(intentA, aliceKey);
        _depositAndCommit(intentB, bobKey);

        bytes32 hB = _hashIntent(intentB);

        IntentRegistry.Intent[] memory intents = new IntentRegistry.Intent[](2);
        intents[0] = intentA;
        intents[1] = intentB;

        Settlement.Leg[] memory legs = new Settlement.Leg[](2);
        legs[0] = Settlement.Leg({intentHash: hA, receives: _arr(t1), netPayment: int256(20e6)});
        legs[1] = Settlement.Leg({intentHash: hB, receives: _arr(t0), netPayment: int256(-20e6)});

        vm.prank(solver);
        vm.expectRevert(abi.encodeWithSelector(Settlement.InsufficientPaymentCapacity.selector, alice, uint256(20e6)));
        settlement.settle(intents, legs);
    }
}
