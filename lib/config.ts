import { defineChain } from 'viem';
import { DEPLOYMENT } from './deployment';

// Addresses and chain identity come from deployments/<network>.json, selected by
// NEXT_PUBLIC_DEPLOYMENT. They are deliberately NOT read from environment variables: a second
// copy of a deployed address drifts silently. See lib/deployment.ts.
export const CONTRACTS = {
  ticketNFT: DEPLOYMENT.ticketNFT,
  escrow: DEPLOYMENT.escrow,
  intentRegistry: DEPLOYMENT.intentRegistry,
  settlement: DEPLOYMENT.settlement,
  usdc: DEPLOYMENT.usdc,
};

export const CHAIN = {
  id: DEPLOYMENT.chainId,
  // The endpoint is environment, not deployment: the same contracts are reachable through
  // any RPC for that chain. The record supplies the default.
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? DEPLOYMENT.rpc,
  name: DEPLOYMENT.chainId === 31337 ? 'Local' : 'Arc Testnet',
};

export const NETWORK = defineChain({
  id: CHAIN.id,
  name: CHAIN.name,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [CHAIN.rpcUrl] } },
});

export const EVENT_ID = 1;

export const SESSIONS: Record<number, string> = {
  0: 'Saturday',
  1: 'Sunday',
};

export const SECTIONS: Record<number, string> = {
  0: 'Floor',
  1: 'Tier 1',
  2: 'Tier 2',
};

export function sessionName(id: number): string {
  return SESSIONS[id] ?? `Session ${id}`;
}

export function sectionName(id: number): string {
  return SECTIONS[id] ?? `Section ${id}`;
}
