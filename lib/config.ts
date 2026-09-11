import { defineChain } from 'viem';

export const CONTRACTS = {
  ticketNFT: (process.env.NEXT_PUBLIC_TICKET_NFT ?? '') as `0x${string}`,
  escrow: (process.env.NEXT_PUBLIC_ESCROW ?? '') as `0x${string}`,
  intentRegistry: (process.env.NEXT_PUBLIC_INTENT_REGISTRY ?? '') as `0x${string}`,
  settlement: (process.env.NEXT_PUBLIC_SETTLEMENT ?? '') as `0x${string}`,
  usdc: (process.env.NEXT_PUBLIC_USDC ?? '') as `0x${string}`,
};

export const CHAIN = {
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337'),
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? 'http://127.0.0.1:8545',
  name: 'Arc Testnet',
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
