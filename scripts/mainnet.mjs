import fs from 'node:fs';
import { loadEnvFile } from 'node:process';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { validateConfig, loadArtifacts, preflight, makePlan, deploy, verifyDeployment, readJson, writeJson } from './lib/mainnet-deployment.mjs';

export async function main() {
  const mode = process.argv[2] ?? 'check';
  assert(['check', 'plan', 'deploy', 'verify'].includes(mode) && process.argv.length <= 3, 'Usage: node scripts/mainnet.mjs check|plan|deploy|verify');
  if (fs.existsSync('.env')) loadEnvFile('.env');
  const config = readJson('config/arc-mainnet.json');
  const rpc = process.env.ARC_MAINNET_RPC;
  validateConfig(config, rpc); // Stops with the committed pending configuration.
  const chain = defineChain({ id: config.chainId, name: config.name, nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const transport = http(rpc, { timeout: 20000, retryCount: 3 });
  const client = createPublicClient({ chain, transport });
  const artifacts = loadArtifacts();
  if (mode === 'check') {
    console.log(await preflight(client, config));
  } else if (mode === 'plan') {
    await preflight(client, config);
    const nonce = await client.getTransactionCount({ address: config.deployer, blockTag: 'pending' });
    writeJson('deployments/mainnet-plan.json', { chainId: config.chainId, deployer: config.deployer, issuer: config.issuer, ...makePlan(config, artifacts, nonce), scope: 'unsigned calldata and CREATE predictions; not a fork simulation or broadcast' });
    console.log('Unsigned plan written to deployments/mainnet-plan.json. No transaction signed or sent.');
  } else if (mode === 'verify') {
    const record = readJson('deployments/arc-mainnet.json');
    console.log(await verifyDeployment(client, config, artifacts, record));
  } else {
    assert(/^0x[0-9a-fA-F]{64}$/.test(process.env.ARC_MAINNET_PRIVATE_KEY ?? ''), 'Set ARC_MAINNET_PRIVATE_KEY locally; do not reuse demo keys');
    const account = privateKeyToAccount(process.env.ARC_MAINNET_PRIVATE_KEY);
    const wallet = createWalletClient({ account, chain, transport });
    fs.mkdirSync('.data/mainnet', { recursive: true });
    const lock = '.data/mainnet/deploy.lock';
    const handle = fs.openSync(lock, 'wx');
    try {
      await deploy(client, wallet, config, artifacts, '.data/mainnet/journal.json', 'deployments/arc-mainnet.json');
      console.log('Deployment verified. Review docs/MAINNET_READINESS.md before application cutover.');
    } finally { fs.closeSync(handle); fs.unlinkSync(lock); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.shortMessage ? `Mainnet RPC operation failed (${error.name}); journal retained.` : error.message); process.exitCode = 1; });
}
