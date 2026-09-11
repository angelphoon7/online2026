// Read-only integration check: eth_call only, never broadcasts a transaction.
import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { createPublicClient, http } from 'viem';
import { dishonestProposal } from '../lib/dishonest-proposal.ts';
import abis from '../server/abis.json' with { type: 'json' };
import deployment from '../deployments/arc-testnet.json' with { type: 'json' };
import record from '../deployments/act-three.json' with { type: 'json' };

loadEnvFile('.env');
const client = createPublicClient({ transport: http(process.env.ARC_RPC) });
assert.equal(await client.getChainId(), 5042002);
const blockNumber = await client.getBlockNumber();
const source = record.control.proposal;
const proposal = { ...source, intents: source.intents.map(i => ({ ...i, offered: i.offered.map(BigInt), sessionMask: BigInt(i.sessionMask), sectionMask: BigInt(i.sectionMask), maxNetPay: BigInt(i.maxNetPay), deadline: BigInt(i.deadline), nonce: BigInt(i.nonce) })),
  legs: source.legs.map(l => ({ ...l, receives: l.receives.map(BigInt), netPayment: BigInt(l.netPayment) })) };
const tickets = (await Promise.all(source.intents.flatMap(i => i.offered).map(async id => {
  const [eventId, sessionId, sectionId, row, seat, status] = await client.readContract({ address: deployment.contracts.TicketNFT, abi: abis.TicketNFT, functionName: 'meta', args: [BigInt(id)], blockNumber });
  return { tokenId: id, eventId, sessionId, sectionId, row, seat, status };
})));
const simulate = p => client.simulateContract({ address: deployment.contracts.Settlement, abi: abis.Settlement, functionName: 'settle', args: [p.intents, p.legs], account: record.proposer, gas: 8000000n, blockNumber });
await simulate(proposal);
for (const [mode, expected] of [['siphon', 'PaymentImbalance'], ['count', 'CountMismatch'], ['adjacency', 'SeatsNotAdjacent']]) {
  const bad = dishonestProposal(proposal, mode, tickets);
  assert.deepEqual(bad.intents, proposal.intents, 'A mutation must not alter signed intents');
  await assert.rejects(simulate(bad), error => {
    const reverted = error.walk?.(e => e.name === 'ContractFunctionRevertedError');
    assert.equal(reverted?.data?.errorName, expected);
    console.log(`PASS ${mode}: ${expected}(${(reverted.data.args ?? []).join(', ')}) at Arc block ${blockNumber}`);
    return true;
  });
}
console.log('Valid control passed. All three mutations returned distinct named errors. No transaction sent.');
