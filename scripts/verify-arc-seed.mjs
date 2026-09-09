import fs from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createPublicClient, http, erc20Abi } from 'viem';
import { solve, hashIntent } from '../solver/dist/index.js';

loadEnvFile('.env');
const deployment = JSON.parse(fs.readFileSync('deployments/arc-testnet.json', 'utf8'));
const client = createPublicClient({ transport: http(process.env.ARC_RPC, { timeout: 20000 }) });
if (await client.getChainId() !== 5042002) throw new Error('Wrong network.');
const block = await client.getBlock();
const abi = name => JSON.parse(fs.readFileSync(`out/${name}.sol/${name}.json`, 'utf8')).abi;
const read = (name, functionName, args) => client.readContract({ address: deployment.contracts[name], abi: abi(name), functionName, args, blockNumber: block.number });
const intents = deployment.seed.intents.map(record => {
  const intent = { ...record, offered: record.offered.map(BigInt) };
  for (const field of ['sessionMask', 'sectionMask', 'maxNetPay', 'deadline', 'nonce']) intent[field] = BigInt(intent[field]);
  if (hashIntent(intent) !== record.hash) throw new Error('Seed struct hash mismatch.');
  return intent;
});
const state = { ticketMeta: new Map(), depositor: new Map(), intentState: new Map(), usdcBalance: new Map(), usdcAllowance: new Map(), blockTimestamp: block.timestamp };
for (const intent of intents) {
  state.intentState.set(intent.hash, await read('IntentRegistry', 'state', [intent.hash]));
  for (const tokenId of intent.offered) {
    const [eventId, sessionId, sectionId, row, seat, status] = await read('TicketNFT', 'meta', [tokenId]);
    state.ticketMeta.set(tokenId, { eventId, sessionId, sectionId, row, seat, status });
    state.depositor.set(tokenId, await read('Escrow', 'depositor', [tokenId]));
  }
  for (const [field, functionName, args] of [['usdcBalance', 'balanceOf', [intent.owner]], ['usdcAllowance', 'allowance', [intent.owner, deployment.contracts.Settlement]]]) {
    state[field].set(intent.owner.toLowerCase(), await client.readContract({ address: deployment.usdc, abi: erc20Abi, functionName, args, blockNumber: block.number }));
  }
}
const config = { maxParticipants: 3, maxCandidates: 100, timeoutMs: 5000 };
const start = performance.now();
const output = solve(intents, state, config);
const runtimeMs = performance.now() - start;
const evidence = { source: 'Arc RPC state; subgraph not configured', blockNumber: block.number, searchConfig: config, runtimeMs, ...output.evidence, proposal: output.chosen };
if (output.chosen) {
  try {
    // Simulate against latest state too: the earlier snapshot does not lock anything.
    await client.simulateContract({ address: deployment.contracts.Settlement, abi: abi('Settlement'), functionName: 'settle', args: [output.chosen.intents, output.chosen.legs], account: deployment.deployer, gas: 8000000n });
    evidence.simulationResult = { success: true };
  } catch (error) {
    evidence.simulationResult = { success: false, error: error.shortMessage ?? error.message };
  }
}
fs.writeFileSync('deployments/arc-seed-evidence.json', JSON.stringify(evidence, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n');
console.log(`Considered ${intents.length} intents; found ${evidence.candidatesFound} candidates.`);
console.log(`Simulation: ${evidence.simulationResult?.success ? 'passed' : 'not successful'}. No settlement transaction sent.`);
if (!output.chosen || !evidence.simulationResult?.success) process.exitCode = 1;
