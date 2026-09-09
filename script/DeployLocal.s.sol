// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {TicketNFT} from "../src/TicketNFT.sol";
import {Escrow} from "../src/Escrow.sol";
import {IntentRegistry} from "../src/IntentRegistry.sol";
import {Settlement} from "../src/Settlement.sol";
import {MockUSDC} from "../test/helpers/MockUSDC.sol";

contract DeployLocal is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        MockUSDC usdc = new MockUSDC();
        TicketNFT ticketNFT = new TicketNFT();
        Escrow escrow = new Escrow(address(ticketNFT));
        IntentRegistry registry = new IntentRegistry();
        Settlement settlement = new Settlement(
            address(registry),
            address(escrow),
            address(ticketNFT),
            address(usdc)
        );

        escrow.setSettlement(address(settlement));
        registry.setSettlement(address(settlement));
        ticketNFT.registerIssuer(deployer);

        usdc.mint(deployer, 10_000e6);

        // Mint demo tickets — Event 1, two sessions, three sections
        // Session 0 (Saturday), Section 0 (Floor), Row 1, Seats 1-4
        ticketNFT.mint(deployer, 1, 0, 0, 1, 1);
        ticketNFT.mint(deployer, 1, 0, 0, 1, 2);
        ticketNFT.mint(deployer, 1, 0, 0, 1, 3);
        ticketNFT.mint(deployer, 1, 0, 0, 1, 4);

        // Session 0 (Saturday), Section 1 (Tier 1), Row 1, Seats 1-2
        ticketNFT.mint(deployer, 1, 0, 1, 1, 1);
        ticketNFT.mint(deployer, 1, 0, 1, 1, 2);

        // Session 1 (Sunday), Section 0 (Floor), Row 1, Seats 1-4
        ticketNFT.mint(deployer, 1, 1, 0, 1, 1);
        ticketNFT.mint(deployer, 1, 1, 0, 1, 2);
        ticketNFT.mint(deployer, 1, 1, 0, 1, 3);
        ticketNFT.mint(deployer, 1, 1, 0, 1, 4);

        // Session 1 (Sunday), Section 2 (Tier 2), Row 2, Seats 1-2
        ticketNFT.mint(deployer, 1, 1, 2, 2, 1);
        ticketNFT.mint(deployer, 1, 1, 2, 2, 2);

        vm.stopBroadcast();

        console.log("=== RESHUFFLE Local Deploy ===");
        console.log("MockUSDC:       ", address(usdc));
        console.log("TicketNFT:      ", address(ticketNFT));
        console.log("Escrow:         ", address(escrow));
        console.log("IntentRegistry: ", address(registry));
        console.log("Settlement:     ", address(settlement));
        console.log("Deployer:       ", deployer);
        console.log("Tickets minted:  12");
        console.log("USDC balance:    10000");
    }
}
