// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TicketNFT} from "./TicketNFT.sol";

contract Escrow {
    TicketNFT public immutable ticketNFT;
    address public settlement;
    address public admin;

    mapping(uint256 => address) public depositor;

    error TicketIsRedeemed(uint256 tokenId);
    error NotDepositor(uint256 tokenId);
    error NotSettlement();

    event TicketEscrowed(uint256 indexed tokenId, address indexed depositorAddr);
    event TicketWithdrawn(uint256 indexed tokenId, address indexed depositorAddr);

    modifier onlySettlement() {
        if (msg.sender != settlement) revert NotSettlement();
        _;
    }

    constructor(address _ticketNFT) {
        ticketNFT = TicketNFT(_ticketNFT);
        admin = msg.sender;
    }

    function setSettlement(address _settlement) external {
        require(msg.sender == admin);
        settlement = _settlement;
    }

    /// @dev Tickets enter by PULL: caller must approve escrow first.
    ///      Rejects redeemed tickets — they can never re-enter escrow.
    function deposit(uint256[] calldata ids) external {
        for (uint256 i = 0; i < ids.length; i++) {
            if (ticketNFT.isRedeemed(ids[i])) revert TicketIsRedeemed(ids[i]);
            depositor[ids[i]] = msg.sender;
            ticketNFT.transferFrom(msg.sender, address(this), ids[i]);
            emit TicketEscrowed(ids[i], msg.sender);
        }
    }

    /// @dev Depositor-only, immediate, no lock period, no settlement approval.
    ///      Clears depositor before transferring (CEI).
    function withdraw(uint256[] calldata ids) external {
        for (uint256 i = 0; i < ids.length; i++) {
            if (depositor[ids[i]] != msg.sender) revert NotDepositor(ids[i]);
            depositor[ids[i]] = address(0);
            ticketNFT.safeTransferFrom(address(this), msg.sender, ids[i]);
            emit TicketWithdrawn(ids[i], msg.sender);
        }
    }

    /// @dev Only settlement may release escrowed tickets to new owners.
    ///      Clears depositor before safeTransferFrom (CEI).
    function releaseBatch(uint256[] calldata ids, address to) external onlySettlement {
        for (uint256 i = 0; i < ids.length; i++) {
            depositor[ids[i]] = address(0);
            ticketNFT.safeTransferFrom(address(this), to, ids[i]);
        }
    }
}
