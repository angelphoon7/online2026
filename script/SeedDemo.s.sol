// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TicketNFT} from "../src/TicketNFT.sol";
import {Escrow} from "../src/Escrow.sol";
import {IntentRegistry} from "../src/IntentRegistry.sol";
import {Settlement} from "../src/Settlement.sol";

/// @dev npm run demo:prepare builds a resumable plan, runs this script only when
///      needed, and verifies all three intents with the real solver and eth_call.
///      Uses existing Arc contracts and local keys; never settles the demo.
contract SeedDemo is Script {
    address constant USDC = 0x3600000000000000000000000000000000000000;
    uint256 constant GAS = 1_000_000;

    error WrongSeedNetwork();
    error InvalidSeedPlan();
    error SeedWiringMismatch();
    error SeedTicketUnavailable(uint256 tokenId);
    error SeedFundingFailed(address owner);
    error SeedIntentUnavailable(bytes32 hash);

    struct Plan {
        address[] owners;
        uint256[] ids;
        uint256[] nonces;
        bytes32[] previous;
        uint64 deadline;
        bool mintNew;
    }

    function run() external {
        if (block.chainid != 5042002) revert WrongSeedNetwork();
        uint256[3] memory keys = [vm.envUint("PRIVATE_KEY"), vm.envUint("SEED_B_PRIVATE_KEY"), vm.envUint("SEED_C_PRIVATE_KEY")];
        string memory json = vm.readFile(".data/demo-seed-plan.json");
        uint256 deadline = vm.parseJsonUint(json, ".deadline");
        if (deadline > type(uint64).max || deadline <= block.timestamp) revert InvalidSeedPlan();
        Plan memory plan = Plan({
            owners: vm.parseJsonAddressArray(json, ".owners"),
            ids: vm.parseJsonUintArray(json, ".ids"),
            nonces: vm.parseJsonUintArray(json, ".nonces"),
            previous: vm.parseJsonBytes32Array(json, ".previous"),
            deadline: uint64(deadline),
            mintNew: vm.parseJsonBool(json, ".mintNew")
        });
        TicketNFT nft = TicketNFT(vm.envAddress("NEXT_PUBLIC_TICKET_NFT"));
        Escrow escrow = Escrow(vm.envAddress("NEXT_PUBLIC_ESCROW"));
        IntentRegistry registry = IntentRegistry(vm.envAddress("NEXT_PUBLIC_INTENT_REGISTRY"));
        Settlement settlement = Settlement(vm.envAddress("NEXT_PUBLIC_SETTLEMENT"));
        if (vm.parseJsonAddress(json, ".settlement") != address(settlement)) revert SeedWiringMismatch();
        IntentRegistry.Intent[] memory intents = _seed(plan, keys, nft, escrow, registry, settlement);
        vm.writeJson(vm.serializeBytes("demo", "encodedIntents", abi.encode(intents)), ".data/demo-seed-output.json");
        console.log("Three signed intents prepared; settlement was not submitted.");
    }

    function _seed(
        Plan memory plan, uint256[3] memory keys, TicketNFT nft, Escrow escrow,
        IntentRegistry registry, Settlement settlement
    ) internal returns (IntentRegistry.Intent[] memory intents) {
        if (plan.owners.length != 3 || plan.ids.length != 12 || plan.nonces.length != 3 || plan.previous.length > 3 || plan.deadline <= block.timestamp) revert InvalidSeedPlan();
        if (address(settlement.registry()) != address(registry) || address(settlement.ticketNFT()) != address(nft)
            || address(settlement.escrow()) != address(escrow) || address(settlement.usdc()) != USDC
            || address(escrow.ticketNFT()) != address(nft) || escrow.settlement() != address(settlement)
            || registry.settlement() != address(settlement)) revert SeedWiringMismatch();
        for (uint256 i; i < 3; i++) {
            if (vm.addr(keys[i]) != plan.owners[i]) revert InvalidSeedPlan();
            for (uint256 j; j < i; j++) if (plan.owners[i] == plan.owners[j]) revert InvalidSeedPlan();
        }
        for (uint256 i; i < 12; i++) {
            for (uint256 j; j < i; j++) if (plan.ids[i] == plan.ids[j]) revert InvalidSeedPlan();
        }

        // Top up participant gas from the operator's test USDC only if needed.
        for (uint256 i = 1; i < 3; i++) {
            if (plan.owners[i].balance < 1 ether) {
                vm.broadcast(keys[0]);
                (bool ok,) = payable(plan.owners[i]).call{value: 1 ether - plan.owners[i].balance, gas: 100_000}("");
                if (!ok) revert SeedFundingFailed(plan.owners[i]);
            }
        }
        for (uint256 i; i < 12; i++) {
            uint256 id = plan.ids[i];
            if (id >= nft.nextTokenId()) {
                if (!plan.mintNew || id != nft.nextTokenId()) revert SeedTicketUnavailable(id);
                vm.broadcast(keys[0]);
                uint256 minted = nft.mint{gas: GAS}(plan.owners[i / 4], 1, i / 4 == 1 ? 1 : 0, i / 4 == 2 ? 1 : 0, 1, uint16(i % 4 + 1));
                if (minted != id) revert SeedTicketUnavailable(id);
            }
            address owner = nft.ownerOf(id);
            if (nft.isRedeemed(id) || (owner != plan.owners[i / 4] && (owner != address(escrow) || escrow.depositor(id) != plan.owners[i / 4]))) revert SeedTicketUnavailable(id);
            if (plan.mintNew) {
                (uint32 e, uint16 s, uint16 c, uint16 r, uint16 seat,) = nft.meta(id);
                if (e != 1 || s != (i / 4 == 1 ? 1 : 0) || c != (i / 4 == 2 ? 1 : 0) || r != 1 || seat != i % 4 + 1) revert SeedTicketUnavailable(id);
            }
        }

        // A reused pool must still form three adjacent bundles in the same event.
        for (uint256 i; i < 3; i++) {
            (uint32 eventId, uint16 session, uint16 section, uint16 row,,) = nft.meta(plan.ids[i * 4]);
            uint16 minSeat = type(uint16).max;
            uint16 maxSeat;
            for (uint256 j; j < 4; j++) {
                (uint32 e, uint16 s, uint16 c, uint16 r, uint16 seat,) = nft.meta(plan.ids[i * 4 + j]);
                if (e != 1 || e != eventId || s != session || c != section || r != row) revert InvalidSeedPlan();
                for (uint256 k; k < j; k++) {
                    (,,,, uint16 otherSeat,) = nft.meta(plan.ids[i * 4 + k]);
                    if (seat == otherSeat) revert InvalidSeedPlan();
                }
                if (seat < minSeat) minSeat = seat;
                if (seat > maxSeat) maxSeat = seat;
            }
            if (uint256(maxSeat) - minSeat != 3) revert InvalidSeedPlan();
        }
        if (IERC20(USDC).balanceOf(plan.owners[0]) < 100_000) revert SeedFundingFailed(plan.owners[0]);

        intents = new IntentRegistry.Intent[](3);
        for (uint256 i; i < 3; i++) {
            uint256[] memory offered = new uint256[](4);
            for (uint256 j; j < 4; j++) offered[j] = plan.ids[i * 4 + j];
            (uint32 eventId, uint16 session, uint16 section,,,) = nft.meta(plan.ids[((i + 1) % 3) * 4]);
            intents[i] = IntentRegistry.Intent({
                owner: plan.owners[i], offered: offered, eventId: eventId,
                sessionMask: uint256(1) << session, sectionMask: uint256(1) << section,
                exactCount: 4, mustShareSession: true, mustShareSection: true, mustBeAdjacent: true,
                maxNetPay: i == 0 ? int256(100_000) : i == 1 ? int256(0) : -int256(100_000),
                deadline: plan.deadline, nonce: plan.nonces[i]
            });
            bytes32 hash = registry.hashIntent(intents[i]);
            uint8 state = registry.state(hash);
            if (state != registry.NONE() && state != registry.LIVE()) revert SeedIntentUnavailable(hash);
            if (state == registry.NONE() && registry.usedNonce(plan.owners[i], plan.nonces[i])) revert SeedIntentUnavailable(hash);
        }
        for (uint256 i; i < plan.previous.length; i++) {
            bytes32 oldHash = plan.previous[i];
            if (registry.state(oldHash) != registry.LIVE()) continue;
            for (uint256 j; j < 3; j++) {
                if (oldHash == registry.hashIntent(intents[j])) revert InvalidSeedPlan();
                if (registry.intentOwner(oldHash) == plan.owners[j]) {
                    vm.broadcast(keys[j]);
                    registry.revoke{gas: GAS}(oldHash);
                }
            }
        }
        for (uint256 i; i < 3; i++) {
            if (!nft.isApprovedForAll(plan.owners[i], address(escrow))) {
                vm.broadcast(keys[i]);
                nft.setApprovalForAll{gas: GAS}(address(escrow), true);
            }
            for (uint256 j; j < 4; j++) {
                uint256 id = plan.ids[i * 4 + j];
                if (escrow.depositor(id) == plan.owners[i]) continue;
                uint256[] memory single = new uint256[](1);
                single[0] = id;
                vm.broadcast(keys[i]);
                escrow.deposit{gas: GAS}(single);
            }
            if (i == 0 && IERC20(USDC).allowance(plan.owners[i], address(settlement)) < 100_000) {
                vm.broadcast(keys[i]);
                if (!IERC20(USDC).approve{gas: GAS}(address(settlement), 100_000)) revert SeedFundingFailed(plan.owners[i]);
            }
            bytes32 hash = registry.hashIntent(intents[i]);
            if (registry.state(hash) == registry.NONE()) {
                bytes32 digest = keccak256(abi.encodePacked("\x19\x01", registry.DOMAIN_SEPARATOR(), hash));
                (uint8 v, bytes32 r, bytes32 s) = vm.sign(keys[i], digest);
                vm.broadcast(keys[0]);
                registry.commit{gas: GAS}(intents[i], abi.encodePacked(r, s, v));
            }
        }
    }
}
