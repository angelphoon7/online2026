import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

// Match Foundry: deployment settings come from .env, not .env.local.
loadEnvFile('.env');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--broadcast') || args.length > 1) {
  throw new Error('Usage: node scripts/deploy-arc.mjs [--broadcast]');
}
if (!process.env.ARC_RPC || process.env.ARC_CHAIN_ID !== '5042002') {
  throw new Error('Configure ARC_RPC and ARC_CHAIN_ID=5042002 in .env.');
}
if (!/^0x[0-9a-fA-F]{64}$/.test(process.env.PRIVATE_KEY ?? '')) {
  throw new Error('Configure a valid PRIVATE_KEY locally in .env.');
}
// A script execution budget, not measured gas usage or a per-transaction cap.
const gasLimit = process.env.ARC_SCRIPT_GAS_LIMIT || '30000000';
if (!/^[1-9][0-9]*$/.test(gasLimit) || !Number.isSafeInteger(Number(gasLimit))) {
  throw new Error('ARC_SCRIPT_GAS_LIMIT must be a positive safe integer.');
}
const forgeArgs = [
  'script', 'script/Deploy.s.sol:Deploy',
  '--rpc-url', 'arc_testnet',
  '--chain', '5042002',
  '--evm-version', 'paris',
  '--gas-limit', gasLimit,
  '--gas-estimate-multiplier', '130',
  '--slow',
  ...args,
];
console.log(args.includes('--broadcast') ? 'Broadcasting deployment to Arc Testnet.' : 'Simulating deployment; no transactions will be sent.');
console.log(`Script gas limit: ${gasLimit}; transaction gas estimate multiplier: 130%.`);
// The private key stays in the environment; never put it on the command line.
const forge = existsSync('.tools/foundry/forge.exe') ? '.tools/foundry/forge.exe' : 'forge';
const result = spawnSync(forge, forgeArgs, { stdio: 'inherit', shell: false });
if (result.error) {
  console.error(result.error.code === 'ENOENT'
    ? 'Foundry is missing from PATH. Install Foundry and open a new terminal.'
    : `Could not start Forge: ${result.error.code}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
