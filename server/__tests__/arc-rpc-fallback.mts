import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readArcRpc } from '../arc-read-rpc';
import { findUnusedIntentNonce } from '../../lib/intent-nonce';

const primary = 'https://rpc.testnet.arc.io';
const alternate = 'https://rpc.drpc.testnet.arc.io';
const last = 'https://rpc.quicknode.testnet.arc.io';
const read = { jsonrpc: '2.0' as const, id: 7, method: 'eth_blockNumber', params: [] };
let time = 10_000_000;
function fresh(t: TestContext) { time += 1_000_000; t.mock.method(Date, 'now', () => time); }
const ok = (result: string) => Response.json({ jsonrpc: '2.0', id: 7, result });

test('a throttled primary immediately uses a verified fallback and respects the primary cooldown', async t => {
  fresh(t);
  const calls: { url: string; method: string }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string); calls.push({ url, method: body.method });
    if (url === primary) return new Response('private provider detail', { status: 429, headers: { 'Retry-After': '20' } });
    assert.equal(url, alternate);
    return ok(body.method === 'eth_chainId' ? '0x4cef52' : '0x100');
  });
  const first = await readArcRpc(read, primary, 5042002);
  assert.deepEqual(await first.json(), { jsonrpc: '2.0', id: 7, result: '0x100' });
  assert.equal(first.headers.get('Cache-Control'), 'no-store');
  const second = await readArcRpc({ ...read, id: 8 }, primary, 5042002);
  assert.equal((await second.json()).id, 8);
  assert.deepEqual(calls, [
    { url: primary, method: 'eth_blockNumber' }, { url: alternate, method: 'eth_chainId' },
    { url: alternate, method: 'eth_blockNumber' }, { url: alternate, method: 'eth_blockNumber' },
  ]);
});

test('a fallback on the wrong chain never receives state reads', async t => {
  fresh(t);
  const calls: { url: string; method: string }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string); calls.push({ url, method: body.method });
    if (url === primary) throw new TypeError('connection failed');
    if (url === alternate) return ok('0x1');
    return ok(body.method === 'eth_chainId' ? '0x4cef52' : '0x200');
  });
  assert.equal((await (await readArcRpc(read, primary, 5042002)).json()).result, '0x200');
  assert.deepEqual(calls.filter(call => call.url === alternate), [{ url: alternate, method: 'eth_chainId' }]);
  assert.equal(calls.at(-1)?.url, last);
});

test('contract reverts retain their error data and are never retried on another provider', async t => {
  fresh(t);
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 3, message: 'private', data: '0x12345678' } }));
  const response = await readArcRpc(read, primary, 5042002);
  assert.deepEqual((await response.json()).error, { code: 3, message: 'Arc rejected the read request', data: '0x12345678' });
  assert.equal(fetch.mock.callCount(), 1);
});

test('all providers throttled yields the earliest permitted retry without revealing upstream details', async t => {
  fresh(t);
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string) => new Response('private details', {
    status: 429, headers: { 'Retry-After': url === primary ? '20' : url === alternate ? '5' : '10' },
  }));
  const response = await readArcRpc(read, primary, 5042002);
  assert.equal(response.status, 429); assert.equal(response.headers.get('Retry-After'), '5');
  assert.equal((await response.json()).error.code, -32005);
  assert.equal(fetch.mock.callCount(), 3);
  await readArcRpc(read, primary, 5042002);
  assert.equal(fetch.mock.callCount(), 3, 'No provider is contacted inside its cooldown');
});

test('identical concurrent reads share work but subsequent reads are fresh and response IDs are preserved', async t => {
  fresh(t);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetch = t.mock.method(globalThis, 'fetch', async () => { await gate; return ok('0x300'); });
  const first = readArcRpc(read, 'https://private-rpc.invalid', 5042002);
  const second = readArcRpc({ ...read, id: 9 }, 'https://private-rpc.invalid', 5042002);
  assert.equal(fetch.mock.callCount(), 1);
  release();
  assert.equal((await (await first).json()).id, 7);
  assert.equal((await (await second).json()).id, 9);
  await readArcRpc(read, 'https://private-rpc.invalid', 5042002);
  assert.equal(fetch.mock.callCount(), 2);
});

test('custom RPC configuration and other networks do not silently use public testnet providers', async t => {
  fresh(t);
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('unavailable', { status: 503 }));
  assert.equal((await readArcRpc(read, 'https://private-only.invalid', 5042002)).status, 502);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal((await readArcRpc(read, primary, 31337)).status, 502);
  assert.equal(fetch.mock.callCount(), 2);
});

test('consumed nonce history costs at most two reads and never scans sequential values', async () => {
  const calls: bigint[] = [];
  const nonce = await findUnusedIntentNonce(0n, async value => { calls.push(value); return value < 1_000_000n; }, () => 1n << 200n);
  assert.equal(nonce, 1n << 200n);
  assert.deepEqual(calls, [0n, 1n << 200n]);
  assert.equal(await findUnusedIntentNonce(5n, async () => false, () => { throw Error('unnecessary generation'); }), 5n);
});

test('nonce collisions and RPC errors fail before signing, and uint256 overflow selects a valid nonce', async () => {
  await assert.rejects(findUnusedIntentNonce(0n, async () => true, () => 3n), /unused intent nonce/);
  await assert.rejects(findUnusedIntentNonce(0n, async () => { throw Error('RPC unavailable'); }), /RPC unavailable/);
  assert.equal(await findUnusedIntentNonce(1n << 256n, async value => { assert.equal(value, 99n); return false; }, () => 99n), 99n);
});
