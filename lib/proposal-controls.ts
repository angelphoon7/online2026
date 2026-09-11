import { BaseError, ContractFunctionRevertedError, type Address } from 'viem';
import { getPublicClient } from './contracts';
import { CONTRACTS } from './config';
import { settlementAbi } from './abi';
import type { SettlementProposal } from './solve-api';

export { dishonestProposal } from './dishonest-proposal';
export type { Attack } from './dishonest-proposal';
export type NamedRejection = { name: string; args: string[] };
export function namedRejection(error: unknown): NamedRejection | null {
  const revert = error instanceof BaseError ? error.walk(e => e instanceof ContractFunctionRevertedError) : null;
  if (revert instanceof ContractFunctionRevertedError && revert.data) return { name: revert.data.errorName, args: (revert.data.args ?? []).map(String) };
  return null;
}
export async function simulate(proposal: SettlementProposal, account: Address) {
  return getPublicClient().simulateContract({ account, address: CONTRACTS.settlement, abi: settlementAbi,
    functionName: 'settle', args: [proposal.intents, proposal.legs], gas: 8000000n });
}
