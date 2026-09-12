// Save the subgraph's raw PoolSnapshot response as a test fixture.
//
//   node scripts/capture-snapshot.mjs [network] [--label name]
//
// Step 9 of docs/RESHUFFLE_GRAPH_PLAN.md. The diagnosis tests need a pool that does not
// change under them, but they must still exercise the REAL parse path - getPoolSnapshot's
// hash binding, its signed-integer conversion, its V1-V3 exclusions - rather than a
// hand-built object that skips all of it.
//
// So this writes the untouched GraphQL response body, exactly as graph-node returned it, to
// fixtures/snapshot-<block>.json. Tests then stub fetch with that body and parse it through
// getPoolSnapshot, which means a mapping change that breaks decoding breaks a test rather
// than surfacing at a demo.
//
// Captured data is a record of one block and nothing else: re-capture after re-seeding, and
// never hand-edit a fixture - an edited one no longer proves the parse path works on real
// indexer output, which is the only reason it exists.

import fs from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { loadDeployment, deploymentName } from './lib/deployment.mjs';

if (fs.existsSync('.env')) loadEnvFile('.env');

const args = process.argv.slice(2);
const labelArg = args.indexOf('--label');
const label = labelArg >= 0 ? args[labelArg + 1] : null;
const network = deploymentName(args.find((a) => !a.startsWith('--') && Number.isNaN(Number(a))));

const deployment = loadDeployment(network);
const subgraphUrl = process.env.SUBGRAPH_URL ?? deployment.subgraphUrl;
if (!subgraphUrl) {
  console.log('FAIL no subgraphUrl — deploy first (npm run subgraph:deploy vX.Y.Z)');
  process.exit(1);
}

// The same query shape as shared/graph/queries.ts POOL_SNAPSHOT, with the freshness floor left
// at 0: a capture wants whatever the indexer has, not a specific block.
const QUERY = `
query PoolSnapshot($first: Int!) {
  _meta {
    block { number timestamp }
    hasIndexingErrors
    deployment
  }
  intents(first: $first, where: { state: LIVE }, orderBy: committedAtBlock, orderDirection: asc) {
    id
    owner
    eventId
    offered
    sessionMask
    sectionMask
    exactCount
    mustShareSession
    mustShareSection
    mustBeAdjacent
    maxNetPay
    deadline
    nonce
    committedAtBlock
    committedTx
    offeredTickets { id escrowed depositor redeemed }
  }
  tickets(first: $first, where: { escrowed: true, redeemed: false }, orderBy: tokenId, orderDirection: asc) {
    id
    eventId
    sessionId
    sectionId
    row
    seat
    depositor
    redeemed
  }
}`;

const response = await fetch(subgraphUrl, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(process.env.SUBGRAPH_API_KEY ? { authorization: `Bearer ${process.env.SUBGRAPH_API_KEY}` } : {}),
  },
  body: JSON.stringify({ query: QUERY, variables: { first: 1000 } }),
});

const body = await response.json();
if (body.errors?.length) {
  console.log('FAIL subgraph errors:', body.errors.map((e) => e.message).join('; '));
  process.exit(1);
}

const meta = body.data?._meta;
if (!meta) {
  console.log('FAIL response carried no _meta; nothing to pin this capture to');
  process.exit(1);
}
if (meta.hasIndexingErrors) {
  // A fixture captured from a subgraph reporting mapping failures would enshrine wrong data
  // in the test suite, which is worse than having no fixture.
  console.log('FAIL subgraph reports hasIndexingErrors; not capturing untrustworthy data');
  process.exit(1);
}

const block = meta.block.number;
const name = label ? `snapshot-${label}.json` : `snapshot-${block}.json`;
const file = path.join('fixtures', name);
fs.mkdirSync('fixtures', { recursive: true });

// The raw body, plus provenance. The `data` field is byte-for-byte what graph-node returned.
fs.writeFileSync(
  file,
  `${JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      network,
      subgraphUrl,
      deployment: meta.deployment,
      block,
      timestamp: meta.block.timestamp,
      data: body.data,
    },
    null,
    2
  )}\n`
);

const intents = body.data.intents?.length ?? 0;
const tickets = body.data.tickets?.length ?? 0;
console.log(`captured ${file}`);
console.log(`  block ${block} · ${intents} live intents · ${tickets} escrowed unredeemed tickets`);
if (!intents) {
  console.log('  NOTE the pool is empty at this block; seed the demo before capturing a useful fixture');
}
