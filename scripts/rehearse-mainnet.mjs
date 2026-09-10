import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createPublicClient, createWalletClient, defineChain, http, encodeDeployData } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { validateConfig, loadArtifacts, deploy, verifyDeployment, readJson, writeJson, checkRuntime } from './lib/mainnet-deployment.mjs';

const server = net.createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const rpc = `http://127.0.0.1:${port}`;
const anvil = spawn(fs.existsSync('.tools/foundry/anvil.exe') ? '.tools/foundry/anvil.exe' : 'anvil', ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337', '--hardfork', 'paris', '--silent'], { stdio: 'ignore', windowsHide: true });
let startupError;
anvil.on('error', error => { startupError = error; });
try {
  const chain = defineChain({ id: 31337, name: 'Local deployment rehearsal', nativeCurrency: { name: 'Test gas', symbol: 'TEST', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const transport = http(rpc, { timeout: 2000, retryCount: 0 });
  const client = createPublicClient({ chain, transport });
  for (let i = 0; i < 40; i++) {
    if (startupError) throw new Error('Anvil is unavailable; install Foundry');
    if (await client.getChainId().catch(() => null) === 31337) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(await client.getChainId(), 31337);
  const account = privateKeyToAccount(generatePrivateKey());
  const issuer = privateKeyToAccount(generatePrivateKey()).address;
  await client.request({ method: 'anvil_setBalance', params: [account.address, '0x56BC75E2D63100000'] });
  const wallet = createWalletClient({ account, chain, transport });
  const mock = readJson('out/MockUSDC.sol/MockUSDC.json');
  const hash = await wallet.sendTransaction({ data: encodeDeployData({ abi: mock.abi, bytecode: mock.bytecode.object }), gas: 2000000n });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success');
  const config = { name: 'LOCAL REHEARSAL ONLY', officialParametersConfirmed: true, chainId: 31337, genesisHash: (await client.getBlock({ blockNumber: 0n })).hash,
    usdc: receipt.contractAddress, deployer: account.address, issuer, adminModelAcknowledged: true,
    maxFeePerGasWei: '100000000000', deployGasLimit: '8000000', configureGasLimit: '500000', confirmations: 1 };
  validateConfig(config, rpc, true);
  assert.throws(() => validateConfig(config, rpc), /Testnet\/local chain/);
  assert.throws(() => validateConfig(config, 'https://rpc.testnet.arc.io', true), /loopback/);
  const artifacts = loadArtifacts();
  const folder = `.data/mainnet-rehearsal/${Date.now()}`;
  const record = await deploy(client, wallet, config, artifacts, `${folder}/journal.json`, `${folder}/manifest.json`);
  const nonce = await client.getTransactionCount({ address: account.address });
  const resumed = await deploy(client, wallet, config, artifacts, `${folder}/journal.json`, `${folder}/manifest.json`);
  assert.equal(await client.getTransactionCount({ address: account.address }), nonce, 'Resume sent a duplicate transaction');
  assert.deepEqual(record.transactions, resumed.transactions);
  const altered = structuredClone(record);
  altered.contracts.Escrow = altered.contracts.TicketNFT;
  await assert.rejects(() => verifyDeployment(client, config, artifacts, altered), /CREATE addresses/);
  const actual = await client.getCode({ address: record.contracts.Settlement });
  const tampered = '0x00' + actual.slice(4);
  assert.throws(() => checkRuntime(artifacts.Settlement, tampered), /Runtime bytecode mismatch/);
  await wallet.writeContract({ address: record.contracts.Escrow, abi: artifacts.Escrow.abi, functionName: 'setSettlement', args: [config.issuer], gas: 500000n });
  await assert.rejects(() => verifyDeployment(client, config, artifacts, record), /Settlement permission mismatch/);
  const restore = await wallet.writeContract({ address: record.contracts.Escrow, abi: artifacts.Escrow.abi, functionName: 'setSettlement', args: [record.contracts.Settlement], gas: 500000n });
  await client.waitForTransactionReceipt({ hash: restore });
  const verification = await verifyDeployment(client, config, artifacts, record);
  writeJson('deployments/mainnet-rehearsal.json', { title: 'Local Anvil rehearsal; not an Arc Mainnet deployment', completedAt: new Date().toISOString(), chainId: 31337,
    checks: ['four creates and three configuration receipts', 'compiled runtime bytecode', 'all admins and configured issuer', 'Escrow/Registry/Settlement wiring', 'EIP-712 domain', 'resume sends no duplicate transactions', 'local chain rejected by mainnet configuration', 'rehearsal rejects external RPC', 'wrong manifest address rejected', 'tampered runtime rejected', 'changed settlement permission rejected'],
    deployment: { ...record, verification } });
  console.log('PASS: local deployment, verification, idempotent resume and negative checks. No Arc transaction sent.');
} catch (error) {
  console.error(error.shortMessage ? `Rehearsal RPC failed (${error.name}).` : error.message);
  process.exitCode = 1;
} finally { anvil.kill(); }
