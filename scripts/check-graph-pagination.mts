// Read-only acceptance against the configured Studio endpoint. Never signs or submits.
import { existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { getPoolSnapshot } from '../shared/graph/snapshot';
import { marketSnapshotFromGraph } from '../server/market-graph';

if (existsSync('.env')) loadEnvFile('.env');
const pageSize = Number(process.argv[2] ?? 50);
const trace: { query: string; block: number; hash: string; deployment: string; counts: Record<string, number> }[] = [];
const upstream = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const response = await upstream(input, init);
  const body = await response.clone().json();
  if (body.data?._meta) {
    const request = JSON.parse(init!.body as string), data = body.data;
    trace.push({ query: request.query.includes('query PoolSnapshot') ? 'pool' : 'market',
      block: data._meta.block.number, hash: data._meta.block.hash, deployment: data._meta.deployment,
      counts: Object.fromEntries(['intents', 'tickets', 'settlements'].filter(k => Array.isArray(data[k])).map(k => [k, data[k].length])) });
  }
  return response;
};

const record: Record<string, unknown> = { checkedAt: new Date().toISOString(), pageSize, transactionsSent: 0, modelRequests: 0 };
try {
  const pool = await getPoolSnapshot({ pageSize });
  const market = await marketSnapshotFromGraph(pool.block, { pageSize });
  record.status = 'PASS';
  record.pool = { block: String(pool.block), liveIntents: pool.intents.length, excluded: pool.excluded.length, tickets: pool.ticketMeta.size };
  record.market = { block: market.blockNumber, intents: market.intents.length, tickets: market.tickets.length, settlements: market.settlements.length, hashMismatches: market.hashMismatched?.length ?? 0 };
  record.multiPageObserved = ['pool', 'market'].every(kind => trace.filter(t => t.query === kind).length > 1);
} catch (error) {
  record.status = 'FAIL';
  record.error = error instanceof Error ? error.name : 'UnknownError';
  process.exitCode = 1;
} finally {
  globalThis.fetch = upstream;
  record.pages = trace;
  await mkdir('docs/checks', { recursive: true });
  await writeFile('docs/checks/graph-pagination-live.json', `${JSON.stringify(record, null, 2)}\n`);
  // Endpoint, auth headers and all credentials are intentionally absent from the record.
  console.log(JSON.stringify(record, null, 2));
}
