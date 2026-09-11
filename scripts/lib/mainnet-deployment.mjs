import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { encodeDeployData, encodeFunctionData, erc20Abi, getContractAddress, hashDomain, isAddress, keccak256, toHex } from 'viem';

export const names = ['TicketNFT', 'Escrow', 'IntentRegistry', 'Settlement'];
export const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, json(value), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}
const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();

export function validateConfig(config, rpc, rehearsal = false) {
  assert(config.officialParametersConfirmed, 'Mainnet parameters are unconfirmed. Complete config/arc-mainnet.json from official sources.');
  assert(Number.isSafeInteger(config.chainId) && config.chainId > 0, 'Missing chain ID');
  assert(/^0x[0-9a-fA-F]{64}$/.test(config.genesisHash ?? ''), 'Missing genesis hash');
  for (const field of ['usdc', 'deployer', 'issuer']) assert(isAddress(config[field] ?? '') && !/^0x0{40}$/i.test(config[field]), `Missing or invalid ${field}`);
  const url = new URL(rpc);
  if (rehearsal) {
    assert.equal(config.chainId, 31337, 'Rehearsal must use local chain 31337');
    assert(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Rehearsal requires loopback RPC');
  } else {
    assert(![5042002, 31337, 1337].includes(config.chainId), 'Testnet/local chain ID is not Arc Mainnet');
    assert(url.protocol === 'https:' && !/testnet|localhost|127\.0\.0\.1/i.test(url.hostname), 'Mainnet requires a reviewed HTTPS RPC');
    assert(new URL(config.explorerUrl).protocol === 'https:', 'Missing HTTPS explorer URL');
    assert(Array.isArray(config.sources) && config.sources.some(s => /^https:\/\/docs\.arc\.io\//.test(s)), 'Record official parameter sources');
  }
  assert(config.adminModelAcknowledged === true, 'Review the non-transferable, mutable admin model in MAINNET_READINESS.md');
  for (const field of ['maxFeePerGasWei', 'deployGasLimit', 'configureGasLimit']) assert(/^[1-9][0-9]*$/.test(config[field] ?? ''), `Set a positive ${field}`);
  assert(Number.isSafeInteger(config.confirmations) && config.confirmations >= 1, 'Set receipt confirmations');
}

export function loadArtifacts() {
  return Object.fromEntries(names.map(name => {
    const artifact = readJson(`out/${name}.sol/${name}.json`);
    const metadata = typeof artifact.metadata === 'string' ? JSON.parse(artifact.metadata) : artifact.metadata;
    assert(metadata.compiler.version.startsWith('0.8.36+'), 'Build with Solidity 0.8.36');
    assert.equal(metadata.settings.evmVersion, 'paris');
    assert.equal(metadata.settings.viaIR, true);
    assert.deepEqual(metadata.settings.optimizer, { enabled: true, runs: 200 });
    for (const [file, source] of Object.entries(metadata.sources)) {
      const contents = fs.readFileSync(file, 'utf8');
      // Foundry's source input normalizes Windows CRLF to LF.
      assert([contents, contents.replaceAll('\r\n', '\n')].some(text => keccak256(toHex(text)) === source.keccak256), `Stale artifact: ${file}; run forge build`);
    }
    return [name, artifact];
  }));
}

export async function preflight(client, config, executionChecks = true) {
  assert.equal(await client.getChainId(), config.chainId, 'RPC chain ID mismatch');
  assert.equal((await client.getBlock({ blockNumber: 0n })).hash, config.genesisHash, 'RPC genesis hash mismatch');
  assert(!(await client.getCode({ address: config.deployer }))?.replace('0x', ''), 'This deployer supports EOAs only; a factory/Safe changes admin ownership');
  assert.equal(Number(await client.readContract({ address: config.usdc, abi: erc20Abi, functionName: 'decimals' })), 6, 'Settlement requires six-decimal USDC');
  assert.equal(await client.readContract({ address: config.usdc, abi: erc20Abi, functionName: 'symbol' }), 'USDC', 'Unexpected settlement token symbol');
  // Metadata checks corroborate a reviewed address; they do not authenticate USDC.
  const block = await client.getBlock();
  assert(BigInt(config.deployGasLimit) <= block.gasLimit && BigInt(config.configureGasLimit) <= block.gasLimit, 'Configured gas cap exceeds the network block limit');
  if (executionChecks) assert(await client.getGasPrice() <= BigInt(config.maxFeePerGasWei), 'Current gas price exceeds operator fee ceiling');
  return { checkedAt: new Date().toISOString(), chainId: config.chainId, blockNumber: String(block.number), genesisHash: config.genesisHash };
}

export function makePlan(config, artifacts, nonce) {
  const contracts = Object.fromEntries(names.map((name, i) => [name, getContractAddress({ from: config.deployer, nonce: BigInt(nonce + i) })]));
  const steps = names.map((name, i) => {
    const args = name === 'Escrow' ? [contracts.TicketNFT] : name === 'Settlement' ? [contracts.IntentRegistry, contracts.Escrow, contracts.TicketNFT, config.usdc] : [];
    return { label: `deploy:${name}`, name, nonce: nonce + i, data: encodeDeployData({ abi: artifacts[name].abi, bytecode: artifacts[name].bytecode.object, args }), gas: config.deployGasLimit };
  });
  for (const [name, fn, arg] of [['Escrow', 'setSettlement', contracts.Settlement], ['IntentRegistry', 'setSettlement', contracts.Settlement], ['TicketNFT', 'registerIssuer', config.issuer]]) {
    steps.push({ label: `configure:${name}`, name, nonce: nonce + steps.length, to: contracts[name], data: encodeFunctionData({ abi: artifacts[name].abi, functionName: fn, args: [arg] }), gas: config.configureGasLimit });
  }
  return { contracts, steps };
}

// Compiler immutables are constructor-specific. Check all remaining bytes, then
// independently read every immutable's public getter (including EIP-712 domain).
export function checkRuntime(artifact, actual) {
  const expected = artifact.deployedBytecode.object;
  assert(actual && actual !== '0x' && actual.length === expected.length, 'Runtime bytecode size mismatch');
  const mask = value => {
    const bytes = Buffer.from(value.slice(2), 'hex');
    for (const refs of Object.values(artifact.deployedBytecode.immutableReferences ?? {})) for (const ref of refs) bytes.fill(0, ref.start, ref.start + ref.length);
    return bytes.toString('hex');
  };
  assert.equal(mask(actual), mask(expected), 'Runtime bytecode mismatch');
}

export async function verifyDeployment(client, config, artifacts, record) {
  assert.equal(record.configHash, keccak256(toHex(json(config))), 'Manifest configuration mismatch');
  const chain = await preflight(client, config, false);
  const blockNumber = BigInt(chain.blockNumber);
  const read = (name, functionName, args = []) => client.readContract({ address: record.contracts[name], abi: artifacts[name].abi, functionName, args, blockNumber });
  const runtimeHashes = {};
  assert.equal(record.transactions.length, 7, 'Expected four creates and three configuration transactions');
  const plan = makePlan(config, artifacts, record.startNonce);
  assert.deepEqual(record.contracts, plan.contracts, 'Unexpected CREATE addresses');
  for (const [i, step] of plan.steps.entries()) {
    const hash = record.transactions[i].hash;
    const receipt = await client.getTransactionReceipt({ hash });
    const tx = await client.getTransaction({ hash });
    assert.equal(receipt.status, 'success');
    assert(blockNumber - receipt.blockNumber + 1n >= BigInt(config.confirmations), 'Insufficient confirmations');
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    assert.equal(block.hash, receipt.blockHash);
    assert(block.transactions.includes(hash), 'Transaction absent from receipt block');
    assert(same(tx.from, config.deployer) && tx.chainId === config.chainId && tx.nonce === step.nonce, 'Transaction sender/network/nonce mismatch');
    assert.equal(tx.input, step.data, 'Deployment calldata mismatch');
    assert.equal(tx.value, 0n, 'Unexpected native value');
    assert.equal(tx.gas, BigInt(step.gas), 'Unexpected transaction gas cap');
    if (step.to) assert(same(tx.to, step.to));
    else assert(tx.to === null && same(receipt.contractAddress, record.contracts[step.name]), 'Creation address mismatch');
  }
  for (const name of names) {
    const code = await client.getCode({ address: record.contracts[name], blockNumber });
    checkRuntime(artifacts[name], code);
    runtimeHashes[name] = keccak256(code);
    if (name !== 'Settlement') assert(same(await read(name, 'admin'), config.deployer), 'Admin mismatch');
  }
  assert(same(await read('Escrow', 'ticketNFT'), record.contracts.TicketNFT));
  for (const name of ['Escrow', 'IntentRegistry']) assert(same(await read(name, 'settlement'), record.contracts.Settlement), 'Settlement permission mismatch');
  for (const [getter, address] of Object.entries({ registry: record.contracts.IntentRegistry, escrow: record.contracts.Escrow, ticketNFT: record.contracts.TicketNFT, usdc: config.usdc })) assert(same(await read('Settlement', getter), address), `Settlement ${getter} mismatch`);
  assert.equal(await read('TicketNFT', 'registeredIssuers', [config.issuer]), true);
  assert.equal(await read('IntentRegistry', 'DOMAIN_SEPARATOR'), hashDomain({ domain: { name: 'RESHUFFLE', version: '1', chainId: config.chainId, verifyingContract: record.contracts.IntentRegistry }, types: { EIP712Domain: [
    { name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' },
  ] } }));
  return { ...chain, runtimeHashes, status: 'verified', scope: 'deployment receipts, bytecode, wiring, issuer, admins and EIP-712 domain; not a security audit or app cutover' };
}

export async function deploy(client, wallet, config, artifacts, journalPath, manifestPath) {
  assert(same(wallet.account.address, config.deployer), 'Mainnet key/deployer mismatch');
  await preflight(client, config);
  const configHash = keccak256(toHex(json(config)));
  const artifactHash = keccak256(toHex(json(names.map(n => artifacts[n].bytecode.object))));
  let journal;
  if (fs.existsSync(journalPath)) {
    journal = readJson(journalPath);
    assert(journal.configHash === configHash && journal.artifactHash === artifactHash, 'Journal/config/artifact mismatch; inspect before resuming');
    assert.deepEqual({ contracts: journal.contracts, steps: journal.steps }, makePlan(config, artifacts, journal.startNonce), 'Saved plan differs from compiled deployment');
  } else {
    const startNonce = await client.getTransactionCount({ address: config.deployer, blockTag: 'pending' });
    const plan = makePlan(config, artifacts, startNonce);
    journal = { configHash, artifactHash, chainId: config.chainId, deployer: config.deployer, issuer: config.issuer, usdc: config.usdc, startNonce, ...plan, transactions: [] };
    writeJson(journalPath, journal);
  }
  for (const [i, step] of journal.steps.entries()) {
    let saved = journal.transactions[i];
    if (!saved) {
      assert.equal(await client.getTransactionCount({ address: config.deployer, blockTag: 'pending' }), step.nonce, 'Concurrent deployer transaction detected; stop and inspect');
      const request = { ...(step.to ? { to: step.to } : {}), data: step.data, gas: BigInt(step.gas), nonce: step.nonce, value: 0n };
      await client.call({ ...request, account: config.deployer });
      const prepared = await wallet.prepareTransactionRequest(request);
      const fee = prepared.maxFeePerGas ?? prepared.gasPrice;
      assert(fee && fee <= BigInt(config.maxFeePerGasWei), 'Prepared fee exceeds configured ceiling');
      assert(await client.getBalance({ address: config.deployer }) >= BigInt(step.gas) * fee, 'Insufficient native USDC for this transaction gas cap');
      const raw = await wallet.signTransaction(prepared);
      saved = { label: step.label, hash: keccak256(raw), raw };
      journal.transactions[i] = saved;
      writeJson(journalPath, journal); // Never sign a replacement automatically.
    }
    let receipt = await client.getTransactionReceipt({ hash: saved.hash }).catch(e => { if (e.name === 'TransactionReceiptNotFoundError') return null; throw e; });
    if (!receipt) {
      try { await client.sendRawTransaction({ serializedTransaction: saved.raw }); }
      catch (error) { if (!(await client.getTransaction({ hash: saved.hash }).catch(() => null))) throw error; }
    }
    receipt = await client.waitForTransactionReceipt({ hash: saved.hash, confirmations: config.confirmations, timeout: 120000 });
    assert.equal(receipt.status, 'success', `Reverted ${step.label}; do not reset the journal`);
    if (!step.to) assert(same(receipt.contractAddress, journal.contracts[step.name]), 'CREATE address mismatch');
    Object.assign(saved, { blockNumber: String(receipt.blockNumber), status: receipt.status, gasUsed: String(receipt.gasUsed) });
    writeJson(journalPath, journal);
    console.log(`${step.label}: ${saved.hash}`);
  }
  const record = { configHash, artifactHash, chainId: config.chainId, deployer: config.deployer, issuer: config.issuer, usdc: config.usdc, startNonce: journal.startNonce, contracts: journal.contracts,
    transactions: journal.transactions.map(({ label, hash, blockNumber, status, gasUsed }) => ({ label, hash, blockNumber, status, gasUsed })) };
  record.verification = await verifyDeployment(client, config, artifacts, record);
  writeJson(manifestPath, record);
  return record;
}
