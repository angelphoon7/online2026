import { BaseError, ContractFunctionRevertedError } from 'viem';
export { simulateSettlement as simulate } from './chain-reads';

export { dishonestProposal } from './dishonest-proposal';
export type { Attack } from './dishonest-proposal';
export type NamedRejection = { name: string; args: string[] };
export function namedRejection(error: unknown): NamedRejection | null {
  const revert = error instanceof BaseError ? error.walk(e => e instanceof ContractFunctionRevertedError) : null;
  if (revert instanceof ContractFunctionRevertedError && revert.data) return { name: revert.data.errorName, args: (revert.data.args ?? []).map(String) };
  return null;
}
