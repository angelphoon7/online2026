import nextEnv from '@next/env';
import { createPublicClient, http, erc20Abi, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

nextEnv.loadEnvConfig(process.cwd());
const env = process.env;
if (env.ARC_CHAIN_ID !== '5042002' || env.NEXT_PUBLIC_CHAIN_ID !== env.ARC_CHAIN_ID) {
  throw new Error('Expected Arc Testnet chain ID 5042002 in server and frontend config.');
}
if (env.NEXT_PUBLIC_RPC_URL !== env.ARC_RPC || env.NEXT_PUBLIC_USDC !== env.USDC_ADDRESS) {
  throw new Error('Server and frontend RPC/USDC configuration must match.');
}
if (env.USDC_ADDRESS?.toLowerCase() !== '0x3600000000000000000000000000000000000000') {
  throw new Error('Expected the Arc Testnet USDC ERC-20 interface.');
}
const client = createPublicClient({ transport: http(env.ARC_RPC, { timeout: 15000, retryCount: 0 }) });
const chainId = await client.getChainId();
if (chainId !== Number(env.ARC_CHAIN_ID)) throw new Error('RPC chain ID does not match configuration.');
const decimals = await client.readContract({ address: env.USDC_ADDRESS, abi: erc20Abi, functionName: 'decimals' });
if (decimals !== 6) throw new Error('Unexpected USDC ERC-20 decimals.');
console.log(`Arc RPC verified: chainId=${chainId}, USDC decimals=${decimals}`);
if (env.PRIVATE_KEY) {
  let account;
  try { account = privateKeyToAccount(env.PRIVATE_KEY); }
  catch { throw new Error('PRIVATE_KEY is invalid; edit it locally in .env.'); }
  if (env.DEPLOYER_ADDRESS && env.DEPLOYER_ADDRESS.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error('DEPLOYER_ADDRESS does not match PRIVATE_KEY.');
  }
  const balance = await client.getBalance({ address: account.address });
  console.log(`Deployer: ${account.address}`);
  console.log(`Native USDC balance: ${formatUnits(balance, 18)}`);
  if (balance === 0n) console.log(`Funding required: select Arc Testnet / USDC at ${env.ARC_FAUCET_URL}`);
} else {
  console.log('PRIVATE_KEY is missing; configure a local testnet deployer in .env.');
}
const missing = ['TICKET_NFT', 'ESCROW', 'INTENT_REGISTRY', 'SETTLEMENT']
  .filter(name => !env[`NEXT_PUBLIC_${name}`]);
if (missing.length) console.log(`Deployment addresses still required: ${missing.join(', ')}`);
