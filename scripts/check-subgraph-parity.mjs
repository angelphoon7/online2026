// Audit the subgraph against Arc chain state.
//
//   node scripts/check-subgraph-parity.mjs [network] [--latest] [--limit N]
//
// "No promise without a check", applied to the indexer. The subgraph is how the solver
// discovers the pool, so a mapping bug or a decoding error would quietly change what the
// solver believes is on offer. Three independent things are verified here:
//
//   1. HASH BINDING. Every intent read from the subgraph is re-hashed off-chain with the same
//      hashIntent() used for signing, and must equal the id it is published under. The
//      registry keys on the bare struct hash, so this binds all twelve signed fields at once:
//      if the indexer altered any of them, the hash cannot match. This is the check that
//      makes a wrong intent impossible rather than merely unlikely.
//   2. INTENT STATE matches IntentRegistry.state().
//   3. TICKET custody, ownership and redemption match TicketNFT/Escrow.
//
// Reads are pinned to the subgraph's own indexed block so the two sides describe the same
// moment. Arc's public RPC may not serve historical eth_call; pass --latest to compare against
// the chain head instead, which is only sound while no transactions are in flight.
//
// Exit 0 = PASS. Paste the output into the README (plan 11-A).

import fs from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createPublicClient, http } from 'viem';
import { loadDeployment, deploymentName } from './lib/deployment.mjs';
import { hashIntent } from '../solver/dist/index.js';

if (fs.existsSync('.env')) loadEnvFile('.env');

const args = process.argv.slice(2);
const useLatest = args.includes('--latest');
const limitArg = args.indexOf('--limit');
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 1000;
const network = deploymentName(args.find((a) => !a.startsWith('--') && Number.isNaN(Number(a))));

const deployment = loadDeployment(network);
const subgraphUrl = deployment.subgraphUrl;
if (!subgraphUrl) {
  console.log('FAIL no subgraphUrl — deploy first (npm run subgraph:deploy vX.Y.Z)');
  process.exit(1);
}

// State constants from IntentRegistry.
const STATE = { 0: 'NONE', 1: 'LIVE', 2: 'REVOKED', 3: 'SETTLED' };

const abiOf = (name) => JSON.parse(fs.readFileSync(`out/${name}.sol/${name}.json`, 'utf8')).abi;
const client = createPublicClient({
  transport: http(process.env.ARC_RPC ?? deployment.rpc, {
    timeout: 30000,
    retryCount: 3,
    retryDelay: 500,
    // No JSON-RPC batching: Arc's public endpoint rejects combined requests with
    // "Request exceeds defined limit". One call per request, throttled below instead.
  }),
});

/**
 * Map with bounded concurrency.
 *
 * Firing every read at once (hundreds, at this pool size) gets them dropped by the public RPC,
 * which then looks exactly like a parity failure. Failures are returned rather than thrown so
 * one dropped read cannot be mistaken for a mismatch.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function mapLimit(items, concurrency, fn, attempts = 7) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      let lastError = null;
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          results[index] = { ok: true, value: await fn(items[index], index) };
          lastError = null;
          break;
        } catch (error) {
          lastError = (error.shortMessage ?? error.message).split('\n')[0];
          // Rate limiting is transient; back off and retry rather than reporting a mismatch.
          await sleep(250 * 2 ** attempt);
        }
      }
      if (lastError !== null) results[index] = { ok: false, error: lastError };
    }
  });
  await Promise.all(workers);
  return results;
}

async function gql(query, variables = {}) {
  const response = await fetch(subgraphUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.SUBGRAPH_API_KEY ? { authorization: `Bearer ${process.env.SUBGRAPH_API_KEY}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data;
}

const data = await gql(`query Parity($limit: Int!) {
  _meta { block { number } hasIndexingErrors deployment }
  intents(first: $limit) {
    id owner eventId offered sessionMask sectionMask exactCount
    mustShareSession mustShareSection mustBeAdjacent maxNetPay deadline nonce state
  }
  tickets(first: $limit) { id owner depositor escrowed redeemed eventId sessionId sectionId row seat }
}`, { limit });

const indexedBlock = BigInt(data._meta.block.number);
const chainHead = await client.getBlockNumber();

// Pin both sides to the same block where the RPC allows it.
let readBlock = indexedBlock;
let pinned = true;
if (useLatest) {
  readBlock = chainHead;
  pinned = false;
} else {
  try {
    await client.readContract({
      address: deployment.contracts.TicketNFT.address,
      abi: abiOf('TicketNFT'),
      functionName: 'nextTokenId',
      blockNumber: indexedBlock,
    });
  } catch {
    console.log(`note: RPC will not serve historical eth_call at block ${indexedBlock}; comparing against the chain head instead.`);
    readBlock = chainHead;
    pinned = false;
  }
}

let pass = 0;
const failures = [];
const check = (ok, message) => (ok ? pass++ : failures.push(message));

console.log(`subgraph  ${subgraphUrl}`);
console.log(`deployment ${data._meta.deployment}`);
console.log(`indexed block ${indexedBlock}, chain head ${chainHead}, lag ${chainHead - indexedBlock} blocks`);
console.log(`comparing at block ${readBlock}${pinned ? ' (pinned to the indexed block)' : ' (chain head — not pinned)'}`);
console.log(`intents ${data.intents.length}, tickets ${data.tickets.length}`);

check(data._meta.hasIndexingErrors === false, 'subgraph reports hasIndexingErrors=true');

// ── 1. hash binding ──────────────────────────────────────────────────────────
let hashChecked = 0;
for (const g of data.intents) {
  const intent = {
    owner: g.owner,
    eventId: Number(g.eventId),
    offered: g.offered.map(BigInt),
    sessionMask: BigInt(g.sessionMask),
    sectionMask: BigInt(g.sectionMask),
    exactCount: Number(g.exactCount),
    mustShareSession: g.mustShareSession,
    mustShareSection: g.mustShareSection,
    mustBeAdjacent: g.mustBeAdjacent,
    maxNetPay: BigInt(g.maxNetPay),
    deadline: BigInt(g.deadline),
    nonce: BigInt(g.nonce),
  };
  const recomputed = hashIntent(intent);
  check(recomputed === g.id, `hash binding: ${g.id} re-hashes to ${recomputed}`);
  hashChecked++;
}

// ── 2. intent state ──────────────────────────────────────────────────────────
const registryAbi = abiOf('IntentRegistry');
const CONCURRENCY = Number(process.env.PARITY_CONCURRENCY ?? 2);

const states = await mapLimit(data.intents, CONCURRENCY, (g) =>
  client.readContract({
    address: deployment.contracts.IntentRegistry.address,
    abi: registryAbi,
    functionName: 'state',
    args: [g.id],
    blockNumber: readBlock,
  })
);
data.intents.forEach((g, index) => {
  const result = states[index];
  if (!result.ok) {
    check(false, `state read failed for ${g.id}: ${result.error}`);
    return;
  }
  check(
    STATE[Number(result.value)] === g.state,
    `intent ${g.id}: chain=${STATE[Number(result.value)]} graph=${g.state}`
  );
});

// ── 3. ticket ownership, custody and redemption ──────────────────────────────
const ticketAbi = abiOf('TicketNFT');
const escrowAbi = abiOf('Escrow');
const ZERO = '0x0000000000000000000000000000000000000000';

const tickets = data.tickets;
// One pass per field, each throttled, rather than 3N reads in flight at once.
const owners = await mapLimit(tickets, CONCURRENCY, (t) =>
  client.readContract({ address: deployment.contracts.TicketNFT.address, abi: ticketAbi,
    functionName: 'ownerOf', args: [BigInt(t.id)], blockNumber: readBlock }));
const depositors = await mapLimit(tickets, CONCURRENCY, (t) =>
  client.readContract({ address: deployment.contracts.Escrow.address, abi: escrowAbi,
    functionName: 'depositor', args: [BigInt(t.id)], blockNumber: readBlock }));
// meta() rather than isRedeemed(): one call returns status AND the seat metadata, so the
// immutable fields the solver matches on (eventId/session/section/row/seat) get verified too,
// for the same number of requests.
const meta = await mapLimit(tickets, CONCURRENCY, (t) =>
  client.readContract({ address: deployment.contracts.TicketNFT.address, abi: ticketAbi,
    functionName: 'meta', args: [BigInt(t.id)], blockNumber: readBlock }));

const same = (a, b) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

tickets.forEach((t, index) => {
  if (!owners[index].ok) {
    check(false, `ownerOf read failed for ticket ${t.id}: ${owners[index].error}`);
    return;
  }
  check(same(owners[index].value, t.owner), `ticket ${t.id} owner: chain=${owners[index].value} graph=${t.owner}`);

  // Escrow holds the NFT while escrowed, and depositor[] is cleared on the way out.
  if (!depositors[index].ok) {
    check(false, `depositor read failed for ticket ${t.id}: ${depositors[index].error}`);
    return;
  }
  const chainDepositor = depositors[index].value;
  const chainEscrowed = !same(chainDepositor, ZERO);
  check(
    chainEscrowed === t.escrowed,
    `ticket ${t.id} escrowed: chain=${chainEscrowed} graph=${t.escrowed}`
  );
  if (chainEscrowed) {
    check(
      same(chainDepositor, t.depositor),
      `ticket ${t.id} depositor: chain=${chainDepositor} graph=${t.depositor}`
    );
  } else {
    check(t.depositor === null, `ticket ${t.id} depositor should be null when not escrowed, got ${t.depositor}`);
  }

  if (!meta[index].ok) {
    check(false, `meta read failed for ticket ${t.id}: ${meta[index].error}`);
    return;
  }
  // meta() -> (eventId, sessionId, sectionId, row, seat, status); REDEEMED = 1.
  const [eventId, sessionId, sectionId, row, seat, status] = meta[index].value;
  check((status === 1) === t.redeemed, `ticket ${t.id} redeemed: chain=${status === 1} graph=${t.redeemed}`);
  check(Number(eventId) === Number(t.eventId), `ticket ${t.id} eventId: chain=${eventId} graph=${t.eventId}`);
  check(Number(sessionId) === Number(t.sessionId), `ticket ${t.id} sessionId: chain=${sessionId} graph=${t.sessionId}`);
  check(Number(sectionId) === Number(t.sectionId), `ticket ${t.id} sectionId: chain=${sectionId} graph=${t.sectionId}`);
  check(Number(row) === Number(t.row), `ticket ${t.id} row: chain=${row} graph=${t.row}`);
  check(Number(seat) === Number(t.seat), `ticket ${t.id} seat: chain=${seat} graph=${t.seat}`);
});

console.log(`\nhash binding verified on ${hashChecked} intents`);
console.log();
if (failures.length === 0) {
  console.log(`PASS — ${pass} checks at block ${readBlock}: ${data.intents.length} intents, ${tickets.length} tickets`);
  process.exit(0);
}
for (const failure of failures.slice(0, 25)) console.log(`FAIL ${failure}`);
if (failures.length > 25) console.log(`… and ${failures.length - 25} more`);
console.log(`\n${pass} pass, ${failures.length} fail`);
process.exit(1);
