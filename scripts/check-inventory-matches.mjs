// Read indexed requests, run the bounded solver, and simulate without consuming demo inventory.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPublicClient, http, erc20Abi } from 'viem';
import { loadDeployment } from './lib/deployment.mjs';
import { queryGraph, json } from './lib/graph-acceptance.mjs';
import { restoreIntent } from './lib/demo-state.mjs';
import { solve, hashIntent } from '../solver/dist/index.js';
import abis from '../server/abis.json' with { type: 'json' };

async function main() {
  const batches = process.argv.slice(2);
  assert.ok(batches.length && batches.every(b => /^[a-z0-9][a-z0-9-]{0,31}$/.test(b)), 'Supply inventory batch names');
  const manifests = batches.map(b => JSON.parse(fs.readFileSync(`deployments/section-inventory-${b}.json`, 'utf8')));
  const d = loadDeployment('arc-testnet');
  for (const m of manifests) {
    assert.equal(m.chainId, d.chainId);
    assert.deepEqual(m.contracts, d.raw.contracts);
  }
  const floor = Math.max(...manifests.flatMap(m => m.transactions.map(t => Number(t.blockNumber))));
  const response = await queryGraph(d.subgraphUrl, `query Inventory($floor: Int!) {
    _meta(block: { number_gte: $floor }) { deployment block { number timestamp hash } hasIndexingErrors }
    intents(first: 1000, block: { number_gte: $floor }, where: { state: LIVE }) {
      id owner eventId offered sessionMask sectionMask exactCount mustShareSession mustShareSection
      mustBeAdjacent maxNetPay deadline nonce state
    }
    tickets(first: 1000, block: { number_gte: $floor }) {
      id eventId sessionId sectionId row seat owner depositor escrowed redeemed
    }
  }`, { floor });
  assert.ok(!response.errors, 'Index has not reached the receipts or the Graph query failed; retry this read-only check');
  const data = response.data;
  assert.equal(data._meta.hasIndexingErrors, false);
  assert.equal(data._meta.deployment, d.raw.subgraphDeployment);
  assert.ok(data.intents.length < 1000 && data.tickets.length < 1000, 'Paginate before using a truncated pool');
  const client = createPublicClient({ transport: http(d.rpc, { timeout: 20000, retryCount: 3 }) });
  assert.equal(await client.getChainId(), d.chainId);
  const block = await client.getBlock();
  const state = { ticketMeta: new Map(), depositor: new Map(), intentState: new Map(), usdcBalance: new Map(), usdcAllowance: new Map(), blockTimestamp: block.timestamp };
  for (const t of data.tickets) {
    state.ticketMeta.set(BigInt(t.id), { eventId: t.eventId, sessionId: t.sessionId, sectionId: t.sectionId, row: t.row, seat: t.seat, status: t.redeemed ? 1 : 0 });
    if (t.escrowed && t.depositor) state.depositor.set(BigInt(t.id), t.depositor);
  }
  const intents = data.intents.map(i => {
    const intent = restoreIntent(i);
    assert.equal(hashIntent(intent), i.id, 'Indexed intent hash mismatch');
    state.intentState.set(i.id, 1);
    return intent;
  }).filter(i => i.deadline >= block.timestamp && i.offered.every(id => state.depositor.get(id)?.toLowerCase() === i.owner.toLowerCase() && state.ticketMeta.get(id)?.status === 0));
  for (const owner of new Set(intents.map(i => i.owner.toLowerCase()))) {
    for (const [name, target, args] of [['balanceOf', state.usdcBalance, [owner]], ['allowance', state.usdcAllowance, [owner, d.raw.contracts.Settlement]]]) {
      target.set(owner, await client.readContract({ address: d.usdc, abi: erc20Abi, functionName: name, args }));
    }
  }
  const report = { checkedAt: new Date().toISOString(), source: { endpoint: d.subgraphUrl, ...data._meta }, receiptFloor: floor,
    scope: 'Issuer-seeded inventory. Each chosen proposal changes offered ticket IDs and passes eth_call. No settlement broadcast; distinct owners are reported per proposal.', batches, results: [] };
  // Require the counterpart to change class, avoiding a trivial return of everyone's own tickets.
  const requiresClassChange = i => i.offered.length === i.exactCount && i.offered.every(id => {
    const m = state.ticketMeta.get(id);
    return !(i.sessionMask & (1n << BigInt(m.sessionId))) || !(i.sectionMask & (1n << BigInt(m.sectionId)));
  });
  for (const record of manifests.flatMap(m => m.intents)) {
    const anchor = intents.find(i => i.id === record.hash);
    assert.ok(anchor, `New intent is not live and escrow-backed: ${record.hash}`);
    const pool = [anchor, ...intents.filter(i => i.id !== anchor.id && i.exactCount === anchor.exactCount && requiresClassChange(i))].sort((a, b) => a.id.localeCompare(b.id));
    const bounds = { maxParticipants: 2, maxCandidates: 100, timeoutMs: 2000, mustInclude: anchor.id };
    const started = performance.now();
    const result = solve(pool, state, bounds);
    const runtimeMs = performance.now() - started;
    assert.ok(result.chosen, `No solution found within the search bound for ${anchor.id}`);
    for (const leg of result.chosen.legs) {
      const own = result.chosen.intents.find(i => hashIntent(i) === leg.intentHash);
      assert.ok(leg.receives.some(id => !own.offered.includes(id)), 'Proposal returns only original tickets');
    }
    await client.simulateContract({ address: d.raw.contracts.Settlement, abi: abis.Settlement, functionName: 'settle',
      args: [result.chosen.intents, result.chosen.legs], account: d.deployer, gas: 8000000n });
    report.results.push({ intentHash: anchor.id, exactCount: anchor.exactCount, offered: anchor.offered, bounds, runtimeMs,
      distinctOwners: new Set(result.chosen.intents.map(i => i.owner.toLowerCase())).size,
      ...result.evidence, proposal: result.chosen, simulationResult: { success: true }, transactionHash: null });
    console.log(`PASS exactCount=${anchor.exactCount} ${anchor.id}: ${result.evidence.candidatesFound} candidates; simulation passed`);
  }
  const file = `docs/checks/inventory-matches-${batches[0]}.json`;
  fs.mkdirSync('docs/checks', { recursive: true });
  fs.writeFileSync(file, json(report));
  console.log(json({ file, indexedBlock: data._meta.block.number, verifiedRequests: report.results.length, settlementBroadcast: false }));
}
main().catch(error => { console.error(error.name === 'AssertionError' ? error.message : `Inventory verification failed (${error.name}); retry after checking RPC/index health.`); process.exitCode = 1; });
