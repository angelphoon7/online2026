import fs from 'node:fs';
import path from 'node:path';
import { checkHosted } from './lib/hosted-check.mjs';

const [origin, ...args] = process.argv.slice(2);
if (!origin || args.some(arg => arg !== '--model')) throw new Error('Use npm run submission:check:hosted -- https://YOUR-APP [--model]');
const report = await checkHosted(origin, { model: args.includes('--model') });
const output = 'docs/checks/hosted-acceptance.json';
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(`${report.status}: ${report.origin}; ${report.checks.length} HTTP checks. See ${output}.`);
if (report.error) console.error(report.error);
if (report.status !== 'PASS_PUBLIC_HTTP') process.exitCode = 1;
