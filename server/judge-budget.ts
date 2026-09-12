import 'server-only';
import { createWalletClient, defineChain, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'node:fs';
import { chainConfig, abi } from './chain';
import { graphPool } from './solve-graph';
import { hashIntent } from '@/shared/intent';
import type { Intent } from '../solver/src/types';
import { DEPLOYMENT } from '@/lib/deployment';

// Judge control: change a participant's budget — step 6-D of docs/RESHUFFLE_GRAPH_PLAN.md.
//
// This MUST be a real on-chain change, not frontend state. The whole point of the demo beat is
// that a judge alters a condition, the subgraph observes it, and the agent's answer changes.
// If the budget only moved in the browser, the subgraph would never see it, the agent would
// repeat its previous answer, and the demo would quietly be theatre.
//
// A budget change is two transactions, because maxNetPay is a SIGNED field of the intent and
// the intent hash covers it: there is no "edit". The old intent is revoked and a new one is
// committed under a new hash.
//
//   revoke(oldHash)         owner-only
//   commit(newIntent, sig)  permissionless relay; the EIP-712 signature authenticates the owner
//
// Nonces are reserved at commit and never released, so revoking does not return one — the new
// intent needs an unused nonce.
//
// Keys: demo participant keys live in .env.seed, server-side only. They never reach the bundle.

export class JudgeControlError extends Error {
  confirmed?: { blockNumber: string; hashes: Hex[] };
  constructor(message: string, public status = 400) {
    super(message);
    this.name = 'JudgeControlError';
  }
}

const network = defineChain({
  id: DEPLOYMENT.chainId,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARC_RPC ?? DEPLOYMENT.rpc] } },
});

const EIP712_TYPES = {
  Intent: [
    { name: 'owner', type: 'address' },
    { name: 'offered', type: 'uint256[]' },
    { name: 'eventId', type: 'uint32' },
    { name: 'sessionMask', type: 'uint256' },
    { name: 'sectionMask', type: 'uint256' },
    { name: 'exactCount', type: 'uint8' },
    { name: 'mustShareSession', type: 'bool' },
    { name: 'mustShareSection', type: 'bool' },
    { name: 'mustBeAdjacent', type: 'bool' },
    { name: 'maxNetPay', type: 'int256' },
    { name: 'deadline', type: 'uint64' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

// Next loads .env and .env.local, but not .env.seed, so the demo participant keys have to be
// read explicitly. Server-side only; these never reach the client bundle.
const NEWLINE = String.fromCharCode(10);
let seedLoaded = false;
function loadSeedKeys() {
  if (seedLoaded) return;
  seedLoaded = true;
  try {
    for (const line of readFileSync('.env.seed', 'utf8').split(NEWLINE)) {
      const match = line.match(/^\s*(SEED_[A-Z]_PRIVATE_KEY)\s*=\s*(0x[\da-fA-F]{64})\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    /* No seed file: only the operator key is available. */
  }
}

/**
 * Keys the server can sign with, by address.
 *
 * SEED_*_PRIVATE_KEY are the demo participants; PRIVATE_KEY is the operator, which also
 * committed intents during seeding and so owns most of the pool.
 */
export function participantKeys(): Map<Address, ReturnType<typeof privateKeyToAccount>> {
  loadSeedKeys();
  const keys = new Map<Address, ReturnType<typeof privateKeyToAccount>>();
  for (const [name, value] of Object.entries(process.env)) {
    if (!/^(SEED_[A-Z]_PRIVATE_KEY|PRIVATE_KEY)$/.test(name)) continue;
    if (!value || !/^0x[\da-f]{64}$/i.test(value)) continue;
    const account = privateKeyToAccount(value as Hex);
    keys.set(account.address.toLowerCase() as Address, account);
  }
  return keys;
}

export function judgeControlsEnabled(): boolean {
  return process.env.JUDGE_CONTROLS_ENABLED === 'true' || process.env.NODE_ENV === 'development';
}

export type BudgetChange = {
  revokeTx: Hex;
  commitTx: Hex;
  /** The block the UI passes to waitForIndexed before re-reading the pool. */
  commitBlock: string;
  /** The intent hash changed, so the Agent drawer must follow it. */
  newHash: Hex;
  oldHash: Hex;
  owner: Address;
  previousMaxNetPay: string;
  maxNetPay: string;
  nonce: string;
};

export type Revocation = {
  revokeTx: Hex;
  /** The block the UI passes to waitForIndexed before re-reading the pool. */
  revokeBlock: string;
  intentHash: Hex;
  owner: Address;
};

/**
 * Revoke a live intent on-chain, as its owner.
 *
 * The other half of the judge controls: a judge removes a participant from the pool and
 * watches a reshuffle that depended on them stop being available. Like a budget change this
 * has to be a real transaction — revoke() is owner-only, so the server signs with that
 * participant's own key, and the subgraph learns about it from IntentRevoked.
 *
 * Withdrawing tickets is deliberately NOT done here. Revocation and custody are separate:
 * withdrawing does not revoke, and V2 would catch a withdrawn ticket at settlement anyway.
 * Conflating them would make the control demonstrate two different checks at once.
 */
export async function revokeAsJudge(intentHash: Hex): Promise<Revocation> {
  if (!judgeControlsEnabled()) {
    throw new JudgeControlError('Judge controls are disabled on this server.', 403);
  }

  const { client, addresses } = chainConfig();
  const { committed, snapshot } = await graphPool();

  const current = committed.get(intentHash.toLowerCase() as Hex) ?? committed.get(intentHash);
  if (!current) {
    throw new JudgeControlError(
      `Intent ${intentHash} is not live in the pool at block ${snapshot.block}.`,
      404
    );
  }

  const owner = current.owner.toLowerCase() as Address;
  const account = participantKeys().get(owner);
  if (!account) {
    throw new JudgeControlError(
      `The server holds no key for ${owner}; only seeded demo participants can be changed.`,
      403
    );
  }

  const wallet = createWalletClient({ account, chain: network, transport: http(process.env.ARC_RPC ?? DEPLOYMENT.rpc) });
  const revokeTx = await wallet.writeContract({
    address: addresses.IntentRegistry,
    abi: abi('IntentRegistry'),
    functionName: 'revoke',
    args: [intentHash],
    gas: 200000n,
  });
  const receipt = await client.waitForTransactionReceipt({ hash: revokeTx });
  if (receipt.status !== 'success') {
    throw new JudgeControlError(`Revoke reverted (${revokeTx}); the intent is still live.`, 502);
  }

  return { revokeTx, revokeBlock: receipt.blockNumber.toString(), intentHash, owner };
}

/**
 * Revoke `intentHash` and commit the same conditions with a different maxNetPay.
 *
 * maxNetPay is in contract units (USDC has 6 decimals) and is SIGNED: positive is a ceiling on
 * what the owner will pay, negative a floor on what they must receive.
 */
export async function applyBudget(intentHash: Hex, maxNetPay: bigint): Promise<BudgetChange> {
  if (!judgeControlsEnabled()) {
    throw new JudgeControlError('Judge controls are disabled on this server.', 403);
  }

  const { client, addresses } = chainConfig();
  const { committed, snapshot } = await graphPool();

  const current = committed.get(intentHash.toLowerCase() as Hex) ?? committed.get(intentHash);
  if (!current) {
    throw new JudgeControlError(
      `Intent ${intentHash} is not live in the pool at block ${snapshot.block}.`,
      404
    );
  }
  if (current.maxNetPay === maxNetPay) {
    throw new JudgeControlError('That is already this intent\'s budget; nothing would change on-chain.', 409);
  }

  const owner = current.owner.toLowerCase() as Address;
  const account = participantKeys().get(owner);
  if (!account) {
    throw new JudgeControlError(
      `The server holds no key for ${owner}; only seeded demo participants can be changed.`,
      403
    );
  }

  const wallet = createWalletClient({ account, chain: network, transport: http(process.env.ARC_RPC ?? DEPLOYMENT.rpc) });

  // A nonce is reserved at commit and never released, so walk forward to an unused one.
  let nonce = current.nonce + 1n;
  for (let tries = 0; tries < 64; tries++) {
    const used = await client.readContract({
      address: addresses.IntentRegistry,
      abi: abi('IntentRegistry'),
      functionName: 'usedNonce',
      args: [owner, nonce],
    });
    if (!used) break;
    nonce += 1n;
    if (tries === 63) throw new JudgeControlError('Could not find an unused nonce for this participant.', 409);
  }

  const next: Intent = { ...current, maxNetPay, nonce };
  const newHash = hashIntent(next);

  // Revoke first. A later failure still returns this confirmed receipt so the UI's floor
  // includes the revocation. Restoring an intent then requires a new valid commitment.
  const revokeTx = await wallet.writeContract({
    address: addresses.IntentRegistry,
    abi: abi('IntentRegistry'),
    functionName: 'revoke',
    args: [intentHash],
    gas: 200000n,
  });
  const revokeReceipt = await client.waitForTransactionReceipt({ hash: revokeTx });
  if (revokeReceipt.status !== 'success') {
    throw new JudgeControlError(`Revoke reverted (${revokeTx}); nothing was committed.`, 502);
  }

  try {
    // The owner signs; commit() is permissionless, so the relay could be anyone.
    const signature = await account.signTypedData({
      domain: {
        name: 'RESHUFFLE',
        version: '1',
        chainId: DEPLOYMENT.chainId,
        verifyingContract: addresses.IntentRegistry,
      },
      types: EIP712_TYPES,
      primaryType: 'Intent',
      message: {
        owner: next.owner,
        offered: next.offered,
        eventId: next.eventId,
        sessionMask: next.sessionMask,
        sectionMask: next.sectionMask,
        exactCount: next.exactCount,
        mustShareSession: next.mustShareSession,
        mustShareSection: next.mustShareSection,
        mustBeAdjacent: next.mustBeAdjacent,
        maxNetPay: next.maxNetPay,
        deadline: next.deadline,
        nonce: next.nonce,
      },
    });

    const commitTx = await wallet.writeContract({
      address: addresses.IntentRegistry,
      abi: abi('IntentRegistry'),
      functionName: 'commit',
      args: [next, signature],
      gas: 400000n,
    });
    const commitReceipt = await client.waitForTransactionReceipt({ hash: commitTx });
    if (commitReceipt.status !== 'success') {
      throw new JudgeControlError(
        `Commit reverted (${commitTx}). The old intent is revoked; create a new intent to restore a live request.`,
        502
      );
    }

    return {
      revokeTx,
      commitTx,
      commitBlock: commitReceipt.blockNumber.toString(),
      newHash,
      oldHash: intentHash,
      owner,
      previousMaxNetPay: current.maxNetPay.toString(),
      maxNetPay: maxNetPay.toString(),
      nonce: nonce.toString(),
    };
  } catch (error) {
    const failure = error instanceof JudgeControlError ? error : new JudgeControlError('The old intent was revoked. The replacement commitment was not confirmed; inspect its transaction status before creating another intent.', 502);
    failure.confirmed = { blockNumber: revokeReceipt.blockNumber.toString(), hashes: [revokeTx] };
    throw failure;
  }
}
