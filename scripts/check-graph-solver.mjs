// Step 6-C: real HTTP requests against an isolated production server, Graph discovery and
// chain simulation only. Build first. No settlement, signing, or model endpoint is called.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { loadDeployment } from './lib/deployment.mjs';
import { json, queryGraph, verifySolveEvidence } from './lib/graph-acceptance.mjs';

const d = loadDeployment('arc-testnet');
assert.ok(fs.existsSync('.next/BUILD_ID'), 'Run npm run build first');
const sampleFile = 'docs/checks/graph-transfer-10.json';
const sample = fs.existsSync(sampleFile) ? JSON.parse(fs.readFileSync(sampleFile, 'utf8')) : null;
const meta = await queryGraph(d.subgraphUrl, '{ _meta { block { number } hasIndexingErrors } }');
assert.equal(meta.data?._meta.hasIndexingErrors, false);
const floor = BigInt(sample?.blockNumber ?? meta.data._meta.block.number);
const probe = net.createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close(e => e ? reject(e) : resolve()));
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, READ_SOURCE: 'graph', SUBGRAPH_URL: d.subgraphUrl, ARC_RPC: d.rpc, ARC_CHAIN_ID: String(d.chainId), NEXT_PUBLIC_DEPLOYMENT: 'arc-testnet', ANTHROPIC_API_KEY: '' },
});
const exited = once(child, 'exit');
let output = '';
child.stdout.on('data', b => { output += b.toString(); });
child.stderr.on('data', b => { output += b.toString(); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const records = [];
try {
  const started = performance.now();
  while (!output.includes('Ready in')) {
    if (child.exitCode !== null) throw new Error('Isolated server exited before readiness');
    if (performance.now() - started > 30000) throw new Error('Isolated server readiness timeout');
    await sleep(100);
  }
  fs.mkdirSync('docs/checks', { recursive: true });
  async function solve(path, body, file) {
    console.log(`POST ${path}, minBlock ${floor}; public discovery and simulation only`);
    const startedAt = new Date().toISOString(), startedClock = performance.now();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240000) });
    const evidence = await response.json();
    const record = { startedAt, httpElapsedMs: Math.round(performance.now() - startedClock), request: { method: 'POST', path, body }, httpStatus: response.status, evidence };
    assert.equal(response.status, 200, `${path} HTTP ${response.status}: ${evidence.error ?? 'unexpected response'}`);
    verifySolveEvidence(evidence, floor);
    assert.equal(evidence.chainId, d.chainId);
    assert.equal(evidence.source.subgraphEndpoint, d.subgraphUrl);
    const line = output.split(/\r?\n/).find(l => l.startsWith(`pool source: subgraph @ block ${evidence.snapshotBlock} `));
    assert.ok(line, 'Server log does not corroborate response snapshotBlock');
    records.push(record);
    fs.writeFileSync(file, json(record));
    console.log(json({ file, snapshotBlock: evidence.snapshotBlock, candidatesFound: evidence.candidatesFound, intentsConsidered: evidence.intentsConsidered, runtimeMs: evidence.runtimeMs, httpElapsedMs: record.httpElapsedMs, simulation: evidence.simulationResult }));
    return evidence;
  }
  const pool = await solve('/api/solve/pool', { minBlock: String(floor) }, 'docs/checks/graph-solve-pool.json');
  await solve('/api/solve', { minBlock: String(floor), intentHashes: pool.proposal.legs.map(leg => leg.intentHash) }, 'docs/checks/graph-solve-selected.json');
  // A real negative HTTP check: a future floor must wait instead of returning an older pool.
  const future = String(BigInt(pool.snapshotBlock) + 100000n);
  const lag = await fetch(`http://127.0.0.1:${port}/api/solve/pool`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ minBlock: future }), signal: AbortSignal.timeout(30000) });
  assert.equal(lag.status, 409, 'Unmet floor must return 409');
  fs.writeFileSync('docs/checks/graph-solve-lag.json', json({ checkedAt: new Date().toISOString(), request: { path: '/api/solve/pool', minBlock: future }, httpStatus: lag.status, response: await lag.json() }));
  fs.writeFileSync('docs/checks/graph-solver-server.txt', output.split(/\r?\n/).filter(line => line.startsWith('pool source: subgraph @ block ')).join('\n') + '\n');
  console.log(`PASS: ${records.length} Graph solve responses, matching source logs, successful simulations, and HTTP 409 for an unmet floor. No transaction broadcast.`);
} finally {
  if (child.exitCode === null) { child.kill(); await exited; }
}
