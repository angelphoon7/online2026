import 'server-only';
import { decodeFunctionData, decodeEventLog, decodeErrorResult, erc20Abi, erc721Abi, type Hex } from 'viem';
import { abi, chainConfig } from './chain';
import { serialize } from './evidence-store';
import type { IntentParams } from '@/lib/contracts';
import type { ChainReceipt } from '@/lib/market-types';

export async function settlementReceipt(hash: Hex): Promise<ChainReceipt> {
  const { client, addresses, usdc } = chainConfig();
  const [receipt, tx, chain] = await Promise.all([client.getTransactionReceipt({ hash }), client.getTransaction({ hash }), client.getChainId()]);
  if (chain !== 5042002 || tx.to?.toLowerCase() !== addresses.Settlement.toLowerCase()) throw new Error('Not a settlement transaction');
  const decoded = decodeFunctionData({ abi: abi('Settlement'), data: tx.input });
  if (decoded.functionName !== 'settle') throw new Error('Not settle');
  const [intents, legs] = decoded.args as [IntentParams[], { intentHash: Hex; receives: bigint[]; netPayment: bigint }[]];
  let rejection = null;
  const ticketLogs = receipt.logs.filter(l => l.address.toLowerCase() === addresses.TicketNFT.toLowerCase()).flatMap(l => {
    try { const d = decodeEventLog({ abi: erc721Abi, ...l }); return d.eventName === 'Transfer' ? [d.args] : []; } catch { return []; }
  });
  const paymentLogs = receipt.logs.filter(l => l.address.toLowerCase() === usdc.toLowerCase()).flatMap(l => {
    try { const d = decodeEventLog({ abi: erc20Abi, ...l }); return d.eventName === 'Transfer' ? [d.args] : []; } catch { return []; }
  }).filter(l => l.from.toLowerCase() === addresses.Settlement.toLowerCase() || l.to.toLowerCase() === addresses.Settlement.toLowerCase());
  if (receipt.status === 'success') {
    const settled = receipt.logs.some(l => { try { return l.address.toLowerCase() === addresses.Settlement.toLowerCase() && decodeEventLog({ abi: abi('Settlement'), ...l }).eventName === 'Settled'; } catch { return false; } });
    if (!settled || intents.length !== legs.length || legs.reduce((n, l) => n + l.netPayment, 0n) !== 0n) throw new Error('Invalid settlement evidence');
    if (ticketLogs.length !== legs.reduce((n, l) => n + l.receives.length, 0)) throw new Error('Transfer count mismatch');
    for (let i = 0; i < legs.length; i++) for (const id of legs[i].receives) {
      if (!ticketLogs.some(l => l.tokenId === id && l.from.toLowerCase() === addresses.Escrow.toLowerCase() && l.to.toLowerCase() === intents[i].owner.toLowerCase())) throw new Error('Ticket recipient mismatch');
    }
  } else {
    // Receipts contain status, not revert data. This is explicitly historical replay.
    try { await client.call({ account: tx.from, to: tx.to, data: tx.input, gas: tx.gas, blockNumber: receipt.blockNumber - 1n }); }
    catch (error) {
      const walk = (error as { walk?: (fn: (e: { data?: unknown }) => boolean) => { data?: Hex } }).walk;
      const raw = walk?.call(error, e => typeof e.data === 'string' && e.data.startsWith('0x'))?.data;
      if (raw) { try { const d = decodeErrorResult({ abi: abi('Settlement'), data: raw }); rejection = { name: d.errorName, args: (d.args ?? []).map(String) }; } catch { /* Do not invent an error. */ } }
    }
  }
  return JSON.parse(serialize({ hash, blockNumber: receipt.blockNumber, status: receipt.status, proposer: tx.from,
    independent: !intents.some(i => i.owner.toLowerCase() === tx.from.toLowerCase()),
    ticketTransfers: ticketLogs.length, usdcTransfers: paymentLogs.length,
    netSum: legs.reduce((n, l) => n + l.netPayment, 0n),
    participants: intents.map((i, n) => ({ owner: i.owner, offered: i.offered, receives: legs[n]?.receives ?? [], netPayment: legs[n]?.netPayment ?? 0n })), rejection,
  }));
}
