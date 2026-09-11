import fs from 'node:fs';
import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { createPublicClient, http, parseEventLogs, parseAbi } from 'viem';

loadEnvFile('.env');
const manifest = JSON.parse(fs.readFileSync('deployments/arc-testnet.json', 'utf8'));
const records = JSON.parse(fs.readFileSync('deployments/settlements.json', 'utf8'));
const abis = JSON.parse(fs.readFileSync('server/abis.json', 'utf8'));
const client = createPublicClient({ transport: http(process.env.ARC_RPC, { timeout: 20000, retryCount: 3, retryDelay: 500 }) });
assert.equal(await client.getChainId(), 5042002);
assert.equal(records.length, 10);
assert.equal(new Set(records.map(r => r.transactionHash)).size, 10);
const transferAbi = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const results = [];
for (const record of records) {
  const evidence = JSON.parse(fs.readFileSync(`deployments/settlements/${String(record.round).padStart(2, '0')}.json`, 'utf8'));
  const receipt = await client.getTransactionReceipt({ hash: record.transactionHash });
  assert.equal(receipt.status, 'success');
  const settlement = manifest.contracts.Settlement.toLowerCase();
  const events = parseEventLogs({ abi: abis.Settlement, eventName: 'Settled', logs: receipt.logs.filter(l => l.address.toLowerCase() === settlement) });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].args.intentHashes, evidence.proposal.legs.map(l => l.intentHash));
  assert.equal(events[0].args.participantCount, 3n);
  const payments = parseEventLogs({ abi: transferAbi, eventName: 'Transfer', logs: receipt.logs.filter(l => l.address.toLowerCase() === manifest.usdc.toLowerCase()) });
  const pulled = payments.filter(e => e.args.to.toLowerCase() === settlement).reduce((n, e) => n + e.args.value, 0n);
  const pushed = payments.filter(e => e.args.from.toLowerCase() === settlement).reduce((n, e) => n + e.args.value, 0n);
  const expected = evidence.proposal.legs.reduce((n, l) => n + (BigInt(l.netPayment) > 0n ? BigInt(l.netPayment) : 0n), 0n);
  assert.equal(pulled, expected);
  assert.equal(pushed, expected);
  const nftEvents = parseEventLogs({ abi: abis.TicketNFT, eventName: 'Transfer', logs: receipt.logs.filter(l => l.address.toLowerCase() === manifest.contracts.TicketNFT.toLowerCase()) });
  assert.equal(nftEvents.length, 12);
  for (let i = 0; i < evidence.proposal.legs.length; i++) {
    const intent = evidence.proposal.intents[i];
    for (const id of evidence.proposal.legs[i].receives) {
      assert(nftEvents.some(e => e.args.tokenId === BigInt(id) && e.args.to.toLowerCase() === intent.owner.toLowerCase() && e.args.from.toLowerCase() === manifest.contracts.Escrow.toLowerCase()));
    }
  }
  results.push({ round: record.round, transactionHash: record.transactionHash, blockNumber: receipt.blockNumber.toString(), participants: 3, ticketTransfers: nftEvents.length, usdcPulledBaseUnits: pulled.toString(), usdcPushedBaseUnits: pushed.toString(), status: 'verified' });
}
fs.writeFileSync('deployments/settlement-audit.json', JSON.stringify({ chainId: 5042002, checkedAt: new Date().toISOString(), results }, null, 2) + '\n');
console.log('Verified 10 distinct successful settlements, each with 12 ticket transfers and balanced USDC transfers.');
