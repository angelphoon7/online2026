import fs from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';
import { createPublicClient, http, decodeAbiParameters, erc20Abi } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { hashIntent } from '../solver/dist/index.js';
import abis from '../server/abis.json' with { type: 'json' };
import { checkDemo, json } from './lib/demo-state.mjs';

const manifestPath = 'deployments/demo-ready.json';
const planPath = '.data/demo-seed-plan.json';
const readJson = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const write = (path, data) => { fs.writeFileSync(`${path}.tmp`, json(data)); fs.renameSync(`${path}.tmp`, path); };

async function main() {
  if (process.argv.slice(2).some(a => a !== '--check') || process.argv.length > 3) throw new Error('Usage: npm run demo:prepare [-- --check]');
  const checkOnly = process.argv.includes('--check');
  loadEnvFile('.env');
  const deployment = readJson('deployments/arc-testnet.json');
  if (process.env.ARC_CHAIN_ID !== '5042002' || !process.env.ARC_RPC || !same(deployment.usdc, '0x3600000000000000000000000000000000000000')) throw new Error('Configure Arc Testnet in .env.');
  for (const [name, env] of Object.entries({ TicketNFT: 'TICKET_NFT', Escrow: 'ESCROW', IntentRegistry: 'INTENT_REGISTRY', Settlement: 'SETTLEMENT' })) {
    if (!same(deployment.contracts[name], process.env[`NEXT_PUBLIC_${env}`])) throw new Error(`Deployment and .env disagree on ${name}.`);
  }
  const client = createPublicClient({ transport: http(process.env.ARC_RPC, { timeout: 20000, retryCount: 2 }) });
  if (await client.getChainId() !== 5042002) throw new Error('RPC returned the wrong chain.');
  const read = (name, functionName, args = []) => client.readContract({ address: deployment.contracts[name], abi: abis[name], functionName, args });
  for (const [getter, expected] of [['ticketNFT', deployment.contracts.TicketNFT], ['registry', deployment.contracts.IntentRegistry], ['escrow', deployment.contracts.Escrow], ['usdc', deployment.usdc]]) {
    if (!same(await read('Settlement', getter), expected)) throw new Error('Settlement wiring mismatch.');
  }
  let current = fs.existsSync(manifestPath) ? readJson(manifestPath) : null;
  if (current && (current.chainId !== 5042002 || !same(current.settlement, deployment.contracts.Settlement))) throw new Error('Demo manifest belongs to another deployment.');
  if (current) {
    const check = await checkDemo(client, deployment, current.intents);
    if (check.ready && (checkOnly || check.intents.every(i => i.deadline > check.block.timestamp + 86400n))) {
      write('deployments/arc-seed-evidence.json', check.evidence);
      // Recover a crash after publishing the manifest but before removing its plan.
      if (!checkOnly && fs.existsSync(planPath)) {
        const pending = readJson(planPath);
        if (same(pending.settlement, current.settlement) && pending.owners.length === 3
          && pending.owners.every((owner, i) => current.intents.some(intent => same(intent.owner, owner)
            && String(intent.nonce) === String(pending.nonces[i]) && String(intent.deadline) === String(pending.deadline)))) fs.unlinkSync(planPath);
      }
      console.log(`Ready: 3 LIVE intents, ${check.intents.reduce((n, i) => n + i.offered.length, 0)} escrowed tickets. Solver + eth_call passed at block ${check.block.number}.`);
      console.log('Reused existing chain state; no transaction sent. Open /demo in the running app.');
      return;
    }
    if (checkOnly) throw new Error('Demo is not ready. Run npm run demo:prepare to prepare it.');
  } else if (checkOnly) throw new Error('No demo manifest. Run npm run demo:prepare first.');

  if (fs.existsSync('.env.seed')) loadEnvFile('.env.seed');
  const keyNames = ['PRIVATE_KEY', 'SEED_B_PRIVATE_KEY', 'SEED_C_PRIVATE_KEY'];
  const oldRecords = current?.intents ?? deployment.seed?.intents ?? [];
  const oldOwners = [...new Set(oldRecords.map(i => i.owner.toLowerCase()))];
  const generated = [];
  for (const key of keyNames) {
    if (!process.env[key]) {
      if (key === 'PRIVATE_KEY' || oldOwners.length) throw new Error(`Restore ${key} in your local env file; existing demo wallets must not be replaced.`);
      process.env[key] = generatePrivateKey();
      generated.push(`${key}=${process.env[key]}`);
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(process.env[key])) throw new Error(`Invalid ${key}.`);
  }
  if (generated.length) fs.appendFileSync('.env.seed', `\n${generated.join('\n')}\n`, { mode: 0o600 });
  const owners = keyNames.map(k => privateKeyToAccount(process.env[k]).address);
  if (!same(owners[0], deployment.deployer) || new Set(owners.map(a => a.toLowerCase())).size !== 3 || oldOwners.some(a => !owners.some(b => same(a, b)))) throw new Error('Local keys do not match the three demo participants.');
  if (await client.readContract({ address: deployment.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [owners[0]] }) < 3100000n) throw new Error('Operator needs at least 3.1 test USDC for participant gas, settlement capacity and setup fees. Fund it at https://faucet.circle.com/.');
  fs.mkdirSync('.data', { recursive: true });
  let plan;
  if (fs.existsSync(planPath)) {
    plan = readJson(planPath);
    if (!same(plan.settlement, deployment.contracts.Settlement) || plan.owners.some((a, i) => !same(a, owners[i]))) throw new Error('Pending seed plan does not match this deployment or keys.');
    if (BigInt(plan.deadline) <= (await client.getBlock()).timestamp + 3600n) throw new Error('Pending seed plan expired. Inspect it before clearing .data/demo-seed-plan.json.');
    console.log('Resuming the saved seed plan from chain state.');
  } else {
    const pool = [...new Set(oldRecords.flatMap(i => i.offered).map(String))];
    const groups = owners.map(() => []);
    if (pool.length) {
      if (pool.length !== 12) throw new Error('Existing demo inventory must contain exactly 12 tickets.');
      for (const id of pool) {
        let owner = await read('TicketNFT', 'ownerOf', [BigInt(id)]);
        if (same(owner, deployment.contracts.Escrow)) owner = await read('Escrow', 'depositor', [BigInt(id)]);
        const index = owners.findIndex(a => same(a, owner));
        const meta = await read('TicketNFT', 'meta', [BigInt(id)]);
        if (index < 0 || meta[5] !== 0) throw new Error(`Demo ticket #${id} is unavailable. Restore custody or use a separate deployment.`);
        groups[index].push(id);
      }
      if (groups.some(g => g.length !== 4)) throw new Error('Each demo wallet must hold or have deposited four tickets.');
    } else {
      const first = await read('TicketNFT', 'nextTokenId');
      for (let i = 0; i < 12; i++) groups[Math.floor(i / 4)].push(String(first + BigInt(i)));
    }
    const nonces = [];
    for (const owner of owners) {
      let nonce = 0n;
      while (await read('IntentRegistry', 'usedNonce', [owner, nonce])) nonce++;
      nonces.push(String(nonce));
    }
    plan = { settlement: deployment.contracts.Settlement, owners, ids: groups.flat(), nonces,
      previous: oldRecords.map(i => i.hash), deadline: Number((await client.getBlock()).timestamp + 30n * 86400n), mintNew: !pool.length };
    write(planPath, plan);
  }
  const forge = fs.existsSync('.tools/foundry/forge.exe') ? '.tools/foundry/forge.exe' : 'forge';
  console.log('Preparing tickets and signed intents on Arc Testnet; settlement remains pending.');
  // Key-bearing cheatcode traces must never reach console output. Keep the log ignored locally.
  const log = fs.openSync('.data/demo-seed-forge.log', 'w', 0o600);
  let result;
  try {
    result = spawnSync(forge, ['script', 'script/SeedDemo.s.sol:SeedDemo', '--rpc-url', 'arc_testnet', '--chain', '5042002',
      '--evm-version', 'paris', '--gas-limit', '30000000', '--slow', '--broadcast'], { stdio: ['ignore', log, log], shell: false });
  } finally { fs.closeSync(log); }
  if (result.error || result.status !== 0) throw new Error('Forge seed did not finish. Inspect the private .data/demo-seed-forge.log locally, then rerun this command to resume.');
  const tuple = abis.IntentRegistry.find(e => e.name === 'commit').inputs[0];
  const [intents] = decodeAbiParameters([{ ...tuple, type: 'tuple[]' }], readJson('.data/demo-seed-output.json').encodedIntents);
  const records = JSON.parse(json(intents.map(i => ({ ...i, hash: hashIntent(i) }))));
  const check = await checkDemo(client, deployment, records);
  if (!check.ready) throw new Error('Seed transactions completed but solver/simulation did not pass. Plan retained for inspection; demo manifest was not replaced.');
  write(manifestPath, { chainId: 5042002, settlement: deployment.contracts.Settlement, intents: records });
  write('deployments/arc-seed-evidence.json', check.evidence);
  fs.unlinkSync(planPath);
  console.log(`Ready: 3 LIVE intents, 12 escrowed tickets; solver + eth_call passed at block ${check.block.number}. Open /demo in the running app.`);
}

main().catch(error => {
  // Known local messages are safe; RPC errors can contain credential-bearing URLs.
  console.error(error.shortMessage ? 'Arc RPC request failed. Check connectivity and retry; the saved plan is retained.' : error.message);
  process.exitCode = 1;
});
