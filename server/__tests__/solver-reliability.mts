import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFunctionData, encodeFunctionResult, erc20Abi } from 'viem';
import { solverReadClient, readSolverState } from '../solve-rpc';
import { solveOnChain, parseRequiredIntent } from '../solve';
import { solveLivePoolFromGraph } from '../solve-graph';
import { solveErrorResponse } from '../solve-error';
import { chainConfig, abi } from '../chain';
import { hashIntent, type Intent, type Address } from '../../shared/intent';
import { findPoolSettlement } from '../../lib/solve-api';
import { solverErrorMessage } from '../../lib/solve-errors';

test('solver retries throttled reads through a chain-verified provider at the identical block', async t => {
  t.mock.method(Date, 'now', () => 9_000_000);
  const calls: { url: string; method: string; params: unknown[] }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); calls.push({ url, method: body.method, params: body.params });
    if (url === 'https://rpc.testnet.arc.io') return new Response('', { status: 429, headers: { 'Retry-After': '30' } });
    return Response.json({ result: body.method === 'eth_chainId' ? '0x4cef52' : encodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', result: 123n }) });
  });
  const owner = `0x${'1'.repeat(40)}` as Address;
  const result = await solverReadClient('https://rpc.testnet.arc.io', 5042002).readContract({ address: owner, abi: erc20Abi, functionName: 'balanceOf', args: [owner], blockNumber: 256n });
  assert.equal(result, 123n);
  assert.deepEqual(calls.map(c => c.method), ['eth_call', 'eth_chainId', 'eth_call']);
  assert.deepEqual(calls[0].params, calls[2].params);
  assert.equal(calls[2].params[1], '0x100');
});

test('bounded state reads drain in-flight workers and stop queued work on failure', async () => {
  let release!: () => void, active = 0, maximum = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const executed: number[] = [];
  const failure = new Error('read failed');
  const jobs = Array.from({ length: 9 }, (_, index) => async () => {
    executed.push(index); maximum = Math.max(maximum, ++active);
    try { if (index === 0) throw failure; await gate; } finally { active--; }
  });
  const pending = readSolverState(jobs, 4);
  let finished = false;
  const checked = assert.rejects(pending, error => error === failure).then(() => { finished = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(finished, false);
  release(); await checked;
  assert.deepEqual(executed, [0, 1, 2, 3]); assert.ok(maximum <= 4); assert.equal(active, 0);
  let completed = 0;
  await readSolverState(Array.from({ length: 257 }, () => async () => { completed++; }));
  assert.equal(completed, 257, 'No prefix truncation');
});

test('full solve revalidates each unique ticket and owner once at one block, then simulates separately', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'reshuffle-solver-test-'));
  const config = { ARC_RPC: 'https://solver-fixture.invalid', STORAGE_BACKEND: 'file', STORAGE_DIRECTORY: directory, ALLOW_PERSISTENT_FILE_STORAGE: 'true', VERCEL: '' };
  const saved = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  Object.assign(process.env, config);
  t.after(async () => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } await rm(directory, { recursive: true, force: true }); });
  const { addresses, usdc, chainId } = chainConfig();
  const A = `0x${'1'.repeat(40)}` as Address, B = `0x${'2'.repeat(40)}` as Address;
  const base: Intent = { owner: A, offered: [1n, 2n], eventId: 1, sessionMask: 1n, sectionMask: 1n, exactCount: 2, mustShareSession: true, mustShareSection: true, mustBeAdjacent: true, maxNetPay: 0n, deadline: 2_000_000_000n, nonce: 1n };
  const intents = [base, { ...base, nonce: 2n }, { ...base, owner: B, offered: [3n, 4n] }];
  const calls: { name: string; block: string; args: unknown }[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const ok = (result: unknown) => Response.json({ result });
    if (body.method === 'eth_chainId') return ok(`0x${chainId.toString(16)}`);
    if (body.method === 'eth_getBlockByNumber') return ok({ number: '0x100', timestamp: '0x65000000', hash: `0x${'a'.repeat(64)}` });
    if (body.method === 'eth_blockNumber') return ok('0x101');
    assert.equal(body.method, 'eth_call', 'No broadcast or RPC log fallback');
    const target = String(body.params[0].to).toLowerCase();
    const name = Object.keys(addresses).find(key => addresses[key as keyof typeof addresses].toLowerCase() === target) as keyof typeof addresses | undefined;
    assert.ok(name || target === usdc.toLowerCase());
    const contractAbi = name ? abi(name) : erc20Abi;
    const decoded = decodeFunctionData({ abi: contractAbi, data: body.params[0].data });
    calls.push({ name: decoded.functionName, block: body.params[1], args: decoded.args });
    if (decoded.functionName === 'settle') return ok('0x');
    const token = Number(decoded.args?.[0]);
    const result = decoded.functionName === 'state' ? 1
      : decoded.functionName === 'meta' ? [1, 0, 0, 1, token % 2 + 1, 0]
        : decoded.functionName === 'depositor' ? (token <= 2 ? A : B) : 100_000_000n;
    return ok(encodeFunctionResult({ abi: contractAbi, functionName: decoded.functionName, result }));
  });
  const entries = intents.map(i => [hashIntent(i), i] as const);
  const target = entries[1][0];
  const result = await solveOnChain(entries.map(([hash]) => hash), new Map(entries), { kind: 'subgraph', snapshotBlock: '250', liveIntents: 3, excluded: [] }, target);
  assert.equal(result.searchConfig.mustInclude, target);
  assert.equal(result.searchConfig.requireOwnershipChange, true);
  assert.equal(result.searchConfig.timeoutMs, 8000);
  assert.equal(result.bounds.timeoutMs, 8000);
  assert.ok(result.search.subsetsChecked > 0);
  assert.ok(result.chosen?.intentHashes.includes(target));
  assert.equal(result.intentsConsidered, 3);
  for (const [name, count] of [['state', 3], ['meta', 4], ['depositor', 4], ['balanceOf', 2], ['allowance', 2]] as const) assert.equal(calls.filter(c => c.name === name).length, count, name);
  assert.ok(calls.filter(c => c.name !== 'settle').every(c => c.block === '0x100'));
  assert.equal(calls.find(c => c.name === 'settle')?.block, '0x101');
  assert.equal(result.source.blockNumber, '256'); assert.equal(result.snapshotBlock, '250');
  assert.deepEqual(result.simulationResult, { success: true });
});

test('concurrent whole-pool requests share work only for the same floor and discard failed work', async t => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetch = t.mock.method(globalThis, 'fetch', async () => { await gate; return Response.json({ error: 'fixture' }, { status: 503 }); });
  const first = solveLivePoolFromGraph(100n), same = solveLivePoolFromGraph(100n), newer = solveLivePoolFromGraph(200n);
  assert.equal(first, same); assert.notEqual(first, newer);
  const settled = Promise.allSettled([first, same, newer]);
  release();
  assert.ok((await settled).every(r => r.status === 'rejected'));
  assert.equal(fetch.mock.callCount(), 2, 'A new receipt floor must start a new discovery');
  await assert.rejects(solveLivePoolFromGraph(100n));
  assert.equal(fetch.mock.callCount(), 3, 'Failures must not remain cached');
});

test('rate limits, indexing waits and evidence storage errors retain their distinct public messages', async t => {
  t.mock.method(console, 'error', () => {});
  const errors = [
    { value: Object.assign(new Error('private RPC URL'), { cause: { code: -32005, retryAfter: '9' } }), code: 'ArcRateLimited', status: 429 },
    { value: Object.assign(new Error('private details'), { name: 'SubgraphLagError' }), code: 'SubgraphLagError', status: 409 },
    { value: Object.assign(new Error('private Redis URL'), { name: 'StorageUnavailable' }), code: 'StorageUnavailable', status: 503 },
  ];
  for (const entry of errors) {
    const response = solveErrorResponse(entry.value);
    assert.equal(response.status, entry.status);
    if (entry.status === 429) assert.equal(response.headers.get('Retry-After'), '9');
    const body = await response.json(); assert.equal(body.code, entry.code); assert.doesNotMatch(body.error, /private/);
    t.mock.method(globalThis, 'fetch', async () => Response.json(body, { status: entry.status }));
    await assert.rejects(findPoolSettlement(123n), error => solverErrorMessage(error) === body.error);
  }
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>Unavailable</html>', { status: 504 }));
  await assert.rejects(findPoolSettlement(), error => solverErrorMessage(error).includes('temporarily unavailable'));
});

test('personal pool requests send the required hash and reject malformed targets', async t => {
  const hash = `0x${'AB'.repeat(32)}` as const;
  assert.equal(parseRequiredIntent({ mustInclude: hash }), hash.toLowerCase());
  assert.equal(parseRequiredIntent({}), undefined);
  for (const value of [null, '', 123, [], '0x123']) assert.throws(() => parseRequiredIntent({ mustInclude: value }), /committed intent hash/);
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.deepEqual(JSON.parse(String(init.body)), { mustInclude: hash, minBlock: '123' });
    return Response.json({ proposal: null });
  });
  await findPoolSettlement(123n, hash);
});

test('concurrent personal Graph searches never share the result for a different requested intent', async t => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async () => { await gate; return Response.json({ error: 'fixture' }, { status: 503 }); });
  const a = `0x${'1'.repeat(64)}` as const, b = `0x${'2'.repeat(64)}` as const;
  const first = solveLivePoolFromGraph(300n, a), same = solveLivePoolFromGraph(300n, a), other = solveLivePoolFromGraph(300n, b);
  assert.equal(first, same); assert.notEqual(first, other);
  const settled = Promise.allSettled([first, same, other]); release();
  assert.ok((await settled).every(result => result.status === 'rejected'));
});
