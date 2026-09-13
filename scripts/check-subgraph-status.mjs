// Public Step 4-A checks. Does not load credentials or claim access to Studio's private logs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPublicClient, http } from 'viem';
import { loadDeployment } from './lib/deployment.mjs';
import { json, queryGraph } from './lib/graph-acceptance.mjs';
import abis from '../server/abis.json' with { type: 'json' };

const d = loadDeployment('arc-testnet');
const client = createPublicClient({ transport: http(d.rpc) });
const response = await queryGraph(d.subgraphUrl, `{
  _meta { block { number timestamp hash } deployment hasIndexingErrors }
  intents(first: 1000) { id state }
  tickets(first: 1000) { id escrowed redeemed }
  settlements(first: 1000) { id }
}`);
assert.ok(!response.errors, 'Graph status query failed');
const data = response.data;
assert.equal(data._meta.deployment, d.raw.subgraphDeployment);
assert.equal(data._meta.hasIndexingErrors, false);
for (const list of [data.intents, data.tickets, data.settlements]) assert.ok(list.length < 1000, 'Count may be truncated; paginate before accepting');
const blockNumber = BigInt(data._meta.block.number);
assert.equal(await client.getChainId(), d.chainId);
const [block, head, issued, escrowed] = await Promise.all([
  client.getBlock({ blockNumber }), client.getBlockNumber({ cacheTime: 0 }),
  client.readContract({ address: d.contracts.TicketNFT.address, abi: abis.TicketNFT, functionName: 'nextTokenId', blockNumber }),
  client.readContract({ address: d.contracts.TicketNFT.address, abi: abis.TicketNFT, functionName: 'balanceOf', args: [d.contracts.Escrow.address], blockNumber }),
]);
assert.equal(data._meta.block.hash.toLowerCase(), block.hash.toLowerCase());
assert.equal(BigInt(data.tickets.length), issued);
assert.equal(BigInt(data.tickets.filter(t => t.escrowed).length), escrowed);
for (const intent of d.seed?.intents ?? []) assert.ok(data.intents.some(i => i.id === intent.hash), 'Initial seed commitment missing');
const record = { checkedAt: new Date().toISOString(), endpoint: d.subgraphUrl, chainId: d.chainId, meta: data._meta,
  observedChainHead: head, headMinusIndexBlocks: head - blockNumber,
  counts: { intents: data.intents.length, states: Object.fromEntries(['LIVE', 'SETTLED', 'REVOKED'].map(s => [s, data.intents.filter(i => i.state === s).length])), tickets: data.tickets.length, escrowed: Number(escrowed), settlements: data.settlements.length },
  checks: { indexedBlockHashMatchesRPC: true, ticketCountMatchesRPC: true, escrowCountMatchesRPC: true, initialSeedIntentsPresent: true },
  scope: 'Public query health and counts at one indexed block. Does not establish Studio Synced label or absence of historical log warnings.',
};
fs.mkdirSync('docs/checks', { recursive: true });
fs.writeFileSync('docs/checks/graph-status.json', json(record));
console.log(json(record));
