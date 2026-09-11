import assert from 'node:assert/strict';
import { decodeFunctionData, recoverTypedDataAddress } from 'viem';
import abis from '../../server/abis.json' with { type: 'json' };
import { auditActOne } from './act-one-proof.mjs';
import { hashIntent } from '../../solver/dist/index.js';

export function checkLifecycle(record) {
  const { closure, participantProcess, solverProcess } = record;
  assert.equal(closure.exitCode, 0, 'Browser exit not confirmed');
  assert.equal(participantProcess.exitCode, 0, 'Participant process exit not confirmed');
  const times = [closure.requestedAt, closure.exitedAt, closure.signingServerClosedAt, participantProcess.exitedAt, solverProcess.startedAt].map(Date.parse);
  assert(times.every(Number.isFinite), 'Missing lifecycle timestamp');
  assert(times.every((t, i) => i === 0 || t >= times[i - 1]), 'Solver must start after browser and participant process exit');
  assert.notEqual(participantProcess.pid, solverProcess.pid, 'Solver must be a separate process');
  assert.equal(closure.authorizations.length, 3);
  assert.equal(new Set(closure.authorizations.map(a => a.owner.toLowerCase())).size, 3);
  return true;
}

export function checkNonceUnchanged(expected, atClose, atSettlement) {
  assert.equal(atClose, expected, 'Recorded ready nonce differs from chain');
  assert.equal(atSettlement, atClose, 'Participant sent another transaction after authorization');
}

export async function auditOffline(client, deployment, record) {
  checkLifecycle(record);
  assert.equal(record.chainId, 5042002);
  assert.equal(record.settlement.toLowerCase(), deployment.contracts.Settlement.toLowerCase());
  const proof = await auditActOne(client, deployment, record.evidence, record.transactionHash);
  const settlementBlock = BigInt(proof.blockNumber);
  const readyBlock = BigInt(record.readyBlock);
  assert(readyBlock < settlementBlock, 'Settlement must follow authorization');
  assert(BigInt(record.evidence.source.blockNumber) >= readyBlock, 'Solver snapshot predates browser authorization');
  const tx = await client.getTransaction({ hash: record.transactionHash });
  const decoded = decodeFunctionData({ abi: abis.Settlement, data: tx.input });
  assert.equal(decoded.functionName, 'settle');
  assert.equal(decoded.args.length, 2, 'Settlement should receive only intents and legs');
  assert.equal(tx.from.toLowerCase(), record.solverProcess.address.toLowerCase());
  assert(record.participants.every(p => p.owner.toLowerCase() !== tx.from.toLowerCase()), 'Proposer must be independent of all participants');
  const types = { Intent: abis.IntentRegistry.find(a => a.name === 'commit').inputs[0].components.map(({ name, type }) => ({ name, type })) };
  assert.equal(record.participants.length, 3);
  assert.deepEqual(record.participants.map(p => p.intentHash).sort(), proof.participants.map(p => p.intentHash).sort());
  const authorizations = [];
  for (const participant of record.participants) {
    const [commit, receipt] = await Promise.all([
      client.getTransaction({ hash: participant.commitTransactionHash }),
      client.getTransactionReceipt({ hash: participant.commitTransactionHash }),
    ]);
    assert.equal(receipt.status, 'success');
    assert(receipt.blockNumber <= readyBlock);
    assert.equal(commit.to.toLowerCase(), deployment.contracts.IntentRegistry.toLowerCase());
    const call = decodeFunctionData({ abi: abis.IntentRegistry, data: commit.input });
    assert.equal(call.functionName, 'commit');
    const [intent, signature] = call.args;
    assert.equal(hashIntent(intent), participant.intentHash);
    assert.equal(intent.owner.toLowerCase(), participant.owner.toLowerCase());
    const recovered = await recoverTypedDataAddress({ domain: { name: 'RESHUFFLE', version: '1', chainId: 5042002, verifyingContract: deployment.contracts.IntentRegistry }, types, primaryType: 'Intent', message: intent, signature });
    assert.equal(recovered.toLowerCase(), participant.owner.toLowerCase(), 'Commit signature must recover participant');
    const local = record.closure.authorizations.find(a => a.intentHash === participant.intentHash);
    assert(local && local.owner.toLowerCase() === participant.owner.toLowerCase() && local.transactionHash === participant.commitTransactionHash, 'Browser authorization differs from chain');
    const [atClose, atSettlement, live] = await Promise.all([
      client.getTransactionCount({ address: participant.owner, blockNumber: readyBlock }),
      client.getTransactionCount({ address: participant.owner, blockNumber: settlementBlock }),
      client.readContract({ address: deployment.contracts.IntentRegistry, abi: abis.IntentRegistry, functionName: 'state', args: [participant.intentHash], blockNumber: readyBlock }),
    ]);
    assert.equal(Number(live), 1, 'Intent was not LIVE at closure boundary');
    checkNonceUnchanged(participant.nonceAtClose, atClose, atSettlement);
    authorizations.push({ ...participant, commitBlock: String(receipt.blockNumber), nonceAtSettlement: atSettlement, signatureRecovered: recovered });
  }
  return { ...proof, proposer: tx.from, authorizations, settlementArguments: ['intents', 'legs'], readyBlock: String(readyBlock) };
}
