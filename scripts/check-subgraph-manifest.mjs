// Verify the subgraph manifest against the ABIs and the deployment record.
//
//   node scripts/check-subgraph-manifest.mjs [network]
//
// Three ways this manifest breaks silently, all of them checked here:
//
//   1. An event signature in subgraph.yaml does not match the ABI. graph-cli accepts the
//      manifest and the subgraph deploys; the handler simply never fires, and the entity is
//      quietly absent. Both real signatures in this project are easy to get wrong: the event
//      is TicketRedeemedEvt (TicketRedeemed is a Settlement *error*), and Settled takes three
//      parameters, not two. See docs/graph-audit.txt.
//   2. A networks.json key does not match a dataSource `name`. graph-cli matches them by
//      string, so a mismatch leaves the placeholder address in place and the subgraph indexes
//      the zero address.
//   3. The manifest addresses drift from deployments/<network>.json after a redeploy.
//
// Exit 0 = PASS.

import fs from 'node:fs';
import path from 'node:path';
import { loadDeployment, deploymentName, sameAddress } from './lib/deployment.mjs';

const args = process.argv.slice(2);
const deployment = loadDeployment(deploymentName(args.find((a) => !a.startsWith('--'))));

const SUBGRAPH_DIR = 'subgraph';
const manifestPath = path.join(SUBGRAPH_DIR, 'subgraph.yaml');
const networksPath = path.join(SUBGRAPH_DIR, 'networks.json');

let pass = 0;
const failures = [];
const check = (ok, message) => (ok ? pass++ : failures.push(message));

if (!fs.existsSync(manifestPath)) {
  console.log(`FAIL ${manifestPath} missing — run: npm run subgraph:config`);
  process.exit(1);
}

// Minimal YAML reading: this manifest is machine-generated with a known shape, so parsing the
// few fields we care about by regex avoids adding a YAML dependency to the repo root.
const manifest = fs.readFileSync(manifestPath, 'utf8');

/** Split the manifest into one chunk per dataSource. */
function dataSources(text) {
  const chunks = text.split(/^\s*-\s+kind:\s*ethereum\/contract\s*$/m).slice(1);
  return chunks.map((chunk) => {
    const field = (name) => {
      const m = chunk.match(new RegExp(`^\\s*${name}:\\s*["']?([^"'\\n]+)["']?\\s*$`, 'm'));
      return m ? m[1].trim() : null;
    };
    // Event signatures may be wrapped across lines by the YAML writer; rejoin them.
    const events = [];
    const eventBlock = /- event:\s*([\s\S]*?)\n\s*handler:\s*(\w+)/g;
    let m;
    while ((m = eventBlock.exec(chunk)) !== null) {
      events.push({ signature: m[1].replace(/\s+/g, ''), handler: m[2] });
    }
    return {
      name: field('name'),
      network: field('network'),
      address: field('address'),
      startBlock: field('startBlock'),
      abiName: field('abi'),
      // A dataSource has two `file:` keys — the ABI under abis[], and the mapping. Pick the
      // mapping by extension rather than by position.
      file: (chunk.match(/^\s*file:\s*(\S+\.ts)\s*$/m) ?? [])[1] ?? null,
      events,
    };
  });
}

/** Render an ABI event the way graph-cli writes signatures: Name(indexed type,type). */
function abiSignature(event) {
  const params = event.inputs
    .map((input) => `${input.indexed ? 'indexed ' : ''}${input.type}`)
    .join(',');
  return `${event.name}(${params})`.replace(/\s+/g, '');
}

const sources = dataSources(manifest);
check(sources.length > 0, 'no ethereum/contract dataSources found in the manifest');

const networks = fs.existsSync(networksPath) ? JSON.parse(fs.readFileSync(networksPath, 'utf8')) : null;
check(networks !== null, `${networksPath} missing — run: npm run subgraph:config`);
const networkEntry = networks ? networks[deployment.network] : null;
check(
  networkEntry != null,
  `${networksPath} has no entry for "${deployment.network}" (found: ${networks ? Object.keys(networks).join(', ') : 'none'})`
);

console.log(`manifest ${manifestPath} — ${sources.length} dataSources, network ${deployment.network}`);

for (const source of sources) {
  const label = source.name ?? '(unnamed)';

  // 1. network name
  check(
    source.network === deployment.network,
    `${label}: manifest network "${source.network}" != "${deployment.network}"`
  );

  // 2. networks.json key matches the dataSource name exactly
  if (networkEntry) {
    const entry = networkEntry[label];
    check(entry != null, `${label}: no networks.json key with this exact name`);
    if (entry) {
      check(
        sameAddress(entry.address, source.address),
        `${label}: networks.json address ${entry.address} != manifest ${source.address}`
      );
      check(
        String(entry.startBlock) === String(source.startBlock),
        `${label}: networks.json startBlock ${entry.startBlock} != manifest ${source.startBlock}`
      );
    }
  }

  // 3. the manifest still agrees with the deployment record
  const recorded = deployment.contracts[label];
  if (recorded) {
    check(
      sameAddress(source.address, recorded.address),
      `${label}: manifest address ${source.address} != ${deployment.file} ${recorded.address}`
    );
    check(
      String(source.startBlock) === String(recorded.startBlock),
      `${label}: manifest startBlock ${source.startBlock} != record ${recorded.startBlock}`
    );
  } else {
    check(false, `${label}: no contract of this name in ${deployment.file}`);
  }

  // 4. never ship the placeholder
  check(
    !/^0x0{40}$/i.test(source.address ?? ''),
    `${label}: address is still the zero placeholder — run: npm run subgraph:config`
  );

  // 5. every handler's event signature exists in the ABI
  const abiPath = path.join(SUBGRAPH_DIR, 'abis', `${source.abiName}.json`);
  if (!fs.existsSync(abiPath)) {
    check(false, `${label}: ${abiPath} missing — run: npm run subgraph:abis`);
    continue;
  }
  const abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
  const available = abi.filter((e) => e.type === 'event').map(abiSignature);
  for (const { signature, handler } of source.events) {
    check(
      available.includes(signature),
      `${label}: handler ${handler} listens for ${signature}, which is not in ${source.abiName}.json.\n` +
        `      available: ${available.join(' | ')}`
    );
  }

  // 6. the mapping file exists and exports each handler
  const mappingPath = path.join(SUBGRAPH_DIR, source.file ?? '');
  if (!fs.existsSync(mappingPath)) {
    check(false, `${label}: mapping file ${mappingPath} not found`);
  } else {
    const mapping = fs.readFileSync(mappingPath, 'utf8');
    for (const { handler } of source.events) {
      check(
        new RegExp(`export\\s+function\\s+${handler}\\s*\\(`).test(mapping),
        `${label}: ${mappingPath} does not export ${handler}()`
      );
    }
  }

  console.log(
    `  ${label.padEnd(15)} ${source.address}  block ${source.startBlock}  ` +
      `${source.events.length} handler${source.events.length === 1 ? '' : 's'}`
  );
  for (const { signature, handler } of source.events) {
    console.log(`      ${handler.padEnd(22)} ${signature}`);
  }
}

console.log();
if (failures.length === 0) {
  console.log(`PASS — ${pass} checks, manifest agrees with ABIs and ${deployment.file}`);
  process.exit(0);
}
for (const failure of failures) console.log(`FAIL ${failure}`);
console.log(`\n${pass} pass, ${failures.length} fail`);
process.exit(1);
