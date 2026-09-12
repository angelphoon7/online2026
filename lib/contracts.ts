"use client";

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  encodeFunctionData,
  decodeFunctionResult,
  parseAbiItem,
  type Hex,
  type Address,
} from 'viem';
import { intentTypedData } from './intent-typed-data';
import { CHAIN, CONTRACTS, NETWORK } from './config';
import { DEPLOYMENT_BLOCK } from './deployment';
import {
  ticketNFTAbi,
  escrowAbi,
  intentRegistryAbi,
  settlementAbi,
  erc20Abi,
} from './abi';

function getProvider() {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('No wallet connected');
  }
  return window.ethereum;
}

export function getPublicClient() {
  return createPublicClient({
    chain: NETWORK,
    transport: http('/api/rpc', { timeout: 20000, retryCount: 2 }),
  });
}

// Direct chain discovery for the deployment demo; this is not subgraph evidence.
export async function getCommittedIntents() {
  const client = getPublicClient();
  const latest = await client.getBlockNumber();
  const start = DEPLOYMENT_BLOCK;
  const event = parseAbiItem('event IntentCommitted(bytes32 indexed intentHash,address indexed owner,uint32 indexed eventId,uint256[] offered,uint256 sessionMask,uint256 sectionMask,uint8 exactCount,bool mustShareSession,bool mustShareSection,bool mustBeAdjacent,int256 maxNetPay,uint64 deadline,uint256 nonce)');
  const intents = [];
  for (let from = start; from <= latest; from += 10000n) {
    const to = from + 9999n < latest ? from + 9999n : latest;
    const logs = await client.getLogs({ address: CONTRACTS.intentRegistry, event, fromBlock: from, toBlock: to, strict: true });
    for (const { args } of logs) {
      if (args.eventId !== 1) continue;
      const state = await getIntentState(args.intentHash);
      intents.push({ ...args, offered: [...args.offered], hash: args.intentHash, state });
    }
  }
  return intents;
}

export async function waitForTransaction(hash: Hex) {
  const receipt = await getPublicClient().waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`Transaction reverted: ${hash}`);
  return receipt;
}

export function getWalletClient() {
  return createWalletClient({
    chain: NETWORK,
    transport: custom(getProvider()),
  });
}

// ── TicketNFT reads ──

export async function getTicketMeta(tokenId: bigint) {
  const client = getPublicClient();
  const data = await client.readContract({
    address: CONTRACTS.ticketNFT,
    abi: ticketNFTAbi,
    functionName: 'meta',
    args: [tokenId],
  });
  return {
    eventId: data[0],
    sessionId: data[1],
    sectionId: data[2],
    row: data[3],
    seat: data[4],
    status: data[5],
  };
}

export async function getTicketOwner(tokenId: bigint): Promise<Address> {
  const client = getPublicClient();
  return client.readContract({
    address: CONTRACTS.ticketNFT,
    abi: ticketNFTAbi,
    functionName: 'ownerOf',
    args: [tokenId],
  }) as Promise<Address>;
}

export async function getNextTokenId(): Promise<bigint> {
  const client = getPublicClient();
  return client.readContract({
    address: CONTRACTS.ticketNFT,
    abi: ticketNFTAbi,
    functionName: 'nextTokenId',
  }) as Promise<bigint>;
}

// ── Escrow ──

export async function getDepositor(tokenId: bigint): Promise<Address> {
  const client = getPublicClient();
  return client.readContract({
    address: CONTRACTS.escrow,
    abi: escrowAbi,
    functionName: 'depositor',
    args: [tokenId],
  }) as Promise<Address>;
}

export async function approveNFTsForEscrow(account: Address) {
  const wallet = getWalletClient();
  return wallet.writeContract({
    account,
    address: CONTRACTS.ticketNFT,
    abi: ticketNFTAbi,
    functionName: 'setApprovalForAll',
    args: [CONTRACTS.escrow, true],
    chain: NETWORK,
  });
}

export async function depositTickets(account: Address, tokenIds: bigint[]) {
  const wallet = getWalletClient();
  return wallet.writeContract({
    account,
    address: CONTRACTS.escrow,
    abi: escrowAbi,
    functionName: 'deposit',
    args: [tokenIds],
    chain: NETWORK,
  });
}

export async function withdrawTickets(account: Address, tokenIds: bigint[]) {
  const wallet = getWalletClient();
  return wallet.writeContract({
    account,
    address: CONTRACTS.escrow,
    abi: escrowAbi,
    functionName: 'withdraw',
    args: [tokenIds],
    chain: NETWORK,
  });
}

// ── IntentRegistry ──

export async function getIntentState(intentHash: Hex): Promise<number> {
  const client = getPublicClient();
  return client.readContract({
    address: CONTRACTS.intentRegistry,
    abi: intentRegistryAbi,
    functionName: 'state',
    args: [intentHash],
  }) as Promise<number>;
}

export async function getDomainSeparator(): Promise<Hex> {
  const client = getPublicClient();
  return client.readContract({
    address: CONTRACTS.intentRegistry,
    abi: intentRegistryAbi,
    functionName: 'DOMAIN_SEPARATOR',
  }) as Promise<Hex>;
}

export interface IntentParams {
  owner: Address;
  offered: bigint[];
  eventId: number;
  sessionMask: bigint;
  sectionMask: bigint;
  exactCount: number;
  mustShareSession: boolean;
  mustShareSection: boolean;
  mustBeAdjacent: boolean;
  maxNetPay: bigint;
  deadline: bigint;
  nonce: bigint;
}

export async function signAndCommitIntent(
  account: Address,
  intent: IntentParams
) {
  const wallet = getWalletClient();

  const sig = await wallet.signTypedData({ account, ...intentTypedData(intent) });

  return wallet.writeContract({
    account,
    address: CONTRACTS.intentRegistry,
    abi: intentRegistryAbi,
    functionName: 'commit',
    args: [intent, sig],
    chain: NETWORK,
  });
}

// hashIntent used to live here as an eth_call to IntentRegistry.hashIntent. It had no callers
// and was a trap: it looks like a local hash but costs a round-trip, and it cannot be used to
// verify subgraph output independently of the chain. Import the pure implementation from
// shared/intent.ts instead — one definition, shared with the solver and the backend.

export async function revokeIntent(account: Address, intentHash: Hex) {
  const wallet = getWalletClient();
  return wallet.writeContract({
    account,
    address: CONTRACTS.intentRegistry,
    abi: intentRegistryAbi,
    functionName: 'revoke',
    args: [intentHash],
    chain: NETWORK,
  });
}

// ── Settlement ──

export async function submitSettlement(
  account: Address,
  intents: IntentParams[],
  legs: { intentHash: Hex; receives: bigint[]; netPayment: bigint }[]
) {
  const wallet = getWalletClient();
  return wallet.writeContract({
    account,
    address: CONTRACTS.settlement,
    abi: settlementAbi,
    functionName: 'settle',
    args: [intents, legs],
    gas: 8000000n,
    chain: NETWORK,
  });
}

export async function approveUSDC(account: Address, amount: bigint) {
  const wallet = getWalletClient();
  return wallet.writeContract({
    account,
    address: CONTRACTS.usdc,
    abi: erc20Abi,
    functionName: 'approve',
    args: [CONTRACTS.settlement, amount],
    chain: NETWORK,
  });
}

export async function getUSDCBalance(account: Address): Promise<bigint> {
  const client = getPublicClient();
  return client.readContract({
    address: CONTRACTS.usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account],
  }) as Promise<bigint>;
}

// ── Redemption ──

export async function redeemTicket(account: Address, tokenId: bigint) {
  const wallet = getWalletClient();
  return wallet.writeContract({
    account,
    address: CONTRACTS.ticketNFT,
    abi: ticketNFTAbi,
    functionName: 'redeem',
    args: [tokenId],
    chain: NETWORK,
  });
}
