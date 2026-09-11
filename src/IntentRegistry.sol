// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract IntentRegistry {
    struct Intent {
        address owner;
        uint256[] offered;
        uint32 eventId;
        uint256 sessionMask;
        uint256 sectionMask;
        uint8 exactCount;
        bool mustShareSession;
        bool mustShareSection;
        bool mustBeAdjacent;
        int256 maxNetPay;
        uint64 deadline;
        uint256 nonce;
    }

    uint8 public constant NONE = 0;
    uint8 public constant LIVE = 1;
    uint8 public constant REVOKED = 2;
    uint8 public constant SETTLED = 3;

    bytes32 public constant INTENT_TYPEHASH = keccak256(
        "Intent(address owner,uint256[] offered,uint32 eventId,uint256 sessionMask,uint256 sectionMask,uint8 exactCount,bool mustShareSession,bool mustShareSection,bool mustBeAdjacent,int256 maxNetPay,uint64 deadline,uint256 nonce)"
    );

    bytes32 public immutable DOMAIN_SEPARATOR;
    address public settlement;
    address public admin;

    mapping(bytes32 => uint8) public state;
    mapping(bytes32 => address) public intentOwner;
    mapping(address => mapping(uint256 => bool)) public usedNonce;

    error IntentAlreadyExists(bytes32 intentHash);
    error NonceAlreadyUsed(address owner, uint256 nonce);
    error InvalidSignature();
    error NotIntentOwner(bytes32 intentHash);
    error IntentNotLive(bytes32 intentHash);
    error NotSettlement();
    error AdjacencyRequiresMinTwo(uint8 exactCount);

    event IntentCommitted(
        bytes32 indexed intentHash,
        address indexed owner,
        uint32 indexed eventId,
        uint256[] offered,
        uint256 sessionMask,
        uint256 sectionMask,
        uint8 exactCount,
        bool mustShareSession,
        bool mustShareSection,
        bool mustBeAdjacent,
        int256 maxNetPay,
        uint64 deadline,
        uint256 nonce
    );

    event IntentRevoked(bytes32 indexed intentHash, address indexed owner);

    modifier onlySettlement() {
        if (msg.sender != settlement) revert NotSettlement();
        _;
    }

    constructor() {
        admin = msg.sender;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("RESHUFFLE"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    function setSettlement(address _settlement) external {
        require(msg.sender == admin);
        settlement = _settlement;
    }

    function hashIntent(Intent calldata i) public pure returns (bytes32) {
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

    /// @dev Permissionless — anyone may relay. EIP-712 signature authenticates intent.owner.
    function commit(Intent calldata i, bytes calldata sig) external {
        if (i.mustBeAdjacent && i.exactCount < 2) {
            revert AdjacencyRequiresMinTwo(i.exactCount);
        }

        if (usedNonce[i.owner][i.nonce]) revert NonceAlreadyUsed(i.owner, i.nonce);

        bytes32 structHash = hashIntent(i);
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

        (uint8 v, bytes32 r, bytes32 s) = _splitSignature(sig);
        if (v < 27) v += 27;
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0) || signer != i.owner) revert InvalidSignature();

        if (state[structHash] != NONE) revert IntentAlreadyExists(structHash);

        usedNonce[i.owner][i.nonce] = true;
        state[structHash] = LIVE;
        intentOwner[structHash] = i.owner;

        emit IntentCommitted(
            structHash,
            i.owner,
            i.eventId,
            i.offered,
            i.sessionMask,
            i.sectionMask,
            i.exactCount,
            i.mustShareSession,
            i.mustShareSection,
            i.mustBeAdjacent,
            i.maxNetPay,
            i.deadline,
            i.nonce
        );
    }

    function revoke(bytes32 intentHash) external {
        if (intentOwner[intentHash] != msg.sender) revert NotIntentOwner(intentHash);
        if (state[intentHash] != LIVE) revert IntentNotLive(intentHash);
        state[intentHash] = REVOKED;
        emit IntentRevoked(intentHash, msg.sender);
    }

    function markSettled(bytes32 intentHash) external onlySettlement {
        state[intentHash] = SETTLED;
    }

    function _splitSignature(bytes calldata sig) internal pure returns (uint8 v, bytes32 r, bytes32 s) {
        require(sig.length == 65);
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
    }
}
