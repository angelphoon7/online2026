// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {TicketNFT} from "../src/TicketNFT.sol";
import {Escrow} from "../src/Escrow.sol";
import {IntentRegistry} from "../src/IntentRegistry.sol";
import {Settlement} from "../src/Settlement.sol";
import {MockUSDC} from "../test/helpers/MockUSDC.sol";

/// @dev Seeds a local Anvil with three families, escrowed tickets, committed
///      intents, and USDC — the frontend opens in a ready-to-settle state.
///
///      Alice (key 1): holds Saturday Floor seats, wants Sunday
///      Bob   (key 2): holds Sunday Floor seats, wants Saturday
///      Carol (key 3): buyer — no tickets, wants 2 Sunday Tier 1, pays USDC
///      Issuer (key 0): mints all tickets, registers itself, seeds USDC
///
///      Run: PRIVATE_KEY=$KEY0 forge script script/SeedDemo.s.sol:SeedDemo \
///             --rpc-url http://127.0.0.1:8545 --broadcast
contract SeedDemo is Script {
    uint32 constant EVENT_ID = 1;
    uint64 constant DEADLINE = type(uint64).max;

    function run() external {
        // Anvil default accounts — keys 0-3
        uint256 issuerKey  = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        uint256 aliceKey   = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
        uint256 bobKey     = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
        uint256 carolKey   = 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6;

        address issuer = vm.addr(issuerKey);
        address alice  = vm.addr(aliceKey);
        address bob    = vm.addr(bobKey);
        address carol  = vm.addr(carolKey);

        // ── Deploy ─────────────────────────────────────────────
        vm.startBroadcast(issuerKey);

        MockUSDC usdc = new MockUSDC();
        TicketNFT nft = new TicketNFT();
        Escrow escrow = new Escrow(address(nft));
        IntentRegistry registry = new IntentRegistry();
        Settlement settlement = new Settlement(
            address(registry), address(escrow), address(nft), address(usdc)
        );
        escrow.setSettlement(address(settlement));
        registry.setSettlement(address(settlement));
        nft.registerIssuer(issuer);

        // ── Mint tickets ───────────────────────────────────────
        // Alice: Saturday (0) Floor (0) Row 1 Seats 1-2
        uint256 a0 = nft.mint(alice, EVENT_ID, 0, 0, 1, 1);
        uint256 a1 = nft.mint(alice, EVENT_ID, 0, 0, 1, 2);

        // Bob: Sunday (1) Floor (0) Row 1 Seats 1-2
        uint256 b0 = nft.mint(bob, EVENT_ID, 1, 0, 1, 1);
        uint256 b1 = nft.mint(bob, EVENT_ID, 1, 0, 1, 2);

        // Extra inventory: Sunday (1) Tier 1 (1) Row 2 Seats 1-2  — for Carol
        uint256 x0 = nft.mint(issuer, EVENT_ID, 1, 1, 2, 1);
        uint256 x1 = nft.mint(issuer, EVENT_ID, 1, 1, 2, 2);

        // ── Seed USDC ──────────────────────────────────────────
        usdc.mint(alice, 500e6);
        usdc.mint(bob, 500e6);
        usdc.mint(carol, 500e6);
        usdc.mint(issuer, 500e6);

        vm.stopBroadcast();

        // ── Alice: deposit + approve + commit ──────────────────
        vm.startBroadcast(aliceKey);
        nft.setApprovalForAll(address(escrow), true);
        {
            uint256[] memory ids = new uint256[](2);
            ids[0] = a0; ids[1] = a1;
            escrow.deposit(ids);
        }
        usdc.approve(address(settlement), type(uint256).max);
        vm.stopBroadcast();

        IntentRegistry.Intent memory intentA = IntentRegistry.Intent({
            owner: alice,
            offered: _arr(a0, a1),
            eventId: EVENT_ID,
            sessionMask: 1 << 1,     // wants Sunday
            sectionMask: 1 << 0,     // Floor
            exactCount: 2,
            mustShareSession: true,
            mustShareSection: true,
            mustBeAdjacent: true,
            maxNetPay: int256(50e6),  // willing to pay up to 50 USDC
            deadline: DEADLINE,
            nonce: 0
        });
        _commitIntent(registry, intentA, aliceKey);

        // ── Bob: deposit + approve + commit ────────────────────
        vm.startBroadcast(bobKey);
        nft.setApprovalForAll(address(escrow), true);
        {
            uint256[] memory ids = new uint256[](2);
            ids[0] = b0; ids[1] = b1;
            escrow.deposit(ids);
        }
        usdc.approve(address(settlement), type(uint256).max);
        vm.stopBroadcast();

        IntentRegistry.Intent memory intentB = IntentRegistry.Intent({
            owner: bob,
            offered: _arr(b0, b1),
            eventId: EVENT_ID,
            sessionMask: 1 << 0,     // wants Saturday
            sectionMask: 1 << 0,     // Floor
            exactCount: 2,
            mustShareSession: true,
            mustShareSection: true,
            mustBeAdjacent: true,
            maxNetPay: int256(-30e6), // wants at least 30 USDC
            deadline: DEADLINE,
            nonce: 0
        });
        _commitIntent(registry, intentB, bobKey);

        // ── Issuer as seller: deposit inventory ────────────────
        vm.startBroadcast(issuerKey);
        nft.setApprovalForAll(address(escrow), true);
        {
            uint256[] memory ids = new uint256[](2);
            ids[0] = x0; ids[1] = x1;
            escrow.deposit(ids);
        }
        usdc.approve(address(settlement), type(uint256).max);
        vm.stopBroadcast();

        IntentRegistry.Intent memory intentIssuer = IntentRegistry.Intent({
            owner: issuer,
            offered: _arr(x0, x1),
            eventId: EVENT_ID,
            sessionMask: type(uint256).max, // accepts any session back
            sectionMask: type(uint256).max,
            exactCount: 0,                  // pure seller
            mustShareSession: false,
            mustShareSection: false,
            mustBeAdjacent: false,
            maxNetPay: int256(-20e6),       // wants at least 20 USDC
            deadline: DEADLINE,
            nonce: 0
        });
        _commitIntent(registry, intentIssuer, issuerKey);

        // ── Carol: pure buyer, no tickets ──────────────────────
        vm.startBroadcast(carolKey);
        usdc.approve(address(settlement), type(uint256).max);
        vm.stopBroadcast();

        IntentRegistry.Intent memory intentC = IntentRegistry.Intent({
            owner: carol,
            offered: new uint256[](0),
            eventId: EVENT_ID,
            sessionMask: 1 << 1,     // Sunday
            sectionMask: (1 << 0) | (1 << 1), // Floor or Tier 1
            exactCount: 2,
            mustShareSession: true,
            mustShareSection: true,
            mustBeAdjacent: true,
            maxNetPay: int256(80e6),  // willing to pay up to 80 USDC
            deadline: DEADLINE,
            nonce: 0
        });
        _commitIntent(registry, intentC, carolKey);

        // ── Print ──────────────────────────────────────────────
        console.log("=== SeedDemo Complete ===");
        console.log("MockUSDC:       ", address(usdc));
        console.log("TicketNFT:      ", address(nft));
        console.log("Escrow:         ", address(escrow));
        console.log("IntentRegistry: ", address(registry));
        console.log("Settlement:     ", address(settlement));
        console.log("");
        console.log("Alice  :", alice);
        console.log("Bob    :", bob);
        console.log("Carol  :", carol);
        console.log("Issuer :", issuer);
        console.log("");
        console.log("4 intents LIVE, 6 tickets escrowed, ready to settle.");
        console.log("Alice wants Sunday Floor adjacent, pays <=50 USDC");
        console.log("Bob wants Saturday Floor adjacent, receives >=30 USDC");
        console.log("Issuer sells 2 Sunday Tier1, receives >=20 USDC");
        console.log("Carol buys 2 Sunday (Floor|Tier1) adjacent, pays <=80 USDC");
    }

    function _arr(uint256 a, uint256 b) internal pure returns (uint256[] memory r) {
        r = new uint256[](2);
        r[0] = a;
        r[1] = b;
    }

    function _commitIntent(
        IntentRegistry registry,
        IntentRegistry.Intent memory intent,
        uint256 privateKey
    ) internal {
        bytes32 structHash = keccak256(
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
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", registry.DOMAIN_SEPARATOR(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);
        registry.commit(intent, sig);
    }
}
