import { erc20Abi } from 'viem';
import { solve, hashIntent } from '../../solver/dist/index.js';
import abis from '../../server/abis.json' with { type: 'json' };

export const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';
export const restoreIntent = record => ({ ...record, offered: record.offered.map(BigInt), ...Object.fromEntries(
  ['sessionMask', 'sectionMask', 'maxNetPay', 'deadline', 'nonce'].map(key => [key, BigInt(record[key])]),
) });

export async function checkDemo(client, deployment, records) {
  if (records.length !== 3) throw new Error('Demo must contain exactly three intents.');
  if (records.some(i => i.offered.length !== 4) || new Set(records.flatMap(i => i.offered).map(String)).size !== 12
    || new Set(records.map(i => i.owner.toLowerCase())).size !== 3) throw new Error('Demo requires twelve distinct tickets across three distinct participants.');
  const intents = records.map(restoreIntent);
  if (new Set(records.map(i => i.hash)).size !== 3 || intents.some(i => hashIntent(i) !== i.hash)) throw new Error('Demo intent hash mismatch.');
  const block = await client.getBlock();
  const read = (name, functionName, args) => client.readContract({ address: deployment.contracts[name], abi: abis[name], functionName, args, blockNumber: block.number });
  const state = { ticketMeta: new Map(), depositor: new Map(), intentState: new Map(), usdcBalance: new Map(), usdcAllowance: new Map(), blockTimestamp: block.timestamp };
  // Keep RPC bursts bounded when checking the three participants.
  for (const intent of intents) {
    state.intentState.set(intent.hash, await read('IntentRegistry', 'state', [intent.hash]));
    await Promise.all(intent.offered.map(async id => {
      const [meta, depositor] = await Promise.all([read('TicketNFT', 'meta', [id]), read('Escrow', 'depositor', [id])]);
      const [eventId, sessionId, sectionId, row, seat, status] = meta;
      state.ticketMeta.set(id, { eventId, sessionId, sectionId, row, seat, status });
      state.depositor.set(id, depositor);
    }));
    const [balance, allowance] = await Promise.all([
      client.readContract({ address: deployment.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [intent.owner], blockNumber: block.number }),
      client.readContract({ address: deployment.usdc, abi: erc20Abi, functionName: 'allowance', args: [intent.owner, deployment.contracts.Settlement], blockNumber: block.number }),
    ]);
    state.usdcBalance.set(intent.owner.toLowerCase(), balance);
    state.usdcAllowance.set(intent.owner.toLowerCase(), allowance);
  }
  const searchConfig = { maxParticipants: 3, maxCandidates: 100, timeoutMs: 5000 };
  const start = performance.now();
  const result = solve(intents, state, searchConfig);
  const evidence = { source: 'Arc RPC state; subgraph not configured', blockNumber: block.number, blockHash: block.hash,
    checkedAt: new Date().toISOString(), searchConfig, runtimeMs: performance.now() - start,
    ...result.evidence, proposal: result.chosen, liveIntents: [...state.intentState.values()].filter(s => s === 1).length };
  if (result.chosen) {
    try {
      await client.simulateContract({ address: deployment.contracts.Settlement, abi: abis.Settlement, functionName: 'settle',
        args: [result.chosen.intents, result.chosen.legs], account: deployment.deployer, gas: 8000000n });
      evidence.simulationResult = { success: true };
    } catch (error) {
      const revert = error.walk?.(e => e.name === 'ContractFunctionRevertedError');
      // Transport failures are not evidence of invalid state: stop instead of reseeding.
      if (!revert) throw new Error('Arc simulation RPC failed. Retry after connectivity is restored.');
      evidence.simulationResult = { success: false, error: revert.data?.errorName ?? 'Settlement reverted' };
    }
  }
  const ready = evidence.liveIntents === 3 && result.chosen?.intents.length === 3 && !!evidence.simulationResult?.success;
  return { ready, evidence, intents, block };
}
