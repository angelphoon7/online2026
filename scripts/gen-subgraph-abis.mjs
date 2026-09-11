// Extract plain ABI arrays from Foundry artifacts for graph-cli.
//
//   node scripts/gen-subgraph-abis.mjs
//
// Foundry writes out/<Name>.sol/<Name>.json as an object with the ABI under `.abi`;
// graph-cli wants the bare array. Re-run after any contract change, then `graph codegen`.

import fs from 'node:fs';
import path from 'node:path';
import { CONTRACT_NAMES } from './lib/deployment.mjs';

const OUT_DIR = path.join('subgraph', 'abis');
fs.mkdirSync(OUT_DIR, { recursive: true });

for (const name of CONTRACT_NAMES) {
  const artifact = path.join('out', `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(artifact)) throw new Error(`Missing ${artifact} — run \`forge build\` first`);
  const { abi } = JSON.parse(fs.readFileSync(artifact, 'utf8'));
  if (!Array.isArray(abi)) throw new Error(`${artifact} has no abi array`);
  const events = abi.filter((e) => e.type === 'event').map((e) => e.name);
  fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), JSON.stringify(abi, null, 2) + '\n');
  console.log(`${name.padEnd(15)} ${String(abi.length).padStart(3)} entries, events: ${events.join(', ')}`);
}
