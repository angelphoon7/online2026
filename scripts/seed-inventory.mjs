// Arc Testnet inventory only. Reruns resume the same signed transactions.
import fs from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createPublicClient, createWalletClient, defineChain, http, encodeFunctionData, parseEventLogs, hashStruct, hashDomain, keccak256, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import abis from '../server/abis.json' with { type: 'json' };
import { loadDeployment } from './lib/deployment.mjs';

const mode = process.argv[2] ?? '--check';
const batch = process.argv[3] ?? 'default';
// An explicit count selects varied requests; old commands retain their original plan.
const varied = process.argv[4] !== undefined;
const bundleCount = Number(process.argv[4] ?? 2);
const bundlesPerCell = bundleCount === 2 ? 4 : 1;
const seatsPerCell = bundleCount * bundlesPerCell;
const totalTickets = seatsPerCell * 8;
const totalIntents = bundlesPerCell * 8;
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v, 2) + '\n';
const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();
const fail = message => { throw new Error(`Inventory: ${message}`); };
const writeJson = (path, value) => { fs.writeFileSync(`${path}.tmp`, json(value), { mode: 0o600 }); fs.renameSync(`${path}.tmp`, path); };
const suffix = batch === 'default' ? '' : `-${batch}`;
const journalPath = `.data/section-inventory${suffix}.json`;
const manifestPath = `deployments/section-inventory${suffix}.json`;
const lockPath = '.data/demo-tickets/issuer.lock';
const types = { Intent: abis.IntentRegistry.find(entry => entry.name === 'commit').inputs[0].components.map(({ name, type }) => ({ name, type })) };
const restore = intent => ({ ...intent, offered: intent.offered.map(BigInt), ...Object.fromEntries(['sessionMask', 'sectionMask', 'maxNetPay', 'deadline', 'nonce'].map(key => [key, BigInt(intent[key])])) });

async function main() {
  if (!['--check', '--broadcast', '--verify'].includes(mode) || process.argv.length > 5 || ![1, 2, 3].includes(bundleCount) || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(batch)) fail('Use --check, --broadcast or --verify, optionally followed by a batch name and bundle count (1, 2 or 3).');
  loadEnvFile('.env');
  const deployment = loadDeployment('arc-testnet').raw;
  const addresses = deployment.contracts;
  const account = privateKeyToAccount(process.env.DEMO_ISSUER_PRIVATE_KEY || process.env.PRIVATE_KEY);
  if (process.env.ARC_CHAIN_ID !== '5042002' || !same(process.env.USDC_ADDRESS, deployment.usdc)) fail('Arc Testnet configuration required.');
  if (process.env.NEXT_PUBLIC_DEPLOYMENT && process.env.NEXT_PUBLIC_DEPLOYMENT !== 'arc-testnet') fail('Frontend must select arc-testnet.');
  for (const [contract, env] of Object.entries({ TicketNFT: 'TICKET_NFT', Escrow: 'ESCROW', IntentRegistry: 'INTENT_REGISTRY', Settlement: 'SETTLEMENT' })) {
    const override = process.env[`NEXT_PUBLIC_${env}`];
    if (override && !same(addresses[contract], override)) fail(`Frontend/deployment mismatch: ${contract}.`);
  }
  const chain = defineChain({ id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [process.env.ARC_RPC] } } });
  const transport = http(process.env.ARC_RPC, { timeout: 20000, retryCount: 2 });
  const client = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });
  const read = async (contract, functionName, args = [], blockNumber) => {
    for (let attempt = 0; ; attempt++) {
      try { return await client.readContract({ address: addresses[contract], abi: abis[contract], functionName, args, blockNumber }); }
      catch (error) {
        let transient = false;
        for (let cause = error; cause; cause = cause.cause) {
          if (['HttpRequestError', 'RpcRequestError', 'InternalRpcError', 'InvalidInputRpcError', 'UnknownRpcError', 'BlockNotFoundError', 'LimitExceededRpcError'].includes(cause.name)) transient = true;
          if (cause.name === 'ContractFunctionRevertedError') throw error;
        }
        if (!transient || attempt >= 3) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  };
  if (await client.getChainId() !== chain.id) fail('RPC returned a different chain.');
  if (!await read('TicketNFT', 'registeredIssuers', [account.address])) fail('Configured wallet is not a registered issuer.');
  for (const [getter, expected] of Object.entries({ ticketNFT: addresses.TicketNFT, escrow: addresses.Escrow, registry: addresses.IntentRegistry, usdc: deployment.usdc })) {
    if (!same(await read('Settlement', getter), expected)) fail(`Settlement wiring mismatch: ${getter}.`);
  }
  for (const name of ['Escrow', 'IntentRegistry']) if (!same(await read(name, 'settlement'), addresses.Settlement)) fail(`${name} settlement mismatch.`);
  const domain = { name: 'RESHUFFLE', version: '1', chainId: chain.id, verifyingContract: addresses.IntentRegistry };
  const domainTypes = { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }] };
  if (!same(await read('IntentRegistry', 'DOMAIN_SEPARATOR'), hashDomain({ domain, types: domainTypes }))) fail('EIP-712 domain mismatch.');
  const starts = [process.env.NEXT_PUBLIC_SESSION_0_START || '2026-09-19T20:00:00+08:00', process.env.NEXT_PUBLIC_SESSION_1_START || '2026-09-20T20:00:00+08:00'];
  const cutoffSeconds = starts.map(start => Date.parse(start) / 1000 - 8 * 3600);
  if (cutoffSeconds.some(value => !Number.isSafeInteger(value))) fail('Invalid session schedule.');
  const deadline = BigInt(Math.min(...cutoffSeconds));
  const [block, nextId, balance] = await Promise.all([client.getBlock(), read('TicketNFT', 'nextTokenId'), client.getBalance({ address: account.address })]);
  let journal = fs.existsSync(journalPath) ? JSON.parse(fs.readFileSync(journalPath, 'utf8')) : null;
  if (journal && ((journal.batch ?? 'default') !== batch || journal.chainId !== chain.id || !same(journal.issuer, account.address) || json(journal.contracts) !== json(addresses))) fail('Saved inventory belongs to another batch/issuer/deployment.');
  if (journal && ((journal.bundleCount ?? 2) !== bundleCount || (journal.varied ?? false) !== varied)) fail('Saved inventory uses a different count/request profile. Resume with the original arguments.');
  console.log(`Batch ${batch}, Arc ${chain.id}: ${nextId} existing tickets; issuer ${account.address}; ${formatEther(balance)} native USDC.`);
  if (mode === '--check') {
    console.log(journal ? 'Saved inventory exists; --broadcast resumes it without creating a second batch.' : `Plan: ${totalTickets} tickets, ${seatsPerCell} per section/session, ${totalIntents} offers receiving exactly ${bundleCount}. Sessions 0/1; sections 0/1/2/3.`);
    console.log(`Issuer replacement inventory, maxNetPay=0; ${varied ? 'varied session/section requests' : 'either session/any section'}. Deadline ${new Date(Number(deadline) * 1000).toISOString()}. Total transaction fee ceiling: 5 test USDC.`);
    if (deadline <= block.timestamp) fail('Demo session cutoff has passed.');
    if (!journal && nextId + BigInt(totalTickets) >= 1000n) fail('Inventory would exceed public discovery capacity.');
    return;
  }
  if (mode === '--verify' && !journal) fail('No inventory journal exists.');
  fs.mkdirSync('.data/demo-tickets', { recursive: true });
  let lock;
  if (mode === '--broadcast') {
    try { lock = fs.openSync(lockPath, 'wx'); } catch { fail('Issuer is busy. Retry after the current claim/seed completes.'); }
  }
  try {
    if (mode === '--broadcast') {
      if (deadline <= block.timestamp + 3600n) fail('Session cutoff is too close or has passed.');
      if (!journal) {
        if (nextId + BigInt(totalTickets) >= 1000n || balance < parseEther('5')) fail('Need inventory capacity and 5 test USDC for the fee ceiling.');
        journal = { batch, bundleCount, varied, chainId: chain.id, issuer: account.address, contracts: addresses, deadline: String(deadline), rowBase: 20000 + Number(nextId), steps: {}, tickets: [], intents: [] };
        writeJson(journalPath, journal);
      }
      if (BigInt(journal.deadline) <= block.timestamp + 3600n) fail('Saved offers have expired; inspect their state before creating a new batch.');
      const save = () => writeJson(journalPath, journal);
      async function transact(label, contract, functionName, args, gas) {
        let step = journal.steps[label];
        if (!step) {
          await client.simulateContract({ account, address: addresses[contract], abi: abis[contract], functionName, args, gas });
          const request = await wallet.prepareTransactionRequest({ to: addresses[contract], data: encodeFunctionData({ abi: abis[contract], functionName, args }), gas });
          const feeCeiling = request.gas * (request.maxFeePerGas ?? request.gasPrice ?? 0n);
          const totalCeiling = Object.values(journal.steps).reduce((sum, item) => sum + BigInt(item.feeCeiling), feeCeiling);
          if (feeCeiling <= 0n || feeCeiling > parseEther('0.1') || totalCeiling > parseEther('5')) fail('Transaction fee ceiling exceeded.');
          const raw = await wallet.signTransaction(request);
          step = journal.steps[label] = { hash: keccak256(raw), raw, feeCeiling: String(feeCeiling) };
          save(); // Persist signed bytes before broadcasting, including mints.
        }
        let receipt = await client.getTransactionReceipt({ hash: step.hash }).catch(error => {
          if (error.name === 'TransactionReceiptNotFoundError') return null;
          throw error;
        });
        if (!receipt) {
          await client.sendRawTransaction({ serializedTransaction: step.raw }).catch(async error => {
            if (!await client.getTransaction({ hash: step.hash }).catch(() => null)) throw error;
          });
          receipt = await client.waitForTransactionReceipt({ hash: step.hash, timeout: 60000, pollingInterval: 1000 });
        }
        Object.assign(step, { status: receipt.status, blockNumber: String(receipt.blockNumber), gasUsed: String(receipt.gasUsed), feePaid: String(receipt.gasUsed * receipt.effectiveGasPrice) });
        save();
        if (receipt.status !== 'success') fail(`${label} reverted: ${step.hash}.`);
        console.log(`${label}: ${step.hash}`);
        return receipt;
      }
      let nonce = varied ? BigInt(journal.rowBase) * 1000n : 0n;
      for (let session = 0; session < 2; session++) for (let section = 0; section < 4; section++) {
        const ids = [];
        for (let seat = 1; seat <= seatsPerCell; seat++) {
          const label = `mint:${session}:${section}:${seat}`;
          let ticket = journal.tickets.find(t => t.label === label);
          if (!ticket) {
            const row = journal.rowBase + session * 4 + section;
            const receipt = await transact(label, 'TicketNFT', 'mint', [account.address, 1, session, section, row, seat], 350000n);
            const logs = parseEventLogs({ abi: abis.TicketNFT, eventName: 'TicketMinted', logs: receipt.logs.filter(log => same(log.address, addresses.TicketNFT)) });
            if (logs.length !== 1 || !same(logs[0].args.to, account.address)) fail('Unexpected mint receipt.');
            ticket = { label, tokenId: String(logs[0].args.tokenId), eventId: 1, sessionId: session, sectionId: section, row, seat, mintTx: receipt.transactionHash };
            journal.tickets.push(ticket); save();
          }
          ids.push(BigInt(ticket.tokenId));
        }
        if (!await read('TicketNFT', 'isApprovedForAll', [account.address, addresses.Escrow])) await transact('approve:escrow', 'TicketNFT', 'setApprovalForAll', [addresses.Escrow, true], 150000n);
        const depositLabel = `deposit:${session}:${section}`;
        if (!journal.steps[depositLabel] || journal.steps[depositLabel].status !== 'success') await transact(depositLabel, 'Escrow', 'deposit', [ids], 1500000n);
        for (let pair = 0; pair < bundlesPerCell; pair++) {
          const label = `commit:${session}:${section}:${pair}`;
          let record = journal.intents.find(i => i.label === label);
          if (!record) {
            while (await read('IntentRegistry', 'usedNonce', [account.address, nonce])) nonce++;
            // Each request describes acceptable outcomes; the solver chooses the actual seats.
            const policies = [
              { sessionMask: 1n << BigInt(1 - session), sectionMask: 1n << BigInt(section) },
              { sessionMask: 3n, sectionMask: 1n << BigInt(section) },
              { sessionMask: 1n << BigInt(session), sectionMask: 1n << BigInt(section ^ 1) },
              { sessionMask: 3n, sectionMask: 15n },
            ];
            const policy = varied ? policies[pair] : policies[3];
            const intent = { owner: account.address, offered: ids.slice(pair * bundleCount, (pair + 1) * bundleCount), eventId: 1, ...policy, exactCount: bundleCount, mustShareSession: true, mustShareSection: true, mustBeAdjacent: bundleCount >= 2, maxNetPay: 0n, deadline: BigInt(journal.deadline), nonce };
            const hash = hashStruct({ data: intent, primaryType: 'Intent', types });
            if (!same(hash, await read('IntentRegistry', 'hashIntent', [intent]))) fail('Intent hash mismatch.');
            record = { label, hash, intent: JSON.parse(json(intent)) };
            journal.intents.push(record); save(); nonce++;
          }
          if (journal.steps[label]?.status === 'success') continue;
          const intent = restore(record.intent);
          const signature = await account.signTypedData({ domain, types, primaryType: 'Intent', message: intent });
          await transact(label, 'IntentRegistry', 'commit', [intent, signature], 600000n);
        }
        console.log(`Prepared session ${session}, section ${section}: ${seatsPerCell} tickets / ${bundlesPerCell} offers.`);
      }
    }
    const checkedBlock = await client.getBlock();
    const ticketStates = [];
    for (const ticket of journal.tickets) {
      const id = BigInt(ticket.tokenId);
      const [owner, depositor, meta] = await Promise.all([read('TicketNFT', 'ownerOf', [id], checkedBlock.number), read('Escrow', 'depositor', [id], checkedBlock.number), read('TicketNFT', 'meta', [id], checkedBlock.number)]);
      if (meta.slice(0, 5).some((value, n) => value !== [ticket.eventId, ticket.sessionId, ticket.sectionId, ticket.row, ticket.seat][n])) fail('Minted metadata differs from the recorded plan.');
      ticketStates.push({ ...ticket, owner, depositor, status: meta[5] });
    }
    const intents = [];
    for (const record of journal.intents) {
      const state = await read('IntentRegistry', 'state', [record.hash], checkedBlock.number);
      const offered = ticketStates.filter(t => record.intent.offered.includes(t.tokenId));
      const available = state === 1 && BigInt(record.intent.deadline) >= checkedBlock.timestamp && offered.length === bundleCount && offered.every(t => t.status === 0 && same(t.owner, addresses.Escrow) && same(t.depositor, account.address));
      intents.push({ ...record.intent, hash: record.hash, state, available, commitTx: journal.steps[record.label]?.hash });
    }
    const cells = [];
    for (let session = 0; session < 2; session++) for (let section = 0; section < 4; section++) {
      const cellIds = ticketStates.filter(t => t.sessionId === session && t.sectionId === section).map(t => t.tokenId);
      const liveIds = new Set(intents.filter(i => i.available).flatMap(i => i.offered));
      cells.push({ session, section, minted: cellIds.length, offered: cellIds.filter(id => liveIds.has(id)).length });
    }
    const transactions = Object.entries(journal.steps).map(([label, step]) => ({ label, hash: step.hash, status: step.status, blockNumber: step.blockNumber, gasUsed: step.gasUsed, feePaid: step.feePaid }));
    const feePaid = transactions.reduce((total, tx) => total + BigInt(tx.feePaid ?? '0'), 0n);
    writeJson(manifestPath, { batch, bundleCount, varied, chainId: chain.id, issuer: account.address, contracts: addresses, checkedBlock: String(checkedBlock.number), checkedAt: new Date().toISOString(), deadline: journal.deadline, cells, tickets: ticketStates, intents, transactions, totalFeeUSDC: formatEther(feePaid) });
    console.log(json({ checkedBlock: String(checkedBlock.number), cells, liveOffers: intents.filter(i => i.available).length, transactions: transactions.length, totalFeeUSDC: formatEther(feePaid), manifest: manifestPath }));
    if (ticketStates.length !== totalTickets || intents.length !== totalIntents || cells.some(cell => cell.offered !== seatsPerCell)) fail('Inventory is incomplete or some offers are no longer available; see the verified manifest.');
  } finally {
    if (lock !== undefined) { fs.closeSync(lock); fs.unlinkSync(lockPath); }
  }
}

main().catch(error => {
  console.error(error.message?.startsWith('Inventory:') ? error.message : `Inventory seed failed (${error.name}). Check RPC connectivity and rerun the same command to resume.`);
  if (!error.message?.startsWith('Inventory:')) {
    const causes = [];
    for (let cause = error; cause && causes.length < 8; cause = cause.cause) causes.push({ name: cause.name, code: cause.code, status: cause.status });
    console.error(json({ causes })); // Deliberately exclude URLs, request bodies and signatures.
  }
  process.exitCode = 1;
});
