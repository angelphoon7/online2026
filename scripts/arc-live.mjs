import fs from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createPublicClient, createWalletClient, defineChain, http, encodeDeployData, encodeFunctionData, erc20Abi, parseEther, keccak256, hashStruct, parseEventLogs } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

loadEnvFile('.env');
const mode = process.argv[2];
if (!['deploy', 'seed', 'verify'].includes(mode)) throw new Error('Usage: node scripts/arc-live.mjs deploy|seed|verify');
const chain = defineChain({ id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [process.env.ARC_RPC] } } });
if (process.env.ARC_CHAIN_ID !== '5042002') throw new Error('Only Arc Testnet is supported.');
const usdc = '0x3600000000000000000000000000000000000000';
if (process.env.USDC_ADDRESS?.toLowerCase() !== usdc) throw new Error('Unexpected USDC configuration.');
const transport = http(process.env.ARC_RPC, { timeout: 20000, retryCount: 2 });
const client = createPublicClient({ chain, transport });
const deployer = privateKeyToAccount(process.env.PRIVATE_KEY);
if (deployer.address.toLowerCase() !== process.env.DEPLOYER_ADDRESS?.toLowerCase()) throw new Error('Deployer address/key mismatch.');
if (await client.getChainId() !== chain.id) throw new Error('Wrong RPC network.');
const artifact = name => JSON.parse(fs.readFileSync(`out/${name}.sol/${name}.json`, 'utf8'));
const names = ['TicketNFT', 'Escrow', 'IntentRegistry', 'Settlement'];
const artifacts = Object.fromEntries(names.map(name => [name, artifact(name)]));
const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
const journalPath = '.arc-journal.json';
const journal = fs.existsSync(journalPath) ? JSON.parse(fs.readFileSync(journalPath, 'utf8')) : { chainId: chain.id, deployer: deployer.address, steps: {}, contracts: {} };
if (journal.chainId !== chain.id || journal.deployer !== deployer.address) throw new Error('Journal belongs to another deployment.');
function save() {
  fs.writeFileSync(`${journalPath}.tmp`, json(journal));
  fs.renameSync(`${journalPath}.tmp`, journalPath);
}
async function transact(label, account, tx) {
  let step = journal.steps[label];
  if (!step) {
    const wallet = createWalletClient({ account, chain, transport });
    // Explicit gas for every transaction: no eth_estimateGas for USDC writes.
    await client.call({ account: account.address, ...tx });
    const request = await wallet.prepareTransactionRequest(tx);
    const raw = await wallet.signTransaction(request);
    step = journal.steps[label] = { hash: keccak256(raw), raw, status: 'signed' };
    save(); // Persist before submission so interruption cannot duplicate a mint.
  }
  let receipt = await client.getTransactionReceipt({ hash: step.hash }).catch(error => {
    if (error.name === 'TransactionReceiptNotFoundError') return null;
    throw error;
  });
  if (!receipt) {
    try { await client.sendRawTransaction({ serializedTransaction: step.raw }); }
    catch (error) {
      const known = await client.getTransaction({ hash: step.hash }).catch(() => null);
      if (!known) throw error;
    }
    receipt = await client.waitForTransactionReceipt({ hash: step.hash, timeout: 120000 });
  }
  step.status = receipt.status;
  step.blockNumber = receipt.blockNumber.toString();
  step.contractAddress = receipt.contractAddress;
  save();
  if (receipt.status !== 'success') throw new Error(`Transaction reverted: ${label} ${step.hash}`);
  console.log(`${label}: ${step.hash}`);
  return receipt;
}
const read = (name, functionName, args = []) => client.readContract({ address: journal.contracts[name], abi: artifacts[name].abi, functionName, args });
const write = (label, name, functionName, args, account = deployer, gas = 500000n) => transact(label, account, { to: journal.contracts[name], data: encodeFunctionData({ abi: artifacts[name].abi, functionName, args }), gas });
function publicManifest() {
  fs.mkdirSync('deployments', { recursive: true });
  const transactions = Object.entries(journal.steps).map(([label, { hash, status, blockNumber, contractAddress }]) => ({ label, hash, status, blockNumber, contractAddress }));
  fs.writeFileSync('deployments/arc-testnet.json', json({ chainId: chain.id, rpc: process.env.ARC_RPC, deployer: deployer.address, usdc, contracts: journal.contracts, startBlock: transactions[0]?.blockNumber, transactions, seed: journal.seed, verified: journal.verified }));
}
if (mode === 'deploy') {
  for (const name of names) {
    const args = name === 'Escrow' ? [journal.contracts.TicketNFT] : name === 'Settlement' ? [journal.contracts.IntentRegistry, journal.contracts.Escrow, journal.contracts.TicketNFT, usdc] : [];
    const a = artifacts[name];
    const metadata = typeof a.metadata === 'string' ? JSON.parse(a.metadata) : a.metadata;
    if (metadata.settings.evmVersion !== 'paris') throw new Error(`Rebuild ${name} for Paris.`);
    const receipt = await transact(`deploy:${name}`, deployer, { data: encodeDeployData({ abi: a.abi, bytecode: a.bytecode.object, args }), gas: 8000000n });
    journal.contracts[name] = receipt.contractAddress;
    save();
    publicManifest();
  }
  await write('configure:escrow', 'Escrow', 'setSettlement', [journal.contracts.Settlement]);
  await write('configure:registry', 'IntentRegistry', 'setSettlement', [journal.contracts.Settlement]);
  await write('configure:issuer', 'TicketNFT', 'registerIssuer', [deployer.address]);
  const values = { NEXT_PUBLIC_TICKET_NFT: journal.contracts.TicketNFT, NEXT_PUBLIC_ESCROW: journal.contracts.Escrow, NEXT_PUBLIC_INTENT_REGISTRY: journal.contracts.IntentRegistry, NEXT_PUBLIC_SETTLEMENT: journal.contracts.Settlement, NEXT_PUBLIC_CHAIN_ID: String(chain.id), NEXT_PUBLIC_RPC_URL: process.env.ARC_RPC, NEXT_PUBLIC_USDC: usdc, NEXT_PUBLIC_DEPLOYMENT_BLOCK: journal.steps['deploy:TicketNFT'].blockNumber };
  let env = fs.readFileSync('.env', 'utf8');
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    env = pattern.test(env) ? env.replace(pattern, `${key}=${value}`) : `${env}\n${key}=${value}\n`;
  }
  fs.writeFileSync('.env', env);
}
for (const name of names) {
  if (!journal.contracts[name] || !(await client.getCode({ address: journal.contracts[name] }))) throw new Error(`Missing deployed ${name}`);
}
if ((await read('Escrow', 'settlement')).toLowerCase() !== journal.contracts.Settlement.toLowerCase() || (await read('IntentRegistry', 'settlement')).toLowerCase() !== journal.contracts.Settlement.toLowerCase()) throw new Error('Settlement wiring mismatch.');
for (const [field, expected] of Object.entries({ registry: journal.contracts.IntentRegistry, escrow: journal.contracts.Escrow, ticketNFT: journal.contracts.TicketNFT, usdc })) {
  if ((await read('Settlement', field)).toLowerCase() !== expected.toLowerCase()) throw new Error(`Settlement ${field} mismatch.`);
}
if (mode === 'seed') {
  if (!fs.existsSync('.env.seed')) {
    if (journal.seed) throw new Error('Restore .env.seed; do not replace existing participant keys.');
    fs.writeFileSync('.env.seed', `# Local demo participant keys. Never commit or expose in frontend.\nSEED_B_PRIVATE_KEY=${generatePrivateKey()}\nSEED_C_PRIVATE_KEY=${generatePrivateKey()}\n`, { flag: 'wx' });
  }
  loadEnvFile('.env.seed');
  const accounts = [deployer, privateKeyToAccount(process.env.SEED_B_PRIVATE_KEY), privateKeyToAccount(process.env.SEED_C_PRIVATE_KEY)];
  if (!journal.seed) {
    journal.seed = { accounts: accounts.map(a => a.address), firstTokenId: (await read('TicketNFT', 'nextTokenId')).toString(), deadline: ((await client.getBlock()).timestamp + 30n * 86400n).toString(), intents: [], tickets: [] };
    save();
  }
  if (accounts.some((a, i) => a.address !== journal.seed.accounts[i])) throw new Error('Seed participant keys differ from journal.');
  const classes = [[0, 0], [1, 0], [0, 1]];
  for (let i = 1; i < accounts.length; i++) await transact(`seed:fund:${i}`, deployer, { to: accounts[i].address, value: parseEther('1'), gas: 100000n });
  for (let i = 0; i < 12; i++) {
    const group = Math.floor(i / 4);
    const receipt = await write(`seed:mint:${i}`, 'TicketNFT', 'mint', [accounts[group].address, 1, ...classes[group], 1, i % 4 + 1]);
    const [event] = parseEventLogs({ abi: artifacts.TicketNFT.abi, logs: receipt.logs, eventName: 'TicketMinted' });
    if (!event) throw new Error('Missing mint evidence.');
    const id = event.args.tokenId;
    if (id !== BigInt(journal.seed.firstTokenId) + BigInt(i)) throw new Error('Unexpected token ID; concurrent mint detected.');
    journal.seed.tickets[i] = { tokenId: id.toString(), owner: accounts[group].address, sessionId: classes[group][0], sectionId: classes[group][1], row: 1, seat: i % 4 + 1 };
    save();
  }
  const components = artifacts.IntentRegistry.abi.find(item => item.name === 'commit').inputs[0].components;
  const types = { Intent: components.map(({ name, type }) => ({ name, type })) };
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    const offered = journal.seed.tickets.slice(i * 4, i * 4 + 4).map(t => BigInt(t.tokenId));
    await write(`seed:approveNFT:${i}`, 'TicketNFT', 'setApprovalForAll', [journal.contracts.Escrow, true], account);
    await write(`seed:deposit:${i}`, 'Escrow', 'deposit', [offered], account, 1000000n);
    await transact(`seed:approveUSDC:${i}`, account, { to: usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [journal.contracts.Settlement, 500000n] }), gas: 200000n });
    const target = classes[(i + 1) % classes.length];
    const intent = { owner: account.address, offered, eventId: 1, sessionMask: 1n << BigInt(target[0]), sectionMask: 1n << BigInt(target[1]), exactCount: 4, mustShareSession: true, mustShareSection: true, mustBeAdjacent: true, maxNetPay: [100000n, 0n, -100000n][i], deadline: BigInt(journal.seed.deadline), nonce: 0n };
    const hash = await read('IntentRegistry', 'hashIntent', [intent]);
    if (hash !== hashStruct({ data: intent, primaryType: 'Intent', types })) throw new Error('TypeScript/Solidity intent hash mismatch.');
    const signature = await account.signTypedData({ domain: { name: 'RESHUFFLE', version: '1', chainId: chain.id, verifyingContract: journal.contracts.IntentRegistry }, types, primaryType: 'Intent', message: intent });
    // Permissionless relay: deployer pays commit gas for all owners.
    await write(`seed:commit:${i}`, 'IntentRegistry', 'commit', [intent, signature]);
    journal.seed.intents[i] = { hash, ...JSON.parse(json(intent)) };
    save();
  }
}
if (journal.seed?.intents.length === 3) {
  for (const intent of journal.seed.intents) {
    const state = await read('IntentRegistry', 'state', [intent.hash]);
    if (state !== 1) throw new Error(`Seed intent is no longer LIVE: ${intent.hash} (state ${state}). Existing outcomes will not be reset.`);
    if (BigInt(intent.deadline) < (await client.getBlock()).timestamp) throw new Error('Seed expired; create new signed intents.');
    for (const id of intent.offered) {
      if ((await read('Escrow', 'depositor', [BigInt(id)])).toLowerCase() !== intent.owner.toLowerCase()) throw new Error('Seed custody changed; existing outcomes will not be reset.');
      if ((await read('TicketNFT', 'ownerOf', [BigInt(id)])).toLowerCase() !== journal.contracts.Escrow.toLowerCase()) throw new Error('NFT is not in escrow.');
    }
  }
  journal.verified = { blockNumber: (await client.getBlockNumber()).toString(), ticketCount: journal.seed.tickets.length, liveIntentCount: journal.seed.intents.length };
  save();
}
publicManifest();
console.log(`Arc ${mode} complete. Public evidence: deployments/arc-testnet.json`);
