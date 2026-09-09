// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract TicketNFT is ERC721 {
    struct TicketMeta {
        uint32 eventId;
        uint16 sessionId;
        uint16 sectionId;
        uint16 row;
        uint16 seat;
        uint8 status; // 0 active, 1 redeemed
    }

    uint8 public constant ACTIVE = 0;
    uint8 public constant REDEEMED = 1;

    mapping(uint256 => TicketMeta) public meta;
    mapping(address => bool) public registeredIssuers;

    address public admin;
    uint256 private _nextTokenId;

    error NotRegisteredIssuer();
    error SessionIdTooLarge(uint16 sessionId);
    error SectionIdTooLarge(uint16 sectionId);
    error NotTicketHolder(uint256 tokenId);
    error AlreadyRedeemed(uint256 tokenId);

    event TicketMinted(
        uint256 indexed tokenId,
        address indexed to,
        uint32 indexed eventId,
        uint16 sessionId,
        uint16 sectionId,
        uint16 row,
        uint16 seat
    );
    event TicketRedeemedEvt(uint256 indexed tokenId, address indexed holder);

    constructor() ERC721("RESHUFFLE Ticket", "RSHFL") {
        admin = msg.sender;
    }

    function registerIssuer(address issuerAddr) external {
        require(msg.sender == admin);
        registeredIssuers[issuerAddr] = true;
    }

    function mint(
        address to,
        uint32 eventId,
        uint16 sessionId,
        uint16 sectionId,
        uint16 row,
        uint16 seat
    ) external returns (uint256 tokenId) {
        if (!registeredIssuers[msg.sender]) revert NotRegisteredIssuer();
        if (sessionId >= 256) revert SessionIdTooLarge(sessionId);
        if (sectionId >= 256) revert SectionIdTooLarge(sectionId);

        tokenId = _nextTokenId++;
        _mint(to, tokenId);
        meta[tokenId] = TicketMeta({
            eventId: eventId,
            sessionId: sessionId,
            sectionId: sectionId,
            row: row,
            seat: seat,
            status: ACTIVE
        });

        emit TicketMinted(tokenId, to, eventId, sessionId, sectionId, row, seat);
    }

    function redeem(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTicketHolder(tokenId);
        if (meta[tokenId].status == REDEEMED) revert AlreadyRedeemed(tokenId);
        meta[tokenId].status = REDEEMED;
        emit TicketRedeemedEvt(tokenId, msg.sender);
    }

    function nextTokenId() external view returns (uint256) {
        return _nextTokenId;
    }

    function isRedeemed(uint256 tokenId) external view returns (bool) {
        return meta[tokenId].status == REDEEMED;
    }
}
