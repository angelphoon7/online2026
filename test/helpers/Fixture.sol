// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {TicketNFT} from "../../src/TicketNFT.sol";
import {Escrow} from "../../src/Escrow.sol";
import {IntentRegistry} from "../../src/IntentRegistry.sol";
import {Settlement} from "../../src/Settlement.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract Fixture is Test {
    TicketNFT public ticketNFT;
    Escrow public escrow;
    IntentRegistry public registry;
    Settlement public settlement;
    MockUSDC public usdc;

    uint256 internal aliceKey = 0xA11CE;
    uint256 internal bobKey = 0xB0B;
    uint256 internal charlieKey = 0xC0C;
    uint256 internal issuerKey = 0x155;
    uint256 internal solverKey = 0x501;

    address internal alice;
    address internal bob;
    address internal charlie;
    address internal issuerAddr;
    address internal solver;

    uint32 internal constant EVENT_ID = 1;
    uint64 internal constant FAR_DEADLINE = type(uint64).max;

    function setUp() public virtual {
        alice = vm.addr(aliceKey);
        bob = vm.addr(bobKey);
        charlie = vm.addr(charlieKey);
        issuerAddr = vm.addr(issuerKey);
        solver = vm.addr(solverKey);

        ticketNFT = new TicketNFT();
        escrow = new Escrow(address(ticketNFT));
        registry = new IntentRegistry();
        usdc = new MockUSDC();
        settlement = new Settlement(
            address(registry),
            address(escrow),
            address(ticketNFT),
            address(usdc)
        );

        escrow.setSettlement(address(settlement));
        registry.setSettlement(address(settlement));
        ticketNFT.registerIssuer(issuerAddr);

        usdc.mint(alice, 1000e6);
        usdc.mint(bob, 1000e6);
        usdc.mint(charlie, 1000e6);

        vm.prank(alice);
        usdc.approve(address(settlement), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(settlement), type(uint256).max);
        vm.prank(charlie);
        usdc.approve(address(settlement), type(uint256).max);
    }

    // ─── Helpers ────────────────────────────────────────────

    function _mintTicket(
        address to,
        uint32 eventId,
        uint16 sessionId,
        uint16 sectionId,
        uint16 row,
        uint16 seat
    ) internal returns (uint256) {
        vm.prank(issuerAddr);
        return ticketNFT.mint(to, eventId, sessionId, sectionId, row, seat);
    }

    function _hashIntent(IntentRegistry.Intent memory intent) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                registry.INTENT_TYPEHASH(),
                intent.owner,
                keccak256(abi.encodePacked(intent.offered)),
                intent.eventId,
                intent.sessionMask,
                intent.sectionMask,
                intent.exactCount,
                intent.mustShareSession,
                intent.mustShareSection,
                intent.mustBeAdjacent,
                intent.maxNetPay,
                intent.deadline,
                intent.nonce
            )
        );
    }

    function _signIntent(
        IntentRegistry.Intent memory intent,
        uint256 privateKey
    ) internal view returns (bytes memory) {
        bytes32 structHash = _hashIntent(intent);
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", registry.DOMAIN_SEPARATOR(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _depositAndCommit(
        IntentRegistry.Intent memory intent,
        uint256 privateKey
    ) internal returns (bytes32) {
        address owner = intent.owner;

        if (intent.offered.length > 0) {
            vm.startPrank(owner);
            ticketNFT.setApprovalForAll(address(escrow), true);
            escrow.deposit(intent.offered);
            vm.stopPrank();
        }

        bytes memory sig = _signIntent(intent, privateKey);
        registry.commit(intent, sig);

        return _hashIntent(intent);
    }

    function _makeIntent(
        address owner,
        uint256[] memory offered,
        uint256 sessionMask,
        uint256 sectionMask,
        uint8 exactCount,
        int256 maxNetPay,
        uint256 nonce
    ) internal pure returns (IntentRegistry.Intent memory) {
        return IntentRegistry.Intent({
            owner: owner,
            offered: offered,
            eventId: EVENT_ID,
            sessionMask: sessionMask,
            sectionMask: sectionMask,
            exactCount: exactCount,
            mustShareSession: false,
            mustShareSection: false,
            mustBeAdjacent: false,
            maxNetPay: maxNetPay,
            deadline: FAR_DEADLINE,
            nonce: nonce
        });
    }

    function _arr(uint256 a) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = a;
    }

    function _arr(uint256 a, uint256 b) internal pure returns (uint256[] memory r) {
        r = new uint256[](2);
        r[0] = a;
        r[1] = b;
    }

    function _arr0() internal pure returns (uint256[] memory) {
        return new uint256[](0);
    }
}
