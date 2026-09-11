import { CHAIN, CONTRACTS } from './config';
import type { IntentParams } from './contracts';

export const intentTypes = { Intent: [
  { name: 'owner', type: 'address' }, { name: 'offered', type: 'uint256[]' },
  { name: 'eventId', type: 'uint32' }, { name: 'sessionMask', type: 'uint256' },
  { name: 'sectionMask', type: 'uint256' }, { name: 'exactCount', type: 'uint8' },
  { name: 'mustShareSession', type: 'bool' }, { name: 'mustShareSection', type: 'bool' },
  { name: 'mustBeAdjacent', type: 'bool' }, { name: 'maxNetPay', type: 'int256' },
  { name: 'deadline', type: 'uint64' }, { name: 'nonce', type: 'uint256' },
] } as const;
export function intentTypedData(intent: IntentParams) {
  return { domain: { name: 'RESHUFFLE', version: '1', chainId: CHAIN.id, verifyingContract: CONTRACTS.intentRegistry }, types: intentTypes, primaryType: 'Intent' as const, message: intent };
}
export const jsonNumbers = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
