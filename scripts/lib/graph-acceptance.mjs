import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadEnvFile } from 'node:process';

// Pick up SUBGRAPH_API_KEY from .env when the caller has not already loaded it. This does not
// change what these checks read - the query endpoint and its data are public either way - it
// only keeps an operator's own runs from being throttled. Without a .env the checks still run.
if (!process.env.SUBGRAPH_API_KEY && fs.existsSync('.env')) {
  try { loadEnvFile('.env'); } catch { /* a malformed .env must not fail a public check */ }
}

export const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';

// Studio's development endpoint rate limits unauthenticated callers, and these checks issue
// several large queries in a row. Two consequences, both handled here rather than in each
// caller:
//
//   - Send SUBGRAPH_API_KEY when the environment has one. The checks still run without it, so
//     a judge holding only the public URL can reproduce them; a key just avoids the throttle.
//   - Retry 429 and 5xx with backoff. A throttled request is a wait, not a failed check, and
//     reporting it as "the subgraph is broken" would be wrong.
export async function queryGraph(endpoint, query, variables = {}, { attempts = 4 } = {}) {
  const key = process.env.SUBGRAPH_API_KEY;
  let delay = 1000;
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20000),
    });
    if (response.ok) return response.json();

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= attempts) {
      const hint = response.status === 429
        ? ' — rate limited by the Graph endpoint. Set SUBGRAPH_API_KEY, or retry in a minute.'
        : '';
      throw new Error(`Graph HTTP ${response.status}${hint}`);
    }
    // Honour Retry-After when the endpoint sends one; otherwise back off exponentially.
    const after = Number(response.headers.get('retry-after'));
    const wait = Number.isFinite(after) && after > 0 ? after * 1000 : delay;
    await new Promise(r => setTimeout(r, wait));
    delay = Math.min(delay * 2, 8000);
  }
}

export function verifyIndexedTicket(data, { block, owner, tokenId, deployment }) {
  assert.equal(data._meta.hasIndexingErrors, false, 'Subgraph has indexing errors');
  assert.equal(data._meta.deployment, deployment, 'Different subgraph deployment');
  assert.ok(BigInt(data._meta.block.number) >= block, 'Snapshot is older than the receipt');
  assert.equal(data.ticket?.id, String(tokenId), 'Ticket is missing');
  assert.equal(data.ticket.owner.toLowerCase(), owner.toLowerCase(), 'Owner changed');
  assert.equal(data.ticket.escrowed, false, 'Ticket entered escrow');
  assert.equal(BigInt(data.ticket.updatedAtBlock), block, 'Transfer has not been indexed at the receipt block');
}

// Measured from receipt OBSERVATION, not the block timestamp. Poll/network time is included.
// The injectable clock makes timeout and timing semantics testable without a real transaction.
export async function observeIndexedTransfer({ read, expected, now = () => performance.now(), startedAt, sleep = ms => new Promise(r => setTimeout(r, ms)), timeoutMs = 90000 }) {
  const started = startedAt ?? now();
  const polls = [];
  let delay = 800;
  for (;;) {
    if (now() - started >= timeoutMs) throw new Error('ReceiptToIndexTimeout');
    const body = await read();
    const elapsedMs = Math.round(now() - started);
    if (elapsedMs >= timeoutMs) throw new Error('ReceiptToIndexTimeout');
    if (body.errors?.length) {
      const messages = body.errors.map(e => e.message).join('; ');
      const lag = messages.match(/has only indexed up to block (?:number )?(\d+)/i);
      if (!lag) throw new Error('Unexpected Graph error during transfer observation');
      polls.push({ elapsedMs, indexedBlock: lag[1], status: 'behind' });
    } else {
      verifyIndexedTicket(body.data, expected);
      polls.push({ elapsedMs, indexedBlock: String(body.data._meta.block.number), status: 'indexed' });
      return { receiptToIndexedObservedMs: elapsedMs, polls, indexed: body.data };
    }
    await sleep(Math.min(delay, Math.max(0, timeoutMs - (now() - started))));
    delay = Math.min(Math.round(delay * 1.5), 5000);
  }
}

export function verifySolveEvidence(evidence, minBlock) {
  assert.equal(evidence.source?.kind, 'subgraph', 'Solver did not use The Graph');
  assert.ok(evidence.source.subgraphEndpoint, 'Missing source endpoint');
  assert.ok(BigInt(evidence.source.snapshotBlock) >= minBlock, 'Solver snapshot predates requested floor');
  assert.equal(evidence.snapshotBlock, evidence.source.snapshotBlock);
  assert.equal(evidence.pool?.snapshotBlock, evidence.source.snapshotBlock);
  assert.ok(evidence.intentsConsidered >= 2, 'No meaningful pool was searched');
  assert.ok(evidence.candidatesFound > 0, 'No candidate found for this demonstration');
  assert.equal(evidence.candidates.length, evidence.candidatesFound);
  assert.deepEqual(evidence.excluded, evidence.candidatesExcluded);
  assert.equal(evidence.simulationResult?.success, true, 'Candidate did not pass chain simulation');
  assert.ok(evidence.proposal?.intents?.length >= 2, 'Missing proposal');
  assert.ok(evidence.transaction?.data?.startsWith('0x'), 'Missing simulated calldata');
  assert.ok(evidence.bounds?.maxParticipants && evidence.bounds?.maxCandidates && evidence.bounds?.timeoutMs, 'Missing bounds');
}
