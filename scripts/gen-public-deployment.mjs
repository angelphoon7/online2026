// Derive the browser-facing slice of each deployment record.
//
//   node scripts/gen-public-deployment.mjs [network...]
//
// deployments/<network>.json is the source of truth, but it also carries the deploy journal
// and the demo seed (participant addresses, intents, tickets) — around 12 KB the browser has
// no use for. Importing the record directly into client code ships all of it: JSON modules
// are not tree-shaken, not even through named imports (verified by grepping .next/static for
// a seed account after a build).
//
// So the client reads deployments/public/<network>.json, generated here and kept in sync by
// scripts/check-deployment-config.mjs. Generated, never hand-edited.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadDeployment, CONTRACT_NAMES } from './lib/deployment.mjs';

export const PUBLIC_DIR = path.join('deployments', 'public');

/** The fields the frontend needs, and nothing else. */
export function publicRecord(deployment) {
  return {
    _generated: 'scripts/gen-public-deployment.mjs — do not edit by hand',
    network: deployment.network,
    chainId: deployment.chainId,
    rpc: deployment.rpc,
    // Left empty in the record until `graph deploy`; SUBGRAPH_URL overrides at runtime.
    subgraphUrl: deployment.raw.subgraphUrl ?? '',
    usdc: deployment.usdc,
    contracts: Object.fromEntries(
      CONTRACT_NAMES.map((name) => [name, deployment.contracts[name].address])
    ),
    startBlock: String(deployment.startBlock),
  };
}

export const serialise = (record) => JSON.stringify(record, null, 2) + '\n';

export function publicPath(network) {
  return path.join(PUBLIC_DIR, `${network}.json`);
}

// Only write when run directly, so the check script can import publicRecord() to compare.
// pathToFileURL, not string surgery: this path contains a space, which must be percent-encoded
// to match import.meta.url on Windows.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const networks = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const targets = networks.length > 0 ? networks : ['arc-testnet', 'local'];
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  for (const network of targets) {
    const record = publicRecord(loadDeployment(network));
    fs.writeFileSync(publicPath(network), serialise(record));
    console.log(`wrote ${publicPath(network)}`);
  }
}
