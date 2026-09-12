// Proof is scoped to each explicitly selected group, not the unrestricted marketplace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPublicClient, http, erc20Abi } from 'viem';
import abis from '../server/abis.json' with { type: 'json' };
import { loadDeployment } from './lib/deployment.mjs';
import { json, restoreIntent } from './lib/demo-state.mjs';
import { queryGraph } from './lib/graph-acceptance.mjs';
import { solve, hashIntent } from '../solver/dist/index.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  const batch = process.argv[2] ?? 'sep12';
  assert.ok(process.argv.length <= 3 && /^[a-z0-9][a-z0-9-]{0,31}$/.test(batch));
  const manifest = JSON.parse(fs.readFileSync(`deployments/circle-inventory-${batch}.json`, 'utf8'));
  const d = loadDeployment('arc-testnet');
  assert.equal(manifest.chainId, d.chainId); assert.deepEqual(manifest.contracts, d.raw.contracts);
  const floor = Math.max(...manifest.transactions.map(t => Number(t.blockNumber)));
  const response = await queryGraph(d.subgraphUrl, `query Circle($floor: Int!) {
    _meta(block: { number_gte: $floor }) { deployment block { number timestamp hash } hasIndexingErrors }
    intents(first: 1000, block: { number_gte: $floor }, where: { state: LIVE }) {
      id owner eventId offered sessionMask sectionMask exactCount mustShareSession mustShareSection
      mustBeAdjacent maxNetPay deadline nonce state
    }
    tickets(first: 1000, block: { number_gte: $floor }) { id eventId sessionId sectionId row seat owner depositor escrowed redeemed }
  }`, { floor });
  assert.ok(!response.errors, 'Graph query failed or receipts not indexed; retry the read-only check');
  const data = response.data;
  assert.equal(data._meta.hasIndexingErrors, false); assert.equal(data._meta.deployment, d.raw.subgraphDeployment);
  assert.ok(data.intents.length < 1000 && data.tickets.length < 1000, 'Discovery lists may be truncated');
  const client = createPublicClient({ transport: http(d.rpc, { timeout: 20000, retryCount: 3, retryDelay: 1000 }) });
  assert.equal(await client.getChainId(), d.chainId);
  const blockNumber = BigInt(data._meta.block.number);
  const block = await client.getBlock({ blockNumber });
  assert.equal(block.hash.toLowerCase(), data._meta.block.hash.toLowerCase());
  const read = async (contract, functionName, args) => {
    for (let attempt = 0; ; attempt++) {
      try { return await client.readContract({ address: d.raw.contracts[contract], abi: abis[contract], functionName, args, blockNumber }); }
      catch (e) { if (attempt >= 3 || e.walk?.(c => c.name === 'ContractFunctionRevertedError')) throw e; await sleep(1000 * (attempt + 1)); }
    }
  };
  const report = { checkedAt: new Date().toISOString(), source: { endpoint: d.subgraphUrl, ...data._meta }, receiptFloor: floor,
    scope: 'Each selected group of three signed requests only. Other market inventory may allow direct swaps. Independent groups have disjoint tickets. No settlement broadcast.', groups: [] };
  for (const group of manifest.groups) {
    const intents = group.intents.map(record => {
      const indexed = data.intents.find(i => i.id === record.hash);
      assert.ok(indexed, `${group.name}: request is not indexed LIVE`);
      const intent = restoreIntent(indexed);
      assert.equal(hashIntent(intent), record.hash);
      return intent;
    });
    assert.equal(intents.length, 3); assert.equal(new Set(intents.map(i => i.owner.toLowerCase())).size, 3);
    assert.equal(new Set(intents.flatMap(i => i.offered).map(String)).size, group.count * 3);
    assert.ok(intents.every(i => i.exactCount === group.count && i.offered.length === group.count && i.maxNetPay === 0n));
    const state = { ticketMeta: new Map(), depositor: new Map(), intentState: new Map(), usdcBalance: new Map(), usdcAllowance: new Map(), blockTimestamp: block.timestamp };
    for (const intent of intents) {
      const status = await read('IntentRegistry', 'state', [intent.id]);
      assert.equal(status, 1); assert.ok(intent.deadline >= block.timestamp);
      state.intentState.set(intent.id, status);
      for (const id of intent.offered) {
        const meta = await read('TicketNFT', 'meta', [id]);
        const depositor = await read('Escrow', 'depositor', [id]);
        const owner = await read('TicketNFT', 'ownerOf', [id]);
        const indexed = data.tickets.find(t => t.id === String(id));
        assert.ok(indexed?.escrowed && !indexed.redeemed);
        assert.equal(depositor.toLowerCase(), intent.owner.toLowerCase());
        assert.equal(indexed.depositor.toLowerCase(), depositor.toLowerCase());
        assert.equal(owner.toLowerCase(), d.raw.contracts.Escrow.toLowerCase());
        assert.deepEqual(meta, [indexed.eventId, indexed.sessionId, indexed.sectionId, indexed.row, indexed.seat, 0]);
        const [eventId, sessionId, sectionId, row, seat, ticketStatus] = meta;
        state.ticketMeta.set(id, { eventId, sessionId, sectionId, row, seat, status: ticketStatus }); state.depositor.set(id, depositor);
      }
      const owner = intent.owner.toLowerCase();
      state.usdcBalance.set(owner, await client.readContract({ address: d.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [owner], blockNumber }));
      state.usdcAllowance.set(owner, await client.readContract({ address: d.usdc, abi: erc20Abi, functionName: 'allowance', args: [owner, d.raw.contracts.Settlement], blockNumber }));
    }
    const accepts = (intent, id) => {
      const m = state.ticketMeta.get(id);
      return m.eventId === intent.eventId && !!(intent.sessionMask & (1n << BigInt(m.sessionId))) && !!(intent.sectionMask & (1n << BigInt(m.sectionId)));
    };
    const bounds = { maxParticipants: 3, maxCandidates: 100, timeoutMs: 5000 };
    const cases = [];
    for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
      const pair = [intents[a], intents[b]];
      const offered = pair.flatMap(i => i.offered);
      // This necessary-condition certificate covers every possible assignment in the pair.
      const shortages = pair.map(i => ({ intentHash: i.id, required: i.exactCount, acceptedTicketsAvailable: offered.filter(id => accepts(i, id)).length })).filter(p => p.acceptedTicketsAvailable < p.required);
      assert.ok(shortages.length, 'Pair lacks an independent missing-class proof');
      const started = performance.now();
      const result = solve(pair, state, bounds);
      const runtimeMs = performance.now() - started;
      assert.equal(result.chosen, null); assert.equal(result.candidates.length, 0); assert.equal(result.evidence.search.termination, 'complete');
      const legs = pair.map((i, p) => ({ intentHash: i.id, receives: pair[1 - p].offered, netPayment: 0n }));
      let expected;
      for (let p = 0; p < pair.length && !expected; p++) for (const id of legs[p].receives) {
        const m = state.ticketMeta.get(id), i = pair[p];
        if (!(i.sessionMask & (1n << BigInt(m.sessionId)))) { expected = { errorName: 'SessionNotAccepted', args: [i.id, m.sessionId] }; break; }
        if (!(i.sectionMask & (1n << BigInt(m.sectionId)))) { expected = { errorName: 'SectionNotAccepted', args: [i.id, m.sectionId] }; break; }
      }
      assert.ok(expected);
      let rejection;
      try { await client.simulateContract({ address: d.raw.contracts.Settlement, abi: abis.Settlement, functionName: 'settle', args: [pair, legs], account: d.deployer, gas: 8000000n }); }
      catch (e) {
        const reverted = e.walk?.(cause => cause.name === 'ContractFunctionRevertedError');
        if (!reverted) throw e;
        rejection = { errorName: reverted.data?.errorName, args: reverted.data?.args };
      }
      assert.deepEqual(rejection, expected, 'Direct-swap simulation must reject for the precise signed condition');
      cases.push({ participants: [a, b], shortages, bounds, runtimeMs, ...result.evidence, simulationResult: { success: false, ...rejection } });
    }
    const started = performance.now();
    const result = solve(intents, state, bounds);
    const runtimeMs = performance.now() - started;
    assert.equal(result.chosen?.intents.length, 3);
    const routes = [];
    for (let p = 0; p < 3; p++) {
      const leg = result.chosen.legs.find(l => l.intentHash === intents[p].id);
      assert.deepEqual([...leg.receives].sort((a, b) => a < b ? -1 : a > b ? 1 : 0), [...intents[(p + 1) % 3].offered].sort((a, b) => a < b ? -1 : a > b ? 1 : 0));
      assert.equal(leg.netPayment, 0n);
      routes.push({ fromOwner: intents[(p + 1) % 3].owner, toOwner: intents[p].owner, tokenIds: leg.receives });
    }
    await client.simulateContract({ address: d.raw.contracts.Settlement, abi: abis.Settlement, functionName: 'settle', args: [result.chosen.intents, result.chosen.legs], account: d.deployer, gas: 8000000n });
    report.groups.push({ name: group.name, exactCount: group.count, intents: intents.map(i => ({ hash: i.id, owner: i.owner, offered: i.offered })), pairCases: cases,
      triple: { bounds, runtimeMs, ...result.evidence, proposal: result.chosen, routes, simulationResult: { success: true }, transactionHash: null },
      apiRequest: { intentHashes: intents.map(i => i.id), minBlock: String(floor) } });
    console.log(`PASS ${group.name}: three distinct wallets; AB/AC/BC impossible by missing class and named contract rejection; ABC solver and simulation passed`);
  }
  const file = `docs/checks/circle-inventory-${batch}.json`;
  fs.mkdirSync('docs/checks', { recursive: true }); fs.writeFileSync(file, json(report));
  console.log(json({ file, indexedBlock: blockNumber, groups: report.groups.length, pairRejections: report.groups.length * 3, tripleSimulations: report.groups.length, settlementBroadcast: false }));
}
main().catch(e => { console.error(e.name === 'AssertionError' ? e.message : `Circle verification failed (${e.name}); retry after checking RPC/index health.`); process.exitCode = 1; });
