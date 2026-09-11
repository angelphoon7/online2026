// Full backend search against a local RPC fixture. No keys or broadcasts.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { registerHooks } from 'node:module';
import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeFunctionData, encodeFunctionResult, erc20Abi, toHex } from 'viem';
import { hashIntent, solve, validateSettlement } from '../solver/dist/index.js';

const root = process.cwd();
const abis = JSON.parse(await readFile('server/abis.json', 'utf8'));
const deployment = JSON.parse(await readFile('deployments/arc-testnet.json', 'utf8'));
const combined = [...abis.TicketNFT, ...abis.Escrow, ...abis.IntentRegistry, ...abis.Settlement, ...erc20Abi];
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,export {}', shortCircuit: true };
  if (specifier.startsWith('@/')) specifier = pathToFileURL(path.join(root, specifier.slice(2))).href;
  if ((specifier.startsWith('.') || specifier.startsWith('file:')) && !/\.[a-z]+$/i.test(specifier)) specifier += '.ts';
  return next(specifier, context);
}, load(url, context, next) {
  return next(url, url.endsWith('.json') ? { ...context, importAttributes: { type: 'json' } } : context);
} });
const intents = Array.from({ length: 6 }, (_, n) => ({
  owner: `0x${(n + 1).toString(16).padStart(40, '0')}`, offered: [BigInt(n + 1)], eventId: 1,
  sessionMask: 1n << BigInt(n < 4 ? 9 : n === 4 ? 2 : 1), sectionMask: 1n,
  exactCount: 1, mustShareSession: true, mustShareSection: true, mustBeAdjacent: false,
  maxNetPay: 0n, deadline: 2000n, nonce: 0n,
}));
const state = { blockTimestamp: 1000n, ticketMeta: new Map(), depositor: new Map(), intentState: new Map(), usdcBalance: new Map(), usdcAllowance: new Map() };
for (const [n, intent] of intents.entries()) {
  state.ticketMeta.set(BigInt(n + 1), { eventId: 1, sessionId: n < 4 ? 0 : n === 4 ? 1 : 2, sectionId: 0, row: 1, seat: n + 1, status: 0 });
  state.depositor.set(BigInt(n + 1), intent.owner);
  state.intentState.set(hashIntent(intent), 1);
  state.usdcBalance.set(intent.owner, 1000000n); state.usdcAllowance.set(intent.owner, 1000000n);
}
const wire = intent => ({ ...intent, offered: intent.offered.map(String), sessionMask: String(intent.sessionMask), sectionMask: String(intent.sectionMask), maxNetPay: String(intent.maxNetPay), deadline: String(intent.deadline), nonce: String(intent.nonce), hash: hashIntent(intent), state: 1, expired: false });
const snapshot = { intents: intents.map(wire), tickets: [], settlements: [], defaultHashes: [], blockNumber: '99', timestamp: '999' };
let wrongChain = false, simulateFailure = false, simulations = 0;
const server = createServer(async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk;
  const rpc = JSON.parse(body);
  try {
    let result;
    if (rpc.method === 'eth_chainId') result = toHex(wrongChain ? 1 : 5042002);
    else if (rpc.method === 'eth_blockNumber') result = '0x64';
    else if (rpc.method === 'eth_getBlockByNumber') result = { number: '0x64', timestamp: '0x3e8', hash: '0x' + 'aa'.repeat(32), transactions: [] };
    else if (rpc.method === 'eth_call') {
      const { functionName, args } = decodeFunctionData({ abi: combined, data: rpc.params[0].data });
      assert.equal(rpc.params[1], '0x64', 'State reads and simulation use the recorded block');
      let value;
      if (functionName === 'state') value = state.intentState.get(args[0]);
      else if (functionName === 'balanceOf' || functionName === 'allowance') value = 1000000n;
      else if (functionName === 'depositor') value = state.depositor.get(args[0]);
      else if (functionName === 'meta') { const m = state.ticketMeta.get(args[0]); value = [m.eventId, m.sessionId, m.sectionId, m.row, m.seat, m.status]; }
      else if (functionName === 'settle') {
        simulations++;
        assert.equal(args[0].length, 2);
        assert.equal(validateSettlement(args[0], args[1], state), null);
        if (simulateFailure) throw Error('Simulated state changed before submission');
        result = '0x';
      } else throw Error(`Unexpected call ${functionName}`);
      if (result === undefined) result = encodeFunctionResult({ abi: combined, functionName, result: value });
    } else throw Error(`Unexpected RPC ${rpc.method}; this test must never broadcast or rediscover logs`);
    response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  } catch (error) { response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message: error.message } })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
Object.assign(process.env, { ARC_RPC: `http://127.0.0.1:${server.address().port}`, ARC_CHAIN_ID: '5042002', NEXT_PUBLIC_DEPLOYMENT_BLOCK: '0', ...Object.fromEntries(Object.entries({ TICKET_NFT: 'TicketNFT', ESCROW: 'Escrow', INTENT_REGISTRY: 'IntentRegistry', SETTLEMENT: 'Settlement' }).map(([key, name]) => [`NEXT_PUBLIC_${key}`, deployment.contracts[name]])) });
await mkdir('.tools', { recursive: true });
process.chdir(await mkdtemp(path.join(root, '.tools', 'pool-test-')));
try {
  const { solvePoolSnapshot } = await import(pathToFileURL(path.join(root, 'server/solve-pool.ts')));
  assert.equal(solve(intents.slice(0, 4), state, { maxParticipants: 4, maxCandidates: 100, timeoutMs: 2000 }).chosen, null);
  const result = await solvePoolSnapshot(snapshot);
  assert.equal(result.pool.liveIntents, 6);
  assert.equal(result.intentsConsidered, 6);
  assert.equal(result.requestedIntentHashes.length, 6);
  assert.deepEqual(result.proposal.legs.map(l => l.intentHash).sort(), intents.slice(4).map(hashIntent).sort());
  assert.equal(result.simulationResult.success, true);
  assert.equal(result.search.termination, 'complete');
  assert.equal(result.source.blockNumber, '100');
  assert.ok(simulations > 0);
  const unsupported = { ...intents[0], nonce: 1n, exactCount: 5 };
  const withUnsupported = await solvePoolSnapshot({ ...snapshot, intents: [...snapshot.intents, wire(unsupported)] });
  assert.equal(withUnsupported.pool.liveIntents, 7);
  assert.equal(withUnsupported.pool.searchableIntents, 6);
  assert.equal(withUnsupported.candidatesExcluded.filter(e => e.reason.startsWith('Search bound')).length, 1);
  assert.equal(withUnsupported.simulationResult.success, true);
  state.intentState.set(hashIntent(intents[4]), 2);
  const revoked = await solvePoolSnapshot(snapshot);
  assert.equal(revoked.proposal, null);
  assert.ok(revoked.candidatesExcluded.some(e => e.reason.includes('IntentNotLive')));
  state.intentState.set(hashIntent(intents[4]), 1);
  simulateFailure = true;
  assert.equal((await solvePoolSnapshot(snapshot)).simulationResult.success, false);
  simulateFailure = false;
  assert.equal((await solvePoolSnapshot({ ...snapshot, intents: [] })).proposal, null);
  await assert.rejects(solvePoolSnapshot({ ...snapshot, intents: Array(257).fill(snapshot.intents[0]) }), /No partial pool/);
  await assert.rejects(solvePoolSnapshot({ ...snapshot, intents: [{ ...snapshot.intents[0], sectionMask: '2' }] }), /hash mismatch/);
  wrongChain = true;
  await assert.rejects(solvePoolSnapshot(snapshot), /wrong chain/);
  console.log('PASS backend searches all six intents and finds the pair beyond the first four; fresh state, unsupported inputs, simulation, empty pool and capacity guard verified. No broadcasts.');
} finally { process.chdir(root); await new Promise(resolve => server.close(resolve)); }
