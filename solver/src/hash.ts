import {
  keccak256,
  encodeAbiParameters,
  toBytes,
  toHex,
  pad,
  concat,
} from 'viem';
import type { Intent, Hex } from './types.js';

const INTENT_TYPE_STRING =
  'Intent(address owner,uint256[] offered,uint32 eventId,uint256 sessionMask,uint256 sectionMask,uint8 exactCount,bool mustShareSession,bool mustShareSection,bool mustBeAdjacent,int256 maxNetPay,uint64 deadline,uint256 nonce)';

export const INTENT_TYPEHASH: Hex = keccak256(toBytes(INTENT_TYPE_STRING));

export function hashOffered(offered: bigint[]): Hex {
  if (offered.length === 0) return keccak256('0x');
  const parts = offered.map((id) => pad(toHex(id), { size: 32 }));
  return keccak256(concat(parts));
}

export function hashIntent(intent: Intent): Hex {
  const offeredHash = hashOffered(intent.offered);
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'bytes32' },
        { type: 'uint32' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint8' },
        { type: 'bool' },
        { type: 'bool' },
        { type: 'bool' },
        { type: 'int256' },
        { type: 'uint64' },
        { type: 'uint256' },
      ],
      [
        INTENT_TYPEHASH,
        intent.owner,
        offeredHash,
        intent.eventId,
        intent.sessionMask,
        intent.sectionMask,
        intent.exactCount,
        intent.mustShareSession,
        intent.mustShareSection,
        intent.mustBeAdjacent,
        intent.maxNetPay,
        intent.deadline,
        intent.nonce,
      ]
    )
  );
}
