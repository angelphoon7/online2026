import assert from 'node:assert/strict';

export const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';

export async function queryGraph(endpoint, query, variables = {}) {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Graph HTTP ${response.status}`);
  return response.json();
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
