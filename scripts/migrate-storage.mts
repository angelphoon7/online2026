import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadEnvFile } from 'node:process';
for (const file of ['.env.local', '.env']) if (fs.existsSync(file)) loadEnvFile(file);
const { durableStore, encodeRecord, storageMode } = await import('../server/durable-store.js');
const { privateKeyToAccount } = await import('viem/accounts');
const { DEPLOYMENT } = await import('../lib/deployment.js');
const apply = process.argv[2] === '--apply';
if (process.argv.length > 3 || process.argv[2] && !['--check', '--apply'].includes(process.argv[2])) throw new Error('Use npm run storage:migrate -- --check|--apply (stop local and hosted writers first).');
const rows = new Map<string, { value: string; expires: number | null }>();
const add = (key: string, value: unknown, expires: number | null = null) => { if (!rows.has(key)) rows.set(key, { value: encodeRecord(value), expires }); };
const shared = resolve(process.env.STORAGE_DIRECTORY ?? '.data/shared', process.env.STORAGE_NAMESPACE ?? 'reshuffle-arc-testnet');
if (fs.existsSync(join(shared, 'mutation.lock')) || fs.existsSync('.data/demo-tickets/issuer.lock')) throw new Error('Local writers are locked. Stop and reconcile them before migrating.');
for (const name of fs.existsSync(shared) ? fs.readdirSync(shared) : []) {
  if (!name.endsWith('.json')) continue;
  const record = JSON.parse(fs.readFileSync(join(shared, name), 'utf8'));
  if (typeof record.key !== 'string' || name !== createHash('sha256').update(record.key).digest('hex') + '.json') throw new Error('Unrecognized local storage record; migration stopped.');
  if (record.expires !== null && record.expires <= Date.now()) continue;
  if (record.key.startsWith('signing:lease:')) throw new Error('A signing lease exists. Wait for the worker to finish and release it before migrating.');
  rows.set(record.key, { value: record.value, expires: record.expires });
}
for (const name of fs.existsSync('.data/evidence') ? fs.readdirSync('.data/evidence') : []) {
  if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
  const value = JSON.parse(fs.readFileSync(join('.data/evidence', name), 'utf8'));
  if (value.id + '.json' !== name) throw new Error('Legacy evidence ID mismatch');
  add('evidence:' + value.id, value);
}
const legacy = '.data/demo-tickets/' + DEPLOYMENT.ticketNFT + '.json';
if (fs.existsSync(legacy)) {
  const claims = JSON.parse(fs.readFileSync(legacy, 'utf8')).claims;
  for (const [owner, plan] of Object.entries(claims) as [string, { mints: { raw: string; hash: string; tokenId?: string }[] }][]) {
    const id = 'claim:' + DEPLOYMENT.ticketNFT + ':' + owner.toLowerCase();
    if (rows.has('signing:job:' + id)) continue;
    const completed = plan.mints.length === 2 && plan.mints.every(m => m.tokenId !== undefined);
    add('signing:job:' + id, { plan, steps: Object.fromEntries(plan.mints.map((m, i) => ['mint-' + i, { raw: m.raw, hash: m.hash }])), ...(completed ? { result: { tokenIds: plan.mints.map(m => m.tokenId), hashes: plan.mints.map(m => m.hash) } } : {}) });
    if (!completed && plan.mints.length) {
      const key = process.env.DEMO_ISSUER_PRIVATE_KEY || process.env.PRIVATE_KEY;
      if (!key || !/^0x[0-9a-f]{64}$/i.test(key)) throw new Error('A pending legacy claim needs the original issuer key to preserve its signer reservation.');
      const account = privateKeyToAccount(key as `0x${string}`);
      const reservation = `signing:active:${DEPLOYMENT.chainId}:${account.address.toLowerCase()}`;
      if (rows.has(reservation) && rows.get(reservation)!.value !== id) throw new Error('Conflicting pending issuer operations; reconcile before migrating.');
      // Reservations are plain strings, not JSON records.
      rows.set(reservation, { value: id, expires: null });
    }
  }
}
if (apply) {
  if (storageMode() !== 'redis') throw new Error('Configure target Redis REST storage before applying migration.');
  const store = durableStore();
  for (const [key, row] of rows) {
    const previous = await store.get(key);
    if (previous === row.value) continue;
    if (previous !== null) throw new Error('Target data conflicts with local data; no existing record was overwritten. Stop writers and reconcile the two stores.');
    const ttlMs = row.expires === null ? undefined : row.expires - Date.now();
    if (ttlMs !== undefined && ttlMs <= 0) continue;
    if (!await store.compareAndSet(key, null, row.value, { ttlMs })) throw new Error('Concurrent target update; migration stopped.');
  }
}
console.log(JSON.stringify({ applied: apply, records: rows.size, source: 'local evidence, claims and shared records', localFilesDeleted: false }));
