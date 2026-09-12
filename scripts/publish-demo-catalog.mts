import fs from 'node:fs';
import { loadEnvFile } from 'node:process';
for (const file of ['.env.local', '.env']) if (fs.existsSync(file)) loadEnvFile(file);
const { catalogKey, validateCatalog, describeGroups } = await import('../server/judging-demo.js');
const { getPoolSnapshot } = await import('../shared/graph/index.js');
const { chainConfig } = await import('../server/chain.js');
const { durableStore, encodeRecord } = await import('../server/durable-store.js');
const manifest = process.argv[2], publish = process.argv[3] === '--publish';
if (!manifest || process.argv.length > 4 || process.argv[3] && !publish) throw new Error('Use npm run demo:catalog -- deployments/circle-inventory-BATCH.json [--publish]');
const raw = JSON.parse(fs.readFileSync(manifest, 'utf8'));
const catalog = validateCatalog({ batch: raw.batch, chainId: raw.chainId, registry: raw.contracts.IntentRegistry, groups: raw.groups.map((g: { name: string; intents: { hash: string }[] }) => ({ name: g.name, hashes: g.intents.map(i => i.hash) })) });
const [snapshot, block] = await Promise.all([getPoolSnapshot(), chainConfig().client.getBlock()]);
const groups = describeGroups(catalog, snapshot, block.timestamp);
if (groups.some(g => !g.available)) throw new Error('The manifest includes unavailable demo groups. Prepare fresh on-chain requests before publishing.');
if (publish) {
  const store = durableStore(), previous = await store.get(catalogKey);
  if (!await store.compareAndSet(catalogKey, previous, encodeRecord(catalog))) throw new Error('Catalog changed concurrently; check again.');
}
console.log(JSON.stringify({ published: publish, batch: catalog.batch, snapshotBlock: String(snapshot.block), groups: groups.map(g => g.name) }, null, 2));
console.log('Update JUDGE_ALLOWED_INTENT_HASHES to the fresh group hashes if judges should edit them. Run judge:check before sharing the demo.');
