// Isolated RPC and throwaway issuer key. Never sends a transaction to Arc.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { decodeFunctionData, encodeFunctionResult, encodeEventTopics, encodeAbiParameters, keccak256, parseTransaction, toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const root = process.cwd();
const deployment = JSON.parse(await readFile('deployments/arc-testnet.json', 'utf8'));
const abi = JSON.parse(await readFile('server/abis.json', 'utf8')).TicketNFT;
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,export {}', shortCircuit: true };
  if (specifier.startsWith('@/')) specifier = pathToFileURL(path.join(root, specifier.slice(2))).href;
  if ((specifier.startsWith('.') || specifier.startsWith('file:')) && !/\.[a-z]+$/i.test(specifier)) specifier += '.ts';
  return next(specifier, context);
}, load(url, context, next) {
  if (url.endsWith('.json')) return next(url, { ...context, importAttributes: { type: 'json' } });
  return next(url, context);
} });
await mkdir('.tools', { recursive: true });
const testDir = await mkdtemp(path.join(root, '.tools', 'demo-ticket-test-'));
process.chdir(testDir);
const receipts = new Map();
let issued = 0, nonce = 0, interruptSecond = true, wrongChain = false;
const zeroHash = '0x' + '00'.repeat(32);
const blockHash = '0x' + 'ab'.repeat(32);
const zeroAddress = '0x' + '00'.repeat(20);
const server = createServer(async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk;
  const rpc = JSON.parse(body);
  try {
    let result;
    switch (rpc.method) {
      case 'eth_chainId': result = toHex(wrongChain ? 1 : 5042002); break;
      case 'eth_getTransactionCount': result = toHex(nonce); break;
      case 'eth_blockNumber': result = '0x64'; break;
      case 'eth_maxPriorityFeePerGas': result = '0x3b9aca00'; break;
      case 'eth_gasPrice': result = '0x77359400'; break;
      case 'eth_getBlockByNumber': result = { number: '0x64', hash: blockHash, parentHash: zeroHash, baseFeePerGas: '0x3b9aca00', timestamp: '0x1', gasLimit: '0x1c9c380', gasUsed: '0x0', transactions: [], miner: zeroAddress, difficulty: '0x0', extraData: '0x', nonce: '0x0000000000000000', size: '0x0', uncles: [], logsBloom: '0x' + '00'.repeat(256), receiptsRoot: zeroHash, stateRoot: zeroHash, transactionsRoot: zeroHash, sha3Uncles: zeroHash }; break;
      case 'eth_call': {
        const call = decodeFunctionData({ abi, data: rpc.params[0].data });
        if (call.functionName === 'mint' && issued === 1 && interruptSecond) throw Error('Simulated issuer outage after first mint');
        result = encodeFunctionResult({ abi, functionName: call.functionName, result: call.functionName === 'registeredIssuers' ? true : BigInt(50 + issued) });
        break;
      }
      case 'eth_getTransactionReceipt': result = receipts.get(rpc.params[0]) ?? null; break;
      case 'eth_sendRawTransaction': {
        const hash = keccak256(rpc.params[0]); result = hash;
        if (receipts.has(hash)) break;
        const tx = parseTransaction(rpc.params[0]);
        assert.equal(Number(tx.chainId), 5042002);
        assert.equal(tx.gas, 1000000n);
        const { args } = decodeFunctionData({ abi, data: tx.data });
        const [to, eventId, sessionId, sectionId, row, seat] = args;
        const tokenId = BigInt(50 + issued++); nonce++;
        const log = { address: deployment.contracts.TicketNFT, topics: encodeEventTopics({ abi, eventName: 'TicketMinted', args: { tokenId, to, eventId } }), data: encodeAbiParameters([{ type: 'uint16' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint16' }], [sessionId, sectionId, row, seat]), blockHash, blockNumber: '0x64', transactionHash: hash, transactionIndex: '0x0', logIndex: '0x0', removed: false };
        receipts.set(hash, { transactionHash: hash, blockHash, blockNumber: '0x64', transactionIndex: '0x0', from: zeroAddress, to: deployment.contracts.TicketNFT, cumulativeGasUsed: '0x10000', gasUsed: '0x10000', effectiveGasPrice: '0x1', contractAddress: null, logs: [log], logsBloom: '0x' + '00'.repeat(256), status: '0x1', type: '0x2' });
        break;
      }
      default: throw Error(`Unexpected RPC method ${rpc.method}`);
    }
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  } catch (error) { response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message: error.message } })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
Object.assign(process.env, { NODE_ENV: 'development', ARC_RPC: `http://127.0.0.1:${server.address().port}`, ARC_CHAIN_ID: '5042002', PRIVATE_KEY: generatePrivateKey(), DEMO_ISSUER_PRIVATE_KEY: '', NEXT_PUBLIC_TICKET_NFT: deployment.contracts.TicketNFT, NEXT_PUBLIC_ESCROW: deployment.contracts.Escrow, NEXT_PUBLIC_INTENT_REGISTRY: deployment.contracts.IntentRegistry, NEXT_PUBLIC_SETTLEMENT: deployment.contracts.Settlement });
const recipientAccount = privateKeyToAccount(generatePrivateKey());
const recipient = recipientAccount.address;
try {
  const { issueDemoTickets, demoTicketConfig } = await import(pathToFileURL(path.join(root, 'server/demo-tickets.ts')));
  await assert.rejects(issueDemoTickets(recipient));
  assert.equal(issued, 1, 'First ticket was minted before interruption');
  interruptSecond = false;
  const result = await issueDemoTickets(recipient);
  assert.deepEqual(result.tokenIds, ['50', '51']);
  assert.equal(issued, 2, 'Retry must finish only the missing ticket');
  assert.deepEqual(await issueDemoTickets(recipient), result);
  assert.equal(issued, 2, 'Repeated claim must not mint more tickets');
  const { GET, POST } = await import(pathToFileURL(path.join(root, 'app/api/demo/tickets/route.ts')));
  const origin = 'http://demo.local';
  const makePost = (body, site = origin) => new Request(origin + '/api/demo/tickets', { method: 'POST', headers: { origin: site, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await POST(makePost({}, 'http://other.local'))).status, 403);
  assert.equal((await GET(new Request(origin + '/api/demo/tickets?address=invalid'))).status, 400);
  const challenge = await (await GET(new Request(origin + '/api/demo/tickets?address=' + recipient))).json();
  const attacker = privateKeyToAccount(generatePrivateKey());
  const badSignature = await attacker.signMessage({ message: challenge.message });
  assert.equal((await POST(makePost({ message: challenge.message, signature: badSignature }))).status, 401);
  const signature = await recipientAccount.signMessage({ message: challenge.message });
  const body = { message: challenge.message, signature };
  assert.equal((await POST(makePost(body))).status, 200);
  assert.equal((await POST(makePost(body))).status, 401, 'Consumed signature cannot be replayed');
  assert.equal(issued, 2);
  console.log('PASS claim API: same-origin check, recipient validation, ownership signature, successful claim and replay rejection.');
  wrongChain = true;
  await assert.rejects(issueDemoTickets(recipient), /Arc Testnet/);
  process.env.DEMO_TICKETS_ENABLED = 'false';
  assert.throws(demoTicketConfig, /disabled/);
  console.log('PASS issuer-only demo service: verified mint receipts, partial-claim recovery, idempotent retries, explicit gas, wrong-chain and disabled guards. Local RPC only.');
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); process.chdir(root); }
