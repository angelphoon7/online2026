// Verify that deployments/<network>.json is the only source of deployed addresses.
//
//   node scripts/check-deployment-config.mjs [network]
//
// Two ways the single source of truth decays, both checked here:
//   1. .env drifts from the deployment record, so the frontend signs against one address
//      while the scripts settle against another. The EIP-712 domain contains
//      verifyingContract, so a stale NEXT_PUBLIC_INTENT_REGISTRY does not fail loudly — it
//      produces signatures that do not recover to the owner, which reads like a wallet bug.
//   2. An address gets hand-copied into source, and the next redeploy misses it.
//
// Exit 0 = PASS. Run after every deployment and before every demo.

import fs from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { loadDeployment, deploymentName, ENV_BY_CONTRACT, sameAddress } from './lib/deployment.mjs';
import { publicRecord, serialise, publicPath } from './gen-public-deployment.mjs';

if (fs.existsSync('.env')) loadEnvFile('.env');

const args = process.argv.slice(2);
const network = args.find((arg) => !arg.startsWith('--'));

let deployment;
try {
  deployment = loadDeployment(deploymentName(network));
} catch (error) {
  console.log(`FAIL ${error.message}`);
  process.exit(1);
}

let pass = 0;
const failures = [];
const check = (ok, message) => (ok ? pass++ : failures.push(message));

console.log(`deployment ${deployment.network} (${deployment.file}) — chainId ${deployment.chainId}`);
for (const name of Object.keys(ENV_BY_CONTRACT)) {
  const { address, startBlock, deployTx } = deployment.contracts[name];
  console.log(`  ${name.padEnd(15)} ${address}  block ${startBlock}  ${deployTx ?? '(no deploy tx)'}`);
}

// ── 1. no stale address environment variables ────────────────────────────────
// Since step 1-B, lib/deployment.ts reads the record directly and nothing reads these. A
// leftover value is worse than a missing one: it looks authoritative and is ignored. Failing
// only on disagreement would let a contradictory .env sit there looking meaningful.
const RETIRED = {
  NEXT_PUBLIC_TICKET_NFT: deployment.contracts.TicketNFT.address,
  NEXT_PUBLIC_ESCROW: deployment.contracts.Escrow.address,
  NEXT_PUBLIC_INTENT_REGISTRY: deployment.contracts.IntentRegistry.address,
  NEXT_PUBLIC_SETTLEMENT: deployment.contracts.Settlement.address,
  NEXT_PUBLIC_USDC: deployment.usdc,
  NEXT_PUBLIC_CHAIN_ID: String(deployment.chainId),
  NEXT_PUBLIC_DEPLOYMENT_BLOCK: String(deployment.startBlock),
};
for (const [key, recorded] of Object.entries(RETIRED)) {
  const actual = process.env[key];
  if (actual === undefined || actual === '') {
    pass++;
    continue;
  }
  const agrees = key.includes('USDC') || key.startsWith('NEXT_PUBLIC_TICKET')
    || key.includes('ESCROW') || key.includes('REGISTRY') || key.includes('SETTLEMENT')
    ? sameAddress(actual, recorded)
    : actual.trim() === recorded;
  check(
    false,
    `${key} is set but no longer read (lib/deployment.ts reads ${deployment.file}). ` +
      `Remove it from .env. ${agrees ? 'It currently agrees with the record.' : `It DISAGREES: env=${actual}, record=${recorded}.`}`
  );
}

// ARC_CHAIN_ID is still honoured by server/chain.ts as a guard, so it must agree if present.
if (process.env.ARC_CHAIN_ID) {
  check(
    process.env.ARC_CHAIN_ID.trim() === String(deployment.chainId),
    `ARC_CHAIN_ID=${process.env.ARC_CHAIN_ID} contradicts ${deployment.network} (chainId ${deployment.chainId})`
  );
}
if (process.env.USDC_ADDRESS) {
  check(
    sameAddress(process.env.USDC_ADDRESS, deployment.usdc),
    `USDC_ADDRESS=${process.env.USDC_ADDRESS} contradicts record ${deployment.usdc}`
  );
}

// ── 2. no hand-copied addresses in source ────────────────────────────────────
// deployments/ and docs/ are records and prose, so they are allowed to name addresses.
const SEARCH_DIRS = ['app', 'lib', 'server', 'component', 'solver/src', 'scripts', 'config', 'src'];
const SEARCH_EXT = new Set(['.ts', '.tsx', '.mjs', '.js', '.sol', '.json']);
const ALLOWED_FILES = new Set([path.normalize('scripts/check-deployment-config.mjs')]);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'forge-std', 'openzeppelin-contracts']);

const known = new Map();
for (const name of Object.keys(ENV_BY_CONTRACT)) {
  known.set(deployment.contracts[name].address.toLowerCase(), name);
}
// USDC is tracked separately. It is a canonical Arc address, not something we redeploy, so a
// copy of it is not the bug this scan exists to catch — several scripts assert against it
// deliberately. Reported, not failed.
const usdcAddress = deployment.usdc?.toLowerCase();

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // lib/ holds both the Next.js modules and Foundry's vendored dependencies. forge-std
      // ships fixtures containing the deterministic Anvil addresses, which collide with the
      // local deployment record; vendored code is not ours to police either way.
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (SEARCH_EXT.has(path.extname(entry.name))) {
      yield full;
    }
  }
}

const copied = [];
const usdcCopies = [];
for (const dir of SEARCH_DIRS) {
  for (const file of walk(dir)) {
    if (ALLOWED_FILES.has(path.normalize(file))) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const lower = line.toLowerCase();
      for (const [address, name] of known) {
        if (lower.includes(address)) copied.push(`${file}:${index + 1} hard-codes ${name} (${address})`);
      }
      if (usdcAddress && lower.includes(usdcAddress)) usdcCopies.push(`${file}:${index + 1}`);
    });
  }
}
check(copied.length === 0, `hand-copied addresses found:\n    ${copied.join('\n    ')}`);
if (usdcCopies.length > 0) {
  console.log(`\n  note: ${usdcCopies.length} literal copies of the Arc USDC address (canonical, not redeployed):`);
  for (const where of usdcCopies) console.log(`        ${where}`);
}

// ── 2b. the generated public slice is in sync ────────────────────────────────
// lib/deployment.ts imports deployments/public/<network>.json, so a stale copy silently
// points the frontend at old addresses — exactly the drift this whole file exists to prevent.
{
  const expected = serialise(publicRecord(deployment));
  const file = publicPath(deployment.network);
  if (!fs.existsSync(file)) {
    check(false, `${file} is missing — run: npm run deployment:public`);
  } else {
    const actual = fs.readFileSync(file, 'utf8');
    check(
      actual.replace(/\r\n/g, '\n') === expected,
      `${file} is stale or hand-edited — run: npm run deployment:public`
    );
  }
}

// ── 3. the subgraph endpoint, once step 3-G has produced one ─────────────────
if (deployment.subgraphUrl) {
  console.log(`  subgraphUrl     ${deployment.subgraphUrl}`);
} else {
  console.log('  subgraphUrl     (not yet deployed — set SUBGRAPH_URL or the record field)');
}

// ── 4. the record against the chain (--chain) ────────────────────────────────
// The checks above only prove the record is internally consistent and that env agrees with
// it. Both can be true of a record that names the wrong contracts. This reads Arc.
if (args.includes("--chain")) {
  const { createPublicClient, http, keccak256, encodeAbiParameters, toBytes } = await import('viem');
  const rpc = process.env.ARC_RPC || deployment.rpc;
  console.log(`\nchain verification via ${rpc}`);
  const client = createPublicClient({ transport: http(rpc, { timeout: 20000 }) });
  const abiOf = (name) => JSON.parse(fs.readFileSync(`out/${name}.sol/${name}.json`, 'utf8')).abi;
  // A record naming the wrong contract makes these reads revert rather than mismatch, so a
  // revert has to be reported as a failed check, not thrown.
  const read = async (name, functionName) => {
    try {
      return await client.readContract({
        address: deployment.contracts[name].address,
        abi: abiOf(name),
        functionName,
      });
    } catch (error) {
      return `<${functionName}() reverted: ${String(error.shortMessage ?? error.message).split('\n')[0]}>`;
    }
  };

  const chainId = await client.getChainId();
  check(chainId === deployment.chainId, `RPC reports chainId ${chainId}, record says ${deployment.chainId}`);

  for (const name of Object.keys(ENV_BY_CONTRACT)) {
    const code = await client.getCode({ address: deployment.contracts[name].address });
    check(!!code && code !== '0x', `no code at ${name} ${deployment.contracts[name].address}`);
  }
  const usdcCode = await client.getCode({ address: deployment.usdc });
  check(!!usdcCode && usdcCode !== '0x', `no code at usdc ${deployment.usdc}`);

  // Wiring: each contract must point at the others named in this same record.
  for (const [name, fn, expected] of [
    ['Settlement', 'ticketNFT', deployment.contracts.TicketNFT.address],
    ['Settlement', 'registry', deployment.contracts.IntentRegistry.address],
    ['Settlement', 'escrow', deployment.contracts.Escrow.address],
    ['Settlement', 'usdc', deployment.usdc],
    ['Escrow', 'settlement', deployment.contracts.Settlement.address],
    ['IntentRegistry', 'settlement', deployment.contracts.Settlement.address],
  ]) {
    const got = await read(name, fn);
    check(sameAddress(got, expected), `${name}.${fn}() -> ${got}, record says ${expected}`);
  }

  // Each deploy receipt really created that address at that block — this is what the
  // subgraph's startBlock is bound to.
  for (const name of Object.keys(ENV_BY_CONTRACT)) {
    const { deployTx, address, startBlock } = deployment.contracts[name];
    if (!deployTx) continue;
    const receipt = await client.getTransactionReceipt({ hash: deployTx });
    check(
      receipt.status === 'success' &&
        sameAddress(receipt.contractAddress, address) &&
        Number(receipt.blockNumber) === startBlock,
      `deploy:${name} receipt: block ${receipt.blockNumber} ${receipt.status} -> ${receipt.contractAddress}; ` +
        `record says block ${startBlock} -> ${address}`
    );
  }

  // A wrong chainId or verifyingContract silently invalidates every signature, so derive the
  // domain separator from the record and compare with the deployed one.
  const onchainDomain = await read('IntentRegistry', 'DOMAIN_SEPARATOR');
  const derivedDomain = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
      [
        keccak256(toBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
        keccak256(toBytes('RESHUFFLE')),
        keccak256(toBytes('1')),
        BigInt(deployment.chainId),
        deployment.contracts.IntentRegistry.address,
      ]
    )
  );
  check(onchainDomain === derivedDomain, `DOMAIN_SEPARATOR on-chain ${onchainDomain}, derived ${derivedDomain}`);
  console.log(`  head block ${await client.getBlockNumber()}, domain separator ${onchainDomain}`);
}

console.log();
if (failures.length === 0) {
  console.log(`PASS — ${pass} checks, ${deployment.network} is the single source of truth`);
  process.exit(0);
}
for (const failure of failures) console.log(`FAIL ${failure}`);
console.log(`\n${pass} pass, ${failures.length} fail`);
process.exit(1);
