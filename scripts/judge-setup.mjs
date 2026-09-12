import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { loadEnvFile } from 'node:process';
const manifest = process.argv[2] ?? 'deployments/circle-inventory-sep12.json';
if (process.argv.length > 3) throw new Error('Use npm run judge:setup -- deployments/circle-inventory-BATCH.json');
for (const file of ['.env.local', '.env']) if (fs.existsSync(file)) loadEnvFile(file);
const demo = JSON.parse(fs.readFileSync(manifest, 'utf8'));
if (demo.chainId !== 5042002 || !demo.groups?.length) throw new Error('Use an Arc Testnet circle inventory manifest.');
const hashes = demo.groups.flatMap(g => g.intents.map(i => i.hash));
if (hashes.some(h => !/^0x[0-9a-f]{64}$/i.test(h))) throw new Error('Invalid intent hashes');
const settings = {
  JUDGE_ACCESS_CODE: process.env.JUDGE_ACCESS_CODE || randomBytes(24).toString('hex'),
  JUDGE_ALLOWED_INTENT_HASHES: process.env.JUDGE_ALLOWED_INTENT_HASHES || hashes.join(','),
  JUDGE_CONTROLS_ENABLED: process.env.JUDGE_CONTROLS_ENABLED || 'true',
  DEMO_TICKETS_ENABLED: process.env.DEMO_TICKETS_ENABLED || 'true',
};
const existing = fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8') : '';
const additions = Object.entries(settings).filter(([key]) => !new RegExp('^\\s*' + key + '\\s*=', 'm').test(existing)).map(([key, value]) => key + '=' + value);
if (additions.length) fs.appendFileSync('.env.local', '\n# Private judging access; generated without changing existing settings.\n' + additions.join('\n') + '\n', { mode: 0o600 });
console.log('Judging settings are in ignored .env.local. Existing settings were preserved. Restart the app. Share JUDGE_ACCESS_CODE privately with judges; never share wallet keys.');
console.log('This does not host the backend or configure Redis. Follow docs/JUDGING_SETUP.md for shared storage and readiness checks.');
