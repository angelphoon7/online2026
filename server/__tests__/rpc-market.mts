import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpcMarketReader, type RpcCheckpoint } from '../market-rpc';
import { solverReadClient } from '../solve-rpc';
import type { Address, Hex } from 'viem';

const address = (digit: string) => `0x${digit.repeat(40)}` as Address;
const hash = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}` as Hex;
const addresses = { TicketNFT: address('1'), Escrow: address('2'), IntentRegistry: address('3'), Settlement: address('4') };
type Call = { functionName: string; args: unknown[]; blockNumber?: bigint };
function fixture(count = 2) {
  const control = {
    head: 100n, chainId: 5042002, owner: address('5'), state: 1, code: '0x1234', fail: false, reorg: false, unstable: false,
    logFailureAt: null as bigint | null,
    headReads: 0, calls: [] as Call[], batches: [] as { contracts: Call[]; blockNumber: bigint; allowFailure: boolean }[],
    ranges: [] as { fromBlock: bigint; toBlock: bigint }[], gate: null as Promise<void> | null,
  };
  const intent = { owner: control.owner, offered: [0n], eventId: 1, sessionMask: 1n, sectionMask: 1n, exactCount: 1,
    mustShareSession: false, mustShareSection: false, mustBeAdjacent: false, maxNetPay: 0n, deadline: 2000n, nonce: 1n, intentHash: hash(1n) };
  const value = (call: Call): unknown => {
    if (control.fail && call.functionName === 'meta') throw new Error('Ticket read failed');
    if (call.functionName === 'nextTokenId') return BigInt(count);
    if (call.functionName === 'meta') return [1, 0, 0, 1, Number(call.args[0]) + 1, 0];
    if (call.functionName === 'ownerOf') return addresses.Escrow;
    if (call.functionName === 'depositor') return control.owner;
    if (call.functionName === 'state') return control.state;
    throw new Error('Unexpected fixture read');
  };
  const client = {
    getChainId: async () => control.chainId,
    getBlock: async (query: { blockNumber?: bigint } = {}) => {
      if (query.blockNumber === undefined) control.headReads++;
      const number = query.blockNumber ?? control.head;
      const replaced = query.blockNumber !== undefined && ((control.reorg && number === 100n) || (control.unstable && number === control.head));
      return { number, timestamp: 1000n, hash: hash(replaced ? number + 999n : number) };
    },
    getBytecode: async () => control.code,
    readContract: async (call: Call) => { control.calls.push(call); return value(call); },
    multicall: async (batch: { contracts: Call[]; blockNumber: bigint; allowFailure: boolean }) => {
      control.batches.push(batch); return batch.contracts.map(value);
    },
    getLogs: async (range: { fromBlock: bigint; toBlock: bigint }) => {
      control.ranges.push(range);
      if (control.logFailureAt === range.fromBlock) throw new Error('History rate limited');
      const gate = control.gate; control.gate = null; if (gate) await gate;
      if (range.fromBlock > 2n) return [];
      return [{ eventName: 'IntentCommitted', args: { ...intent, intentHash: hash(control.reorg ? 2n : 1n) },
        address: addresses.IntentRegistry, transactionHash: hash(10n), blockNumber: 2n }];
    },
  } as unknown as Parameters<typeof createRpcMarketReader>[0];
  return { control, client, read: createRpcMarketReader(client, addresses, 5042002, 1n) };
}

test('RPC market batches every ticket and intent read at one block without dropping records', async () => {
  const { read, control } = fixture(200);
  const market = await read();
  assert.equal(market.source, 'rpc'); assert.equal(market.blockNumber, '100');
  assert.equal(market.tickets.length, 200); assert.equal(market.intents.length, 1);
  assert.equal(market.tickets.at(-1)?.seat, 200); assert.equal(market.tickets[0].depositor, control.owner);
  assert.deepEqual(control.calls.map(call => call.functionName), ['nextTokenId']);
  assert.equal(control.batches.reduce((sum, batch) => sum + batch.contracts.length, 0), 601);
  assert.ok(control.batches.every(batch => batch.blockNumber === 100n && batch.contracts.length <= 96 && !batch.allowFailure));
});

test('warm cache accepts satisfied floors; forced refresh and newer receipts reread mutable state', async () => {
  const { read, control } = fixture();
  const original = await read(); const reads = control.headReads;
  assert.equal(await read(false, 100n), original); assert.equal(control.headReads, reads);
  control.head = 101n; control.owner = address('6'); control.state = 2;
  const fresh = await read(true, 100n);
  assert.equal(fresh.tickets[0].depositor, address('6')); assert.equal(fresh.intents[0].state, 2);
  assert.equal(control.ranges.at(-1)?.fromBlock, 101n); assert.equal(fresh.intents.length, 1);
  control.head = 102n;
  assert.equal((await read(false, 102n)).blockNumber, '102');
});

test('higher receipt floor never receives an older in-flight snapshot', async () => {
  const { read, control } = fixture(); let release!: () => void;
  control.gate = new Promise<void>(resolve => { release = resolve; });
  const old = read();
  while (!control.ranges.length) await new Promise(resolve => setImmediate(resolve));
  control.head = 110n; const newer = read(false, 110n); release();
  assert.equal((await old).blockNumber, '100'); assert.equal((await newer).blockNumber, '110');
  assert.equal(control.headReads, 2);
});

test('failed contract reads never publish a partial snapshot and can recover', async () => {
  const { read, control } = fixture();
  await read(); control.head = 101n; control.fail = true;
  await assert.rejects(read(true, 101n), /Ticket read failed/);
  control.fail = false; control.state = 3;
  const recovered = await read(true, 101n);
  assert.equal(recovered.tickets.length, 2); assert.equal(recovered.intents[0].state, 3);
});

test('changed historical boundary rebuilds discovery and removes history from the old fork', async () => {
  const { read, control } = fixture(); await read();
  control.head = 101n; control.reorg = true;
  const rebuilt = await read(true);
  assert.equal(control.ranges.at(-1)?.fromBlock, 1n);
  assert.deepEqual(rebuilt.intents.map(item => item.hash), [hash(2n)]);
});

test('a local restart reuses checked history but never displays persisted ownership or state', async () => {
  const { read, control, client } = fixture();
  const saved = { blockHash: hash(100n), value: await read() };
  const checkpoints: RpcCheckpoint[] = [];
  control.head = 101n; control.owner = address('7'); control.state = 2;
  const restarted = createRpcMarketReader(client, addresses, 5042002, 1n, { load: async () => saved, save: async value => { checkpoints.push(value); } });
  const market = await restarted();
  assert.equal(market.blockNumber, '101'); assert.equal(market.tickets[0].depositor, address('7'));
  assert.equal(market.intents[0].state, 2); assert.equal(control.ranges.at(-1)?.fromBlock, 101n);
  assert.equal(checkpoints.length, 1);
});

test('a reorg during the snapshot rejects it without saving a checkpoint', async () => {
  const { client, control } = fixture(); let saved = false;
  const read = createRpcMarketReader(client, addresses, 5042002, 1n, { load: async () => null, save: async () => { saved = true; } });
  control.unstable = true;
  await assert.rejects(read(), /snapshot changed/); assert.equal(saved, false);
});

test('missing Multicall uses bounded individual reads with identical snapshot data', async () => {
  const { control, read } = fixture(); control.code = '0x';
  const market = await read();
  assert.equal(market.tickets.length, 2); assert.equal(market.intents.length, 1);
  assert.equal(control.batches.length, 0); assert.equal(control.calls.length, 8);
});

test('chain and discovery bounds fail before scanning or returning an older floor', async () => {
  const wrong = fixture(); wrong.control.chainId = 1;
  await assert.rejects(wrong.read(), /Wrong RPC chain/); assert.equal(wrong.control.calls.length, 0);
  const lagging = fixture(); await assert.rejects(lagging.read(false, 101n), /ChainLag/); assert.equal(lagging.control.calls.length, 0);
  const tooMany = fixture(1001); await assert.rejects(tooMany.read(), /discovery bound/); assert.equal(tooMany.control.ranges.length, 0);
});

test('a late history failure resumes at the failed page without publishing or rescanning the completed prefix', async () => {
  const { control, read } = fixture(); control.head = 25000n; control.logFailureAt = 10001n;
  await assert.rejects(read(), /History rate limited/);
  assert.deepEqual(control.ranges.map(range => range.fromBlock), [1n, 10001n]);
  control.logFailureAt = null; control.owner = address('8'); control.head = 25001n;
  const recovered = await read();
  assert.deepEqual(control.ranges.map(range => range.fromBlock), [1n, 10001n, 10001n, 20001n]);
  assert.equal(recovered.intents.length, 1); assert.equal(recovered.tickets[0].depositor, address('8'));
  assert.equal(recovered.blockNumber, '25001');
});

test('market transport honors a brief provider cooldown before retrying the same read', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1
    ? Response.json({ error: { code: -32005 } }, { status: 429, headers: { 'Retry-After': '1' } })
    : Response.json({ result: '0x65' }));
  assert.equal(await solverReadClient('https://short-cooldown.invalid', 5042002, 2).getBlockNumber(), 101n);
  assert.equal(calls, 2);
});

test('market transport returns long provider cooldowns without waiting or bypassing them', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: -32005 } }, { status: 429, headers: { 'Retry-After': '60' } }));
  await assert.rejects(solverReadClient('https://long-cooldown.invalid', 5042002, 2).getBlockNumber(), { name: 'LimitExceededRpcError' });
  assert.equal(fetch.mock.callCount(), 1);
});
