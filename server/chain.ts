import 'server-only';
import { createPublicClient, http, isAddress, type Abi, type Address } from 'viem';
import abis from './abis.json';
import { DEPLOYMENT } from '@/lib/deployment';

export { abis };
export function chainConfig(options: { signal?: AbortSignal } = {}) {
  // Addresses, chain id and USDC come from deployments/<network>.json, never from env — one
  // deployed fact, one place. See lib/deployment.ts.
  const addresses = {
    TicketNFT: DEPLOYMENT.ticketNFT,
    Escrow: DEPLOYMENT.escrow,
    IntentRegistry: DEPLOYMENT.intentRegistry,
    Settlement: DEPLOYMENT.settlement,
  };
  const rpc = process.env.ARC_RPC ?? DEPLOYMENT.rpc;
  if (!rpc || Object.values(addresses).some(a => !a || !isAddress(a)) || !isAddress(DEPLOYMENT.usdc)) {
    throw new Error('Backend Arc configuration is incomplete');
  }
  if (process.env.ARC_CHAIN_ID && Number(process.env.ARC_CHAIN_ID) !== DEPLOYMENT.chainId) {
    throw new Error(
      `ARC_CHAIN_ID=${process.env.ARC_CHAIN_ID} contradicts deployment ${DEPLOYMENT.network} (chainId ${DEPLOYMENT.chainId})`
    );
  }
  return {
    addresses: addresses as Record<keyof typeof addresses, Address>,
    client: createPublicClient({ transport: http(rpc, options.signal
      ? { timeout: 0, retryCount: 0, fetchOptions: { signal: options.signal } }
      : { timeout: 15000, retryCount: 3, retryDelay: 500 }) }),
    usdc: DEPLOYMENT.usdc as Address,
    startBlock: DEPLOYMENT.startBlock,
    chainId: DEPLOYMENT.chainId,
  };
}
export function abi(name: keyof typeof abis): Abi { return abis[name] as Abi; }
