// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IntentRegistry} from "./IntentRegistry.sol";
import {Escrow} from "./Escrow.sol";
import {TicketNFT} from "./TicketNFT.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract Settlement is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Leg {
        bytes32 intentHash;
        uint256[] receives;
        int256 netPayment;
    }

    IntentRegistry public immutable registry;
    Escrow public immutable escrow;
    TicketNFT public immutable ticketNFT;
    IERC20 public immutable usdc;

    uint8 private constant LIVE = 1;

    bytes32 private constant INTENT_TYPEHASH = keccak256(
        "Intent(address owner,uint256[] offered,uint32 eventId,uint256 sessionMask,uint256 sectionMask,uint8 exactCount,bool mustShareSession,bool mustShareSection,bool mustBeAdjacent,int256 maxNetPay,uint64 deadline,uint256 nonce)"
    );

    error MalformedSettlement();
    error DuplicateIntentHash(bytes32 intentHash);
    error IntentHashMismatch(bytes32 expected, bytes32 actual);
    error IntentNotLive(bytes32 intentHash);
    error IntentExpired(bytes32 intentHash, uint64 deadline);
    error TicketNotEscrowed(uint256 tokenId, address expectedOwner);
    error WrongEvent(uint256 tokenId, uint32 expected, uint32 actual);
    error TicketRedeemed(uint256 tokenId);
    error ConservationViolated();
    error SessionNotAccepted(bytes32 intentHash, uint16 sessionId);
    error SectionNotAccepted(bytes32 intentHash, uint16 sectionId);
    error CountMismatch(bytes32 intentHash, uint8 expected, uint256 actual);
    error NotSameSession(bytes32 intentHash);
    error NotSameSection(bytes32 intentHash);
    error SeatsNotAdjacent(bytes32 intentHash);
    error BudgetExceeded(bytes32 intentHash, int256 limit, int256 actual);
    error PaymentImbalance(int256 total);
    error InsufficientPaymentCapacity(address payer, uint256 required);

    event Settled(
        address indexed proposer,
        bytes32[] intentHashes,
        uint256 participantCount
    );

    constructor(address _registry, address _escrow, address _ticketNFT, address _usdc) {
        registry = IntentRegistry(_registry);
        escrow = Escrow(_escrow);
        ticketNFT = TicketNFT(_ticketNFT);
        usdc = IERC20(_usdc);
    }

    function settle(
        IntentRegistry.Intent[] calldata intents,
        Leg[] calldata legs
    ) external nonReentrant {
        uint256 n = intents.length;

        // ═══ V0: Settlement shape ═══
        if (n == 0 || n != legs.length) revert MalformedSettlement();

        bytes32[] memory intentHashes = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            intentHashes[i] = _hashIntent(intents[i]);
            if (intentHashes[i] != legs[i].intentHash) {
                revert IntentHashMismatch(intentHashes[i], legs[i].intentHash);
            }
            for (uint256 j = 0; j < i; j++) {
                if (intentHashes[j] == intentHashes[i]) {
                    revert DuplicateIntentHash(intentHashes[i]);
                }
            }
        }

        // ═══ V1: Intent validity ═══
        for (uint256 i = 0; i < n; i++) {
            if (registry.state(intentHashes[i]) != LIVE) {
                revert IntentNotLive(intentHashes[i]);
            }
            if (block.timestamp > intents[i].deadline) {
                revert IntentExpired(intentHashes[i], intents[i].deadline);
            }
        }

        // ═══ V2: Escrow ownership and event binding ═══
        for (uint256 i = 0; i < n; i++) {
            for (uint256 j = 0; j < intents[i].offered.length; j++) {
                uint256 tokenId = intents[i].offered[j];
                if (escrow.depositor(tokenId) != intents[i].owner) {
                    revert TicketNotEscrowed(tokenId, intents[i].owner);
                }
                (uint32 evId,,,,, ) = ticketNFT.meta(tokenId);
                if (evId != intents[i].eventId) {
                    revert WrongEvent(tokenId, intents[i].eventId, evId);
                }
            }
        }

        // ═══ V3: Ticket status — no offered ticket redeemed ═══
        for (uint256 i = 0; i < n; i++) {
            for (uint256 j = 0; j < intents[i].offered.length; j++) {
                if (ticketNFT.isRedeemed(intents[i].offered[j])) {
                    revert TicketRedeemed(intents[i].offered[j]);
                }
            }
        }

        // ═══ V4: Conservation — exact bijection ═══
        _checkConservation(intents, legs);

        // ═══ V5: Per-participant predicate ═══
        for (uint256 i = 0; i < n; i++) {
            _checkPredicate(intentHashes[i], intents[i], legs[i]);
        }

        // ═══ V6: Per-participant budget ═══
        for (uint256 i = 0; i < n; i++) {
            if (legs[i].netPayment > intents[i].maxNetPay) {
                revert BudgetExceeded(intentHashes[i], intents[i].maxNetPay, legs[i].netPayment);
            }
        }

        // ═══ V7: Payment balance — sum exactly zero ═══
        int256 total = 0;
        for (uint256 i = 0; i < n; i++) {
            total += legs[i].netPayment;
        }
        if (total != 0) revert PaymentImbalance(total);

        // ═══ V8: Payment capacity ═══
        (address[] memory uniqueOwners, int256[] memory ownerNets, uint256 uniqueCount) =
            _computeOwnerNets(intents, legs, n);

        for (uint256 i = 0; i < uniqueCount; i++) {
            if (ownerNets[i] > 0) {
                uint256 required = uint256(ownerNets[i]);
                uint256 bal = usdc.balanceOf(uniqueOwners[i]);
                uint256 allow = usdc.allowance(uniqueOwners[i], address(this));
                if (bal < required || allow < required) {
                    revert InsufficientPaymentCapacity(uniqueOwners[i], required);
                }
            }
        }

        // ═══ EXECUTE ═══

        // 1. Mark every intent LIVE → SETTLED (effects first)
        for (uint256 i = 0; i < n; i++) {
            registry.markSettled(intentHashes[i]);
        }

        // 2. USDC transfers — pull debits, then push credits
        for (uint256 i = 0; i < uniqueCount; i++) {
            if (ownerNets[i] > 0) {
                usdc.safeTransferFrom(uniqueOwners[i], address(this), uint256(ownerNets[i]));
            }
        }
        for (uint256 i = 0; i < uniqueCount; i++) {
            if (ownerNets[i] < 0) {
                usdc.safeTransfer(uniqueOwners[i], uint256(-ownerNets[i]));
            }
        }

        // 3. Release tickets from escrow
        for (uint256 i = 0; i < n; i++) {
            if (legs[i].receives.length > 0) {
                escrow.releaseBatch(legs[i].receives, intents[i].owner);
            }
        }

        // 4. Emit
        emit Settled(msg.sender, intentHashes, n);
    }

    // ───────────────────────────────────────────────────────────

    function _hashIntent(IntentRegistry.Intent calldata i) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                INTENT_TYPEHASH,
                i.owner,
                keccak256(abi.encodePacked(i.offered)),
                i.eventId,
                i.sessionMask,
                i.sectionMask,
                i.exactCount,
                i.mustShareSession,
                i.mustShareSection,
                i.mustBeAdjacent,
                i.maxNetPay,
                i.deadline,
                i.nonce
            )
        );
    }

    function _checkConservation(
        IntentRegistry.Intent[] calldata intents,
        Leg[] calldata legs
    ) internal pure {
        uint256 totalOffered = 0;
        uint256 totalReceived = 0;
        for (uint256 i = 0; i < intents.length; i++) {
            totalOffered += intents[i].offered.length;
            totalReceived += legs[i].receives.length;
        }
        if (totalOffered != totalReceived) revert ConservationViolated();

        uint256[] memory offered = new uint256[](totalOffered);
        uint256[] memory received = new uint256[](totalReceived);
        uint256 oi = 0;
        uint256 ri = 0;
        for (uint256 i = 0; i < intents.length; i++) {
            for (uint256 j = 0; j < intents[i].offered.length; j++) {
                offered[oi++] = intents[i].offered[j];
            }
            for (uint256 j = 0; j < legs[i].receives.length; j++) {
                received[ri++] = legs[i].receives[j];
            }
        }

        _sort(offered);
        _sort(received);

        for (uint256 i = 1; i < offered.length; i++) {
            if (offered[i] == offered[i - 1]) revert ConservationViolated();
        }
        for (uint256 i = 1; i < received.length; i++) {
            if (received[i] == received[i - 1]) revert ConservationViolated();
        }
        for (uint256 i = 0; i < offered.length; i++) {
            if (offered[i] != received[i]) revert ConservationViolated();
        }
    }

    function _checkPredicate(
        bytes32 intentHash,
        IntentRegistry.Intent calldata intent,
        Leg calldata leg
    ) internal view {
        if (leg.receives.length != intent.exactCount) {
            revert CountMismatch(intentHash, intent.exactCount, leg.receives.length);
        }

        if (intent.exactCount == 0) return;

        uint16 firstSessionId;
        uint16 firstSectionId;

        for (uint256 j = 0; j < leg.receives.length; j++) {
            (uint32 evId, uint16 sessionId, uint16 sectionId,,,) =
                ticketNFT.meta(leg.receives[j]);

            if (evId != intent.eventId) {
                revert WrongEvent(leg.receives[j], intent.eventId, evId);
            }

            if ((intent.sessionMask & (uint256(1) << sessionId)) == 0) {
                revert SessionNotAccepted(intentHash, sessionId);
            }
            if ((intent.sectionMask & (uint256(1) << sectionId)) == 0) {
                revert SectionNotAccepted(intentHash, sectionId);
            }

            if (j == 0) {
                firstSessionId = sessionId;
                firstSectionId = sectionId;
            }

            if (intent.mustShareSession && sessionId != firstSessionId) {
                revert NotSameSession(intentHash);
            }
            if (intent.mustShareSection && sectionId != firstSectionId) {
                revert NotSameSection(intentHash);
            }
        }

        if (intent.mustBeAdjacent) {
            _checkAdjacency(intentHash, leg);
        }
    }

    function _checkAdjacency(
        bytes32 intentHash,
        Leg calldata leg
    ) internal view {
        uint16[] memory seats = new uint16[](leg.receives.length);
        uint16 refSession;
        uint16 refSection;
        uint16 refRow;

        for (uint256 j = 0; j < leg.receives.length; j++) {
            (, uint16 sessionId, uint16 sectionId, uint16 row, uint16 seat,) =
                ticketNFT.meta(leg.receives[j]);

            if (j == 0) {
                refSession = sessionId;
                refSection = sectionId;
                refRow = row;
            } else {
                if (sessionId != refSession || sectionId != refSection || row != refRow) {
                    revert SeatsNotAdjacent(intentHash);
                }
            }
            seats[j] = seat;
        }

        _sortUint16(seats);

        for (uint256 j = 1; j < seats.length; j++) {
            if (seats[j] != seats[j - 1] + 1) {
                revert SeatsNotAdjacent(intentHash);
            }
        }
    }

    function _computeOwnerNets(
        IntentRegistry.Intent[] calldata intents,
        Leg[] calldata legs,
        uint256 n
    ) internal pure returns (address[] memory, int256[] memory, uint256) {
        address[] memory owners = new address[](n);
        int256[] memory nets = new int256[](n);
        uint256 uniqueCount = 0;

        for (uint256 i = 0; i < n; i++) {
            address owner = intents[i].owner;
            int256 payment = legs[i].netPayment;

            bool found = false;
            for (uint256 j = 0; j < uniqueCount; j++) {
                if (owners[j] == owner) {
                    nets[j] += payment;
                    found = true;
                    break;
                }
            }
            if (!found) {
                owners[uniqueCount] = owner;
                nets[uniqueCount] = payment;
                uniqueCount++;
            }
        }

        return (owners, nets, uniqueCount);
    }

    function _sort(uint256[] memory arr) internal pure {
        if (arr.length <= 1) return;
        for (uint256 i = 1; i < arr.length; i++) {
            uint256 key = arr[i];
            uint256 j = i;
            while (j > 0 && arr[j - 1] > key) {
                arr[j] = arr[j - 1];
                j--;
            }
            arr[j] = key;
        }
    }

    function _sortUint16(uint16[] memory arr) internal pure {
        if (arr.length <= 1) return;
        for (uint256 i = 1; i < arr.length; i++) {
            uint16 key = arr[i];
            uint256 j = i;
            while (j > 0 && arr[j - 1] > key) {
                arr[j] = arr[j - 1];
                j--;
            }
            arr[j] = key;
        }
    }
}
