import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Public third-party subgraph used only to check Studio's indexing support.
// This is not RESHUFFLE's endpoint and must not be used as its discovery source.
const endpoint = 'https://api.studio.thegraph.com/query/1748590/arcnslatest/v3';
const registryUrl = 'https://raw.githubusercontent.com/graphprotocol/networks-registry/main/registry/eip155/arc-testnet.json';
const rpcUrl = 'https://rpc.testnet.arc.io';
async function json(url, body) {
  const response = await fetch(url, {
    ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  return response.json();
}
const [registry, metadataResponse, chainResponse] = await Promise.all([
  json(registryUrl),
  json(endpoint, { query: '{ _meta { deployment block { number hash } hasIndexingErrors } }' }),
  json(rpcUrl, { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
]);
assert.equal(registry.id, 'arc-testnet');
assert.equal(registry.caip2Id, 'eip155:5042002');
assert.ok(registry.services.subgraphs.includes('https://api.studio.thegraph.com/deploy'));
assert.ok(!metadataResponse.errors, 'Studio metadata query failed');
const meta = metadataResponse.data?._meta;
assert.ok(meta?.block?.hash, 'Missing indexed block hash');
assert.equal(meta.hasIndexingErrors, false);
assert.equal(Number(BigInt(chainResponse.result)), 5042002);
const blockResponse = await json(rpcUrl, { jsonrpc: '2.0', id: 2, method: 'eth_getBlockByNumber', params: [`0x${BigInt(meta.block.number).toString(16)}`, false] });
assert.equal(blockResponse.result?.hash?.toLowerCase(), meta.block.hash.toLowerCase(), 'Studio block does not match Arc');
assert.equal(BigInt(blockResponse.result.number), BigInt(meta.block.number));
const record = {
  checkedAt: new Date().toISOString(),
  conclusion: 'Studio indexes Arc Testnet; project-specific creation and deployment remain unverified.',
  registry: { source: registryUrl, entry: registry },
  studio: { publicExampleEndpoint: endpoint, project: 'Third-party ArcNS, not RESHUFFLE', query: '{ _meta { deployment block { number hash } hasIndexingErrors } }', response: metadataResponse },
  arcRpc: { endpoint: rpcUrl, chainId: 5042002, blockNumber: meta.block.number, blockHash: blockResponse.result.hash },
  checks: { studioListedInRegistry: true, metadataQuerySucceeded: true, hasIndexingErrors: false, indexedBlockMatchesArc: true },
  limitations: ['This checks an existing public Studio deployment, not creation of a new RESHUFFLE subgraph.', 'An authenticated Studio account and deploy key are still needed for project creation/deployment.', 'No RESHUFFLE Graph endpoint is configured by this script.'],
};
await mkdir(new URL('../deployments/', import.meta.url), { recursive: true });
await writeFile(new URL('../deployments/graph-studio-support-check.json', import.meta.url), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ chainId: 5042002, indexedBlock: meta.block.number, blockHashMatches: true, hasIndexingErrors: false, evidence: 'deployments/graph-studio-support-check.json' }, null, 2));
