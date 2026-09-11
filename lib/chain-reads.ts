// Frontend read boundary. A future indexer adapter can replace snapshot loading
// while consumers keep the same queries and one coherent source block.
import { erc20Abi, erc721Abi, type Address, type Hex } from 'viem';
import { getPublicClient } from './contracts';
import { CONTRACTS } from './config';
import { escrowAbi, settlementAbi } from './abi';
import type { ChainReceipt, ChainTicket, MarketSnapshot } from './market-types';
import type { SettlementProposal } from './solve-api';

let pending: Promise<MarketSnapshot> | null = null;
async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Public chain reads unavailable');
  return body;
}
export async function getMarketSnapshot(fresh = false): Promise<MarketSnapshot> {
  if (fresh && pending) await pending.catch(() => {});
  if (!pending) pending = readJson<MarketSnapshot>(fresh ? '/api/market?fresh=1' : '/api/market').finally(() => { pending = null; });
  return pending;
}
export const ticketHolder = (t: ChainTicket) => t.depositor !== '0x0000000000000000000000000000000000000000' ? t.depositor : t.owner;
export function getIntentPool(snapshot: MarketSnapshot, eventId = 1) {
  return snapshot.intents.filter(i => i.eventId === eventId && i.state === 1 && !i.expired);
}
export function getTicketsFor(address: Address | null, snapshot: MarketSnapshot, eventId = 1) {
  return snapshot.tickets.filter(t => t.eventId === eventId && (!address || ticketHolder(t).toLowerCase() === address.toLowerCase()));
}
export const getSettlements = (snapshot: MarketSnapshot) => snapshot.settlements;
export function getSeatCustody(session: number, section: number, snapshot: MarketSnapshot, eventId = 1) {
  return snapshot.tickets.filter(t => t.eventId === eventId && t.sessionId === session && t.sectionId === section);
}
export const getSettlementReceipt = (hash: Hex) => readJson<ChainReceipt>(`/api/market/receipt?hash=${hash}`);
export const getTicketsApproved = (address: Address) => getPublicClient().readContract({ address: CONTRACTS.ticketNFT, abi: erc721Abi, functionName: 'isApprovedForAll', args: [address, CONTRACTS.escrow] });
export const getTicketDepositor = (tokenId: bigint) => getPublicClient().readContract({ address: CONTRACTS.escrow, abi: escrowAbi, functionName: 'depositor', args: [tokenId] });
export const getUSDCAllowance = (address: Address) => getPublicClient().readContract({ address: CONTRACTS.usdc, abi: erc20Abi, functionName: 'allowance', args: [address, CONTRACTS.settlement] });
export async function getUnusedNonce(address: Address, minimum: bigint) {
  let nonce = minimum;
  while (await getPublicClient().readContract({ address: CONTRACTS.intentRegistry, abi: [{ type: 'function', name: 'usedNonce', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] }], functionName: 'usedNonce', args: [address, nonce] })) nonce++;
  return nonce;
}
export async function getNativeUSDCBalance(address: Address) {
  const client = getPublicClient();
  if (await client.getChainId() !== 5042002) throw new Error('Wrong balance source');
  return client.getBalance({ address });
}
export const waitForReceipt = (hash: Hex) => getPublicClient().waitForTransactionReceipt({ hash });
export async function waitForSuccess(hash: Hex) {
  const receipt = await waitForReceipt(hash);
  if (receipt.status !== 'success') throw new Error(`Transaction reverted: ${hash}`);
  return receipt;
}
export const simulateSettlement = (proposal: SettlementProposal, account: Address) => getPublicClient().simulateContract({ account, address: CONTRACTS.settlement, abi: settlementAbi, functionName: 'settle', args: [proposal.intents, proposal.legs], gas: 8000000n });
