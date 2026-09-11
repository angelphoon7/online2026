import 'server-only';
import { createPublicClient, http, isAddress, type Abi, type Address } from 'viem';
import abis from './abis.json';

export { abis };
export function chainConfig() {
  const addresses = {
    TicketNFT: process.env.NEXT_PUBLIC_TICKET_NFT,
    Escrow: process.env.NEXT_PUBLIC_ESCROW,
    IntentRegistry: process.env.NEXT_PUBLIC_INTENT_REGISTRY,
    Settlement: process.env.NEXT_PUBLIC_SETTLEMENT,
  };
  if (process.env.ARC_CHAIN_ID !== '5042002' || !process.env.ARC_RPC || Object.values(addresses).some(a => !a || !isAddress(a))) {
    throw new Error('Backend Arc configuration is incomplete');
  }
  return {
    addresses: addresses as Record<keyof typeof addresses, Address>,
    client: createPublicClient({ transport: http(process.env.ARC_RPC, { timeout: 15000, retryCount: 3, retryDelay: 500 }) }),
    usdc: '0x3600000000000000000000000000000000000000' as Address,
    startBlock: BigInt(process.env.NEXT_PUBLIC_DEPLOYMENT_BLOCK ?? '0'),
  };
}
export function abi(name: keyof typeof abis): Abi { return abis[name] as Abi; }
