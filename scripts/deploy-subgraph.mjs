// Build and deploy the subgraph, then record the endpoint it produced.
//
//   node scripts/deploy-subgraph.mjs <version-label> [network] [--dry-run]
//
// The whole pipeline in one place, because a partial run is the failure mode: the Studio query
// URL is version-pinned (…/reshuffle/v0.1.0), so every deploy mints a NEW endpoint and silently
// invalidates the old one. Two places hold it — .env (runtime) and deployments/<network>.json
// (what the committed public slice carries into the frontend bundle) — and updating only one
// leaves the app querying a stale version that still answers, with old data. So this script
// captures the URL from the deploy output and writes both.
//
// Steps: abis -> manifest/config -> codegen -> build -> deploy -> record URL -> verify _meta.
// No `--network` on build or deploy: that rewrites subgraph.yaml in place and strips its
// comments. Addresses are rendered into the manifest by gen-subgraph-config.mjs instead.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { loadDeployment, deploymentName } from './lib/deployment.mjs';

if (fs.existsSync('.env')) loadEnvFile('.env');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const positional = args.filter((a) => !a.startsWith('--'));
const versionLabel = positional[0];
const network = deploymentName(positional[1]);

if (!versionLabel) {
  console.error('usage: node scripts/deploy-subgraph.mjs <version-label> [network] [--dry-run]');
  console.error('example: node scripts/deploy-subgraph.mjs v0.1.1');
  process.exit(1);
}
if (!/^v\d+\.\d+\.\d+/.test(versionLabel)) {
  console.error(`Refusing version label "${versionLabel}" — use vMAJOR.MINOR.PATCH.`);
  process.exit(1);
}

const deployment = loadDeployment(network);
const SLUG = process.env.SUBGRAPH_SLUG ?? 'reshuffle';

// shell:true is needed on Windows for the npx/node shims, so every argument this script
// passes is a literal it controls — never interpolated user input.
const run = (command, commandArgs, options = {}) =>
  execFileSync(command, commandArgs, { encoding: 'utf8', stdio: 'pipe', shell: true, ...options });

const step = (label) => console.log(`\n── ${label}`);

step(`generate from ${deployment.file}`);
console.log(run('node', ['scripts/gen-subgraph-abis.mjs']).trim());
console.log(run('node', ['scripts/gen-subgraph-config.mjs', network]).trim());

step('verify manifest against ABIs and the deployment record');
// Run before spending a deploy: a wrong event signature deploys cleanly and then never fires.
try {
  console.log(run('node', ['scripts/check-subgraph-manifest.mjs', network]).trim().split('\n').pop());
} catch (error) {
  console.error(error.stdout ?? error.message);
  console.error('\nManifest check failed — not deploying.');
  process.exit(1);
}

step('codegen + build');
run('npx', ['graph', 'codegen'], { cwd: 'subgraph' });
const buildOut = run('npx', ['graph', 'build'], { cwd: 'subgraph' });
console.log(buildOut.trim().split('\n').filter((l) => /Build completed/i.test(l)).join('\n'));

if (dryRun) {
  console.log('\n--dry-run: stopping before deploy. Nothing was published.');
  process.exit(0);
}

step(`deploy ${SLUG} ${versionLabel}`);
let deployOut;
try {
  deployOut = run('npx', ['graph', 'deploy', SLUG, '--version-label', versionLabel], { cwd: 'subgraph' });
} catch (error) {
  console.error(error.stdout ?? '');
  console.error(error.stderr ?? '');
  console.error('\nDeploy failed. Nothing was recorded.');
  process.exit(1);
}

// Strip ANSI colour before matching; graph-cli writes the endpoint with escape codes.
const plain = deployOut.replace(/\[[0-9;]*m/g, '');
const queryUrl = (plain.match(/https:\/\/api\.studio\.thegraph\.com\/query\/\S+/) ?? [])[0];
const ipfsHash = (plain.match(/Build completed:\s*(Qm\S+)/) ?? [])[1];

console.log(plain.trim().split('\n').filter((l) => /Deployed to|Queries|Build completed/i.test(l)).join('\n'));

if (!queryUrl) {
  console.error('\nDeployed, but could not parse the query URL from the output.');
  console.error('Copy it from Studio and set SUBGRAPH_URL in .env and subgraphUrl in the record.');
  process.exit(1);
}

step('record the endpoint');
// .env — runtime.
const envLines = fs.readFileSync('.env', 'utf8').split('\n');
let found = false;
const updated = envLines.map((line) => {
  if (line.split('=')[0].trim() !== 'SUBGRAPH_URL') return line;
  found = true;
  return `SUBGRAPH_URL=${queryUrl}`;
});
if (!found) updated.push(`SUBGRAPH_URL=${queryUrl}`);
fs.writeFileSync('.env', updated.join('\n'));
console.log(`  .env                          SUBGRAPH_URL=${queryUrl}`);

// The deployment record — what the committed public slice carries.
const record = JSON.parse(fs.readFileSync(deployment.file, 'utf8'));
record.subgraphUrl = queryUrl;
if (ipfsHash) record.subgraphDeployment = ipfsHash;
fs.writeFileSync(deployment.file, JSON.stringify(record, null, 2) + '\n');
console.log(`  ${deployment.file}  subgraphUrl + subgraphDeployment`);

console.log(run('node', ['scripts/gen-public-deployment.mjs', network]).trim());

step('verify the endpoint answers');
// Studio needs a moment before a new version serves queries.
const meta = '{ _meta { block { number } hasIndexingErrors deployment } }';
let ok = false;
for (let attempt = 1; attempt <= 10; attempt++) {
  try {
    const response = await fetch(queryUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: meta }),
    });
    const body = await response.json();
    if (body.data?._meta) {
      const { block, hasIndexingErrors, deployment: deployed } = body.data._meta;
      console.log(`  block ${block.number}, hasIndexingErrors=${hasIndexingErrors}, deployment ${deployed}`);
      if (ipfsHash && deployed !== ipfsHash) {
        console.log(`  note: serving ${deployed}, built ${ipfsHash} — Studio may still be switching versions.`);
      }
      ok = true;
      break;
    }
    console.log(`  attempt ${attempt}: ${JSON.stringify(body.errors ?? body).slice(0, 120)}`);
  } catch (error) {
    console.log(`  attempt ${attempt}: ${error.message}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

console.log();
if (!ok) {
  console.log('Deployed and recorded, but the endpoint did not answer yet. Check Studio; it may still be starting.');
  process.exit(1);
}
console.log(`Deployed ${SLUG} ${versionLabel} and recorded the endpoint.`);
console.log('Indexing continues in the background — poll _meta until block catches the chain head.');
