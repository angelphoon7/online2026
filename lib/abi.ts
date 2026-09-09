export const ticketNFTAbi = [
  {
    type: 'function',
    name: 'mint',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'eventId', type: 'uint32' },
      { name: 'sessionId', type: 'uint16' },
      { name: 'sectionId', type: 'uint16' },
      { name: 'row', type: 'uint16' },
      { name: 'seat', type: 'uint16' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'meta',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'eventId', type: 'uint32' },
      { name: 'sessionId', type: 'uint16' },
      { name: 'sectionId', type: 'uint16' },
      { name: 'row', type: 'uint16' },
      { name: 'seat', type: 'uint16' },
      { name: 'status', type: 'uint8' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'redeem',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'ownerOf',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isRedeemed',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setApprovalForAll',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'nextTokenId',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

export const escrowAbi = [
  {
    type: 'function',
    name: 'deposit',
    inputs: [{ name: 'ids', type: 'uint256[]' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdraw',
    inputs: [{ name: 'ids', type: 'uint256[]' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'depositor',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
] as const;

export const intentRegistryAbi = [
  {
    type: 'function',
    name: 'commit',
    inputs: [
      {
        name: 'i',
        type: 'tuple',
        components: [
          { name: 'owner', type: 'address' },
          { name: 'offered', type: 'uint256[]' },
          { name: 'eventId', type: 'uint32' },
          { name: 'sessionMask', type: 'uint256' },
          { name: 'sectionMask', type: 'uint256' },
          { name: 'exactCount', type: 'uint8' },
          { name: 'mustShareSession', type: 'bool' },
          { name: 'mustShareSection', type: 'bool' },
          { name: 'mustBeAdjacent', type: 'bool' },
          { name: 'maxNetPay', type: 'int256' },
          { name: 'deadline', type: 'uint64' },
          { name: 'nonce', type: 'uint256' },
        ],
      },
      { name: 'sig', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'revoke',
    inputs: [{ name: 'intentHash', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'state',
    inputs: [{ name: 'intentHash', type: 'bytes32' }],
    outputs: [{ type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'hashIntent',
    inputs: [
      {
        name: 'i',
        type: 'tuple',
        components: [
          { name: 'owner', type: 'address' },
          { name: 'offered', type: 'uint256[]' },
          { name: 'eventId', type: 'uint32' },
          { name: 'sessionMask', type: 'uint256' },
          { name: 'sectionMask', type: 'uint256' },
          { name: 'exactCount', type: 'uint8' },
          { name: 'mustShareSession', type: 'bool' },
          { name: 'mustShareSection', type: 'bool' },
          { name: 'mustBeAdjacent', type: 'bool' },
          { name: 'maxNetPay', type: 'int256' },
          { name: 'deadline', type: 'uint64' },
          { name: 'nonce', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'DOMAIN_SEPARATOR',
    inputs: [],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'INTENT_TYPEHASH',
    inputs: [],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'view',
  },
] as const;

export const settlementAbi = [
  {
    type: 'function',
    name: 'settle',
    inputs: [
      {
        name: 'intents',
        type: 'tuple[]',
        components: [
          { name: 'owner', type: 'address' },
          { name: 'offered', type: 'uint256[]' },
          { name: 'eventId', type: 'uint32' },
          { name: 'sessionMask', type: 'uint256' },
          { name: 'sectionMask', type: 'uint256' },
          { name: 'exactCount', type: 'uint8' },
          { name: 'mustShareSession', type: 'bool' },
          { name: 'mustShareSection', type: 'bool' },
          { name: 'mustBeAdjacent', type: 'bool' },
          { name: 'maxNetPay', type: 'int256' },
          { name: 'deadline', type: 'uint64' },
          { name: 'nonce', type: 'uint256' },
        ],
      },
      {
        name: 'legs',
        type: 'tuple[]',
        components: [
          { name: 'intentHash', type: 'bytes32' },
          { name: 'receives', type: 'uint256[]' },
          { name: 'netPayment', type: 'int256' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'Settled',
    inputs: [
      { name: 'proposer', type: 'address', indexed: true },
      { name: 'intentHashes', type: 'bytes32[]', indexed: false },
      { name: 'participantCount', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const erc20Abi = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;
