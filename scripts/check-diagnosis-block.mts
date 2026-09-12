// Read-only live acceptance for Step 7-A / D. Calls the real API handlers and records their
// unmodified outbound Graph/RPC reads; no private environment files or model calls are used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadDeployment } from './lib/deployment.mjs';
import { json } from './lib/graph-acceptance.mjs';
import { numberToHex, type Hex, type Address } from 'viem';

const d = loadDeployment('arc-testnet');
process.env.SUBGRAPH_URL = d.raw.subgraphUrl;
process.env.SUBGRAPH_API_KEY = '';
process.env.ARC_RPC = d.rpc;
process.env.ARC_CHAIN_ID = String(d.chainId);
process.env.NEXT_PUBLIC_DEPLOYMENT = 'arc-testnet';
process.env.ANTHROPIC_API_KEY = '';
const { GET } = await import('../app/api/agent/diagnose/[hash]/route.js');
const { POST } = await import('../app/api/agent/ask/route.js');
const { getIntentById, SubgraphHistoryUnavailable } = await import('../shared/graph/index.js');
const { readCapacity, SnapshotCapacityReadError } = await import('../server/solve-hypothetical.js');
const budget = JSON.parse(fs.readFileSync('docs/checks/graph-budget/summary.json', 'utf8'));
const { oldHash, newHash, commitBlock } = budget.change;
type Trace = { kind: 'rpc' | 'graph'; method?: string; params?: unknown[]; query?: string; variables?: Record<string, unknown>; response?: unknown; httpStatus: number };
const records: { name: string; block: string; evidence: unknown; reads: Trace[] }[] = [];
const originalFetch = globalThis.fetch;
let status = 'FAILED';
let trace: Trace[] = [];
globalThis.fetch = (async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const body = JSON.parse(await request.text());
  const rpc = url.origin === new URL(d.rpc).origin;
  assert.ok(rpc || url.href === d.raw.subgraphUrl, 'Unexpected outbound endpoint');
  if (rpc) assert.equal(body.method, 'eth_call', 'This acceptance permits contract reads only');
  else assert.match(body.query, /^\s*query\s/);
  const response = await originalFetch(input, init);
  const returned = await response.clone().json();
  trace.push(rpc
    ? { kind: 'rpc', method: body.method, params: body.params, response: returned, httpStatus: response.status }
    : { kind: 'graph', query: body.query, variables: body.variables, response: { _meta: returned.data?._meta, intent: returned.data?.intent, errors: returned.errors }, httpStatus: response.status });
  return response;
}) as typeof fetch;

function assertReadsAt(block: string, wantsCapacity: boolean, wantsClosedLookup: boolean) {
  const graph = trace.filter(r => r.kind === 'graph');
  const rpc = trace.filter(r => r.kind === 'rpc');
  const pool = graph.filter(r => r.query?.includes('query PoolSnapshot'));
  assert.equal(pool.length, 1, 'One pool snapshot per API request');
  for (const r of pool) {
    const data = r.response as { _meta: { block: { number: number }; hasIndexingErrors: boolean } };
    assert.equal(String(data._meta.block.number), block);
    assert.equal(data._meta.hasIndexingErrors, false);
  }
  if (wantsCapacity) assert.ok(rpc.length > 0 && rpc.length % 2 === 0, 'Both balance and allowance must be read');
  else assert.equal(rpc.length, 0);
  for (const r of rpc) assert.equal(r.params?.[1], numberToHex(BigInt(block)));
  const lookup = graph.filter(r => r.query?.includes('query IntentById'));
  assert.equal(lookup.length, wantsClosedLookup ? 1 : 0);
  for (const r of lookup) {
    assert.equal(String(r.variables?.block), block);
    assert.equal((r.query?.match(/number: \$block/g) ?? []).length, 2);
  }
}

try {
  for (const [name, hash, ask] of [
    ['live diagnosis', newHash, false],
    ['no-model question', newHash, true],
    ['revoked diagnosis', oldHash, false],
  ] as const) {
    trace = [];
    const response = ask
      ? await POST(new Request('http://localhost/api/agent/ask', { method: 'POST', body: JSON.stringify({ intentHash: hash, question: "Why can't this intent settle?", minBlock: commitBlock }) }))
      : await GET(new Request(`http://localhost/api/agent/diagnose/${hash}?minBlock=${commitBlock}`), { params: Promise.resolve({ hash }) });
    const result = await response.json();
    assert.equal(response.status, 200, `${name}: ${result.error ?? response.status}`);
    const diagnosis = ask ? result.evidence[0].output : result;
    assert.equal(diagnosis.intent, hash);
    assert.ok(BigInt(result.block) >= BigInt(commitBlock));
    if (ask) {
      assert.equal(result.model, null);
      assert.equal(result.block, diagnosis.block);
      assert.ok(result.answer.startsWith(`At Arc Testnet block #${result.block}`));
    }
    if (hash === oldHash) {
      assert.equal(diagnosis.status, 'CLOSED');
      assert.equal(diagnosis.closed.state, 'REVOKED');
      assert.equal(diagnosis.closed.tx, budget.change.revokeTx);
    } else assert.ok(['SETTLEABLE', 'NOT_FOUND_WITHIN_BOUND'].includes(diagnosis.status));
    assertReadsAt(result.block, hash !== oldHash, hash === oldHash);
    records.push({ name, block: result.block, evidence: result, reads: trace });
    console.log(`PASS ${name} @ block ${result.block}: ${trace.filter(r => r.kind === 'rpc').length} RPC reads, all at this exact block.`);
  }

  // Replay a known real revocation boundary without creating another transaction.
  const revokeBlock = BigInt(budget.receipts[0].blockNumber);
  for (const [block, expected] of [[revokeBlock - 1n, 'LIVE'], [revokeBlock, 'REVOKED']] as const) {
    trace = [];
    let result;
    try {
      result = await getIntentById(oldHash as Hex, { block, deployment: d.raw.subgraphDeployment });
    } catch (error) {
      if (!(error instanceof SubgraphHistoryUnavailable)) throw error;
      assert.equal(trace.length, 1);
      assert.equal(trace[0].variables?.block, Number(block));
      records.push({ name: 'pruned Graph history refused', block: String(block), evidence: { error: error.name, oldestAvailableBlock: String(error.oldestAvailableBlock), pastStateNotReconstructed: true }, reads: trace });
      console.log(`PASS pruned history @ ${block}: ${error.name}; no newer state substituted.`);
      continue;
    }
    assert.equal(result?.state, expected);
    assert.equal(trace.length, 1);
    assert.equal(trace[0].variables?.block, Number(block));
    records.push({ name: `historical intent ${expected}`, block: String(block), evidence: result, reads: trace });
    console.log(`PASS real historical lookup @ ${block}: ${expected}.`);
  }
  trace = [];
  const historicalBlock = BigInt(budget.beforeBlock);
  try {
    const funds = await readCapacity([d.deployer as Address], historicalBlock);
    assert.equal(funds.block, historicalBlock);
    assert.equal(trace.length, 2);
    records.push({ name: 'historical USDC capacity', block: String(funds.block), evidence: { balances: [...funds.usdcBalance], allowances: [...funds.usdcAllowance] }, reads: trace });
    console.log(`PASS real historical USDC balance and allowance @ ${historicalBlock}.`);
  } catch (error) {
    if (!(error instanceof SnapshotCapacityReadError)) throw error;
    records.push({ name: 'unavailable historical USDC refused', block: String(historicalBlock), evidence: { error: error.name }, reads: trace });
    console.log(`Historical USDC unavailable @ ${historicalBlock}; rejected without substituting latest.`);
  }
  for (const r of trace) assert.equal(r.params?.[1], numberToHex(historicalBlock));
  status = 'PASS';
} finally {
  globalThis.fetch = originalFetch;
  fs.writeFileSync('docs/checks/graph-diagnosis-block.json', json({ checkedAt: new Date().toISOString(), status, invocation: 'API route handlers with real outbound Graph/RPC requests', chainId: d.chainId, endpoint: d.raw.subgraphUrl, rpc: d.rpc, mocked: false, transactionsSent: 0, modelConfigured: false, records }));
}
