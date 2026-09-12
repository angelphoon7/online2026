// Measure how far the subgraph trails the Arc chain head.
//
//   node scripts/measure-subgraph-lag.mjs [--samples N] [--interval MS]
//
// Plan 4-A calls for a MEASURED indexing delay, not an estimate — it sets the pacing of the
// demo (how long "Indexing block #M…" is on screen) and it is the only honest source for any
// latency figure in the README.
//
// Method: sample the chain head and the subgraph's indexed block together, repeatedly. Reported
// as both a block gap and a seconds estimate derived from the observed block time — the gap is
// directly measured, the seconds are inferred from it, and they are labelled separately so the
// two are not confused.
//
// This measures steady-state trailing distance. It is not the same as the round-trip after a
// specific transaction; the two agree only when graph-node is keeping up, which the
// `caught up` line reports.

import fs from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createPublicClient, http } from 'viem';
import { loadDeployment, deploymentName } from './lib/deployment.mjs';

if (fs.existsSync('.env')) loadEnvFile('.env');

const args = process.argv.slice(2);
const numberFlag = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? Number(args[index + 1]) : fallback;
};
const samples = numberFlag('--samples', 10);
const interval = numberFlag('--interval', 3000);

const deployment = loadDeployment(deploymentName(args.find((a) => !a.startsWith('--') && Number.isNaN(Number(a)))));
const subgraphUrl = process.env.SUBGRAPH_URL || deployment.subgraphUrl;
if (!subgraphUrl) {
  console.log('FAIL no subgraphUrl — deploy first');
  process.exit(1);
}

const client = createPublicClient({ transport: http(process.env.ARC_RPC ?? deployment.rpc, { timeout: 20000 }) });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function indexedBlock() {
  const response = await fetch(subgraphUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{ _meta { block { number timestamp } hasIndexingErrors } }' }),
  });
  const body = await response.json();
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data._meta;
}

console.log(`subgraph ${subgraphUrl}`);
console.log(`rpc      ${process.env.ARC_RPC ?? deployment.rpc}`);
console.log(`sampling ${samples} times at ${interval}ms\n`);
console.log('  sample   chain head   indexed      gap   wall ms');

const gaps = [];
const observations = [];
for (let i = 1; i <= samples; i++) {
  const started = Date.now();
  // Subgraph first, then the head, so ordering cannot understate the gap.
  //
  // A NEGATIVE gap is still possible and is not the subgraph running ahead of the chain: Arc's
  // public RPC is load balanced and its reported head can itself be a few blocks stale. That
  // matters beyond this script — waitForIndexed() compares the subgraph against a block number
  // that came from the same RPC, so the target can briefly look already-indexed.
  const meta = await indexedBlock();
  const head = await client.getBlockNumber();
  const elapsed = Date.now() - started;

  const indexed = BigInt(meta.block.number);
  const gap = Number(head - indexed);
  gaps.push(gap);
  observations.push({ at: Date.now(), head, indexed, timestamp: Number(meta.block.timestamp) });

  console.log(
    `  ${String(i).padStart(6)}   ${String(head).padStart(10)}   ${String(indexed).padStart(9)}   ${String(gap).padStart(6)}   ${String(elapsed).padStart(7)}`
  );
  if (meta.hasIndexingErrors) console.log('       hasIndexingErrors=true');
  if (i < samples) await sleep(interval);
}

// Observed block time, from how far the head moved over the sampling window.
const first = observations[0];
const last = observations[observations.length - 1];
const wallSeconds = (last.at - first.at) / 1000;
const headBlocks = Number(last.head - first.head);
const blockTime = headBlocks > 0 ? wallSeconds / headBlocks : null;

const sorted = [...gaps].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;

console.log('\nmeasured over', `${wallSeconds.toFixed(1)}s`, `(${headBlocks} blocks of chain head movement)`);
console.log(`  gap blocks     min ${sorted[0]}  median ${median}  mean ${mean.toFixed(1)}  max ${sorted[sorted.length - 1]}`);
if (blockTime) {
  console.log(`  block time     ${blockTime.toFixed(2)}s  (observed, not a published constant)`);
  console.log(`  gap seconds    median ≈ ${(median * blockTime).toFixed(1)}s  max ≈ ${(sorted[sorted.length - 1] * blockTime).toFixed(1)}s  (inferred from the gap)`);
}
// Rising gap means graph-node is falling behind; a flat gap means it is keeping pace.
const indexedBlocks = Number(last.indexed - first.indexed);
console.log(`  caught up      indexed advanced ${indexedBlocks} blocks while the head advanced ${headBlocks}` +
  (headBlocks > 0 && indexedBlocks >= headBlocks * 0.95 ? ' — keeping pace' : ' — FALLING BEHIND'));
console.log('\nUse the median for demo pacing; quote the max as the worst case observed.');
