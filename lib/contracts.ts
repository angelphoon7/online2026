"use client";

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  encodeFunctionData,
  decodeFunctionResult,
  type Hex,
  type Address,
} from 'viem';
import { CHAIN, CONTRACTS } from './config';
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
    transport: http(CHAIN.rpcUrl),
  });
}

export function getWalletClient() {
  return createWalletClient({
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
    chain: null,
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
    chain: null,
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
    chain: null,
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
  const domainSeparator = await getDomainSeparator();

  const types = {
    Intent: [
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
  } as const;

  const sig = await wallet.signTypedData({
    account,
    domain: {
      name: 'RESHUFFLE',
      version: '1',
      chainId: BigInt(CHAIN.id),
      verifyingContract: CONTRACTS.intentRegistry,
    },
    types,
    primaryType: 'Intent',
    message: {
      owner: intent.owner,
      offered: intent.offered,
      eventId: intent.eventId,
      sessionMask: intent.sessionMask,
      sectionMask: intent.sectionMask,
      exactCount: intent.exactCount,
      mustShareSession: intent.mustShareSession,
      mustShareSection: intent.mustShareSection,
      mustBeAdjacent: intent.mustBeAdjacent,
      maxNetPay: intent.maxNetPay,
      deadline: intent.deadline,
      nonce: intent.nonce,
    },
  });

  return wallet.writeContract({
    account,
    address: CONTRACTS.intentRegistry,
    abi: intentRegistryAbi,
    functionName: 'commit',
    args: [intent, sig],
    chain: null,
  });
}

export async function revokeIntent(account: Address, intentHash: Hex) {
  const wallet = getWalletClient();
  return wallet.writeContract({
    account,
    address: CONTRACTS.intentRegistry,
    abi: intentRegistryAbi,
    functionName: 'revoke',
    args: [intentHash],
    chain: null,
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
    chain: null,
  });
}

export async function simulateSettlement(
  intents: IntentParams[],
  legs: { intentHash: Hex; receives: bigint[]; netPayment: bigint }[]
): Promise<{ success: boolean; error?: string }> {
  const client = getPublicClient();
  try {
    await client.simulateContract({
      address: CONTRACTS.settlement,
      abi: settlementAbi,
      functionName: 'settle',
      args: [intents, legs],
    });
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ── USDC ──

export async function approveUSDC(account: Address, amount: bigint) {
  const wallet = getWalletClient();
  return wallet.writeContract({
    account,
    address: CONTRACTS.usdc,
    abi: erc20Abi,
    functionName: 'approve',
    args: [CONTRACTS.settlement, amount],
    chain: null,
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
    chain: null,
  });
}
