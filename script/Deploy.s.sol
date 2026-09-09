// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {TicketNFT} from "../src/TicketNFT.sol";
import {Escrow} from "../src/Escrow.sol";
import {IntentRegistry} from "../src/IntentRegistry.sol";
import {Settlement} from "../src/Settlement.sol";

contract Deploy is Script {
    function run() external {
        address usdc = vm.envAddress("USDC_ADDRESS");

        vm.startBroadcast();

        TicketNFT ticketNFT = new TicketNFT();
        Escrow escrow = new Escrow(address(ticketNFT));
        IntentRegistry registry = new IntentRegistry();
        Settlement settlement = new Settlement(
            address(registry),
            address(escrow),
            address(ticketNFT),
            usdc
        );

        escrow.setSettlement(address(settlement));
        registry.setSettlement(address(settlement));
        ticketNFT.registerIssuer(msg.sender);

        vm.stopBroadcast();

        console.log("TicketNFT:      ", address(ticketNFT));
        console.log("Escrow:         ", address(escrow));
        console.log("IntentRegistry: ", address(registry));
        console.log("Settlement:     ", address(settlement));
    }
}
