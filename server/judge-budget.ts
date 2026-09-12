import 'server-only';
import { createWalletClient, defineChain, encodeFunctionData, http, parseEther, type TransactionReceipt, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'node:fs';
import { chainConfig, abi } from './chain';
import { graphPool } from './solve-graph';
import { hashIntent } from '@/shared/intent';
import type { Intent } from '../solver/src/types';
import { DEPLOYMENT } from '@/lib/deployment';
import { nextJudgeNonce } from './judge-nonce';
import { allowReplacement, judgeControlsEnabled, requireAllowedIntent } from './judge-access';
import { readJob, signingJob } from './signing-job';
import { encodeRecord } from './durable-store';
import { saveDemoReplacement } from './judging-demo';
export { judgeControlsEnabled } from './judge-access';

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


export type BudgetChange = { revokeTx: Hex; commitTx: Hex; commitBlock: string; newHash: Hex; oldHash: Hex; owner: Address; previousMaxNetPay: string; maxNetPay: string; nonce: string };
export type Revocation = { revokeTx: Hex; revokeBlock: string; intentHash: Hex; owner: Address };
type Plan = { owner: Address; root: string; current: string; next?: string; signature?: Hex; newHash?: Hex };
const parseIntent = (raw: string): Intent => {
  const v = JSON.parse(raw);
  return { ...v, offered: v.offered.map(BigInt), sessionMask: BigInt(v.sessionMask), sectionMask: BigInt(v.sectionMask), maxNetPay: BigInt(v.maxNetPay), deadline: BigInt(v.deadline), nonce: BigInt(v.nonce) };
};
async function changeAsJudge(intentHash: Hex, maxNetPay?: bigint): Promise<BudgetChange | Revocation> {
  if (!judgeControlsEnabled()) throw new JudgeControlError('Judge controls are disabled.', 403);
  const root = await requireAllowedIntent(intentHash);
  const { client, addresses } = chainConfig();
  if (DEPLOYMENT.chainId !== 5042002 || await client.getChainId() !== 5042002) throw new JudgeControlError('Judge signing is restricted to Arc Testnet.', 403);
  const id = ['judge', DEPLOYMENT.chainId, addresses.IntentRegistry.toLowerCase(), intentHash.toLowerCase(), maxNetPay === undefined ? 'revoke' : String(maxNetPay)].join(':');
  const previous = await readJob<Plan, BudgetChange | Revocation>(id);
  // Resume after revoke even though the old hash has left the live Graph pool.
  const pool = previous ? null : await graphPool();
  const current = previous ? parseIntent(previous.plan.current) : pool!.committed.get(intentHash.toLowerCase() as Hex);
  if (!current) throw new JudgeControlError('The selected intent is no longer available in the indexed pool.', 404);
  if (!previous && maxNetPay === current.maxNetPay) throw new JudgeControlError('That is already this budget.', 409);
  const owner = current.owner.toLowerCase() as Address, account = participantKeys().get(owner);
  if (!account) throw new JudgeControlError('The server has no signing key for this demo participant.', 403);
  const wallet = createWalletClient({ account, chain: network, transport: http(process.env.ARC_RPC ?? DEPLOYMENT.rpc, { retryCount: 0 }) });
  return signingJob<Plan, BudgetChange | Revocation>(String(DEPLOYMENT.chainId) + ':' + owner, id, async () => {
    const plan: Plan = { owner, root, current: encodeRecord(current) };
    const block = await client.getBlock();
    if (current.deadline <= block.timestamp) throw new JudgeControlError('This demo intent has expired. The operator must prepare a new group.', 409);
    if (maxNetPay !== undefined) {
      const nonce = await nextJudgeNonce(current, pool!.committed.values(), async candidate => await client.readContract({ address: addresses.IntentRegistry, abi: abi('IntentRegistry'), functionName: 'usedNonce', args: [owner, candidate] }) as boolean);
      const next = { ...current, maxNetPay, nonce };
      plan.next = encodeRecord(next); plan.newHash = hashIntent(next);
      plan.signature = await account.signTypedData({ domain: { name: 'RESHUFFLE', version: '1', chainId: DEPLOYMENT.chainId, verifyingContract: addresses.IntentRegistry }, types: EIP712_TYPES, primaryType: 'Intent', message: next });
    }
    return plan;
  }, async (plan, transaction) => {
    const send = (name: 'revoke' | 'commit', args: unknown[], gas: bigint) => transaction(name, {
      prepare: async () => {
        await client.simulateContract({ account, address: addresses.IntentRegistry, abi: abi('IntentRegistry'), functionName: name, args, gas });
        const request = await wallet.prepareTransactionRequest({ account, to: addresses.IntentRegistry, data: encodeFunctionData({ abi: abi('IntentRegistry'), functionName: name, args }), gas });
        if (request.gas * (request.maxFeePerGas ?? request.gasPrice ?? 0n) > parseEther('0.1')) throw new JudgeControlError('The transaction fee exceeds the demo signing limit. Retry later.', 503);
        return wallet.signTransaction(request);
      },
      receipt: hash => client.getTransactionReceipt({ hash }).catch(() => null),
      broadcast: raw => client.sendRawTransaction({ serializedTransaction: raw }),
      wait: hash => client.waitForTransactionReceipt({ hash, timeout: 40_000 }),
    });
    let revoked: TransactionReceipt | undefined;
    try {
      revoked = await send('revoke', [intentHash], 200_000n);
      if (!plan.next) return { revokeTx: revoked.transactionHash, revokeBlock: String(revoked.blockNumber), intentHash, owner };
      const next = parseIntent(plan.next);
      const committed = await send('commit', [next, plan.signature], 400_000n);
      await allowReplacement(plan.newHash!, plan.root);
      await saveDemoReplacement(intentHash, plan.newHash!);
      return { revokeTx: revoked.transactionHash, commitTx: committed.transactionHash, commitBlock: String(committed.blockNumber), newHash: plan.newHash!, oldHash: intentHash, owner, previousMaxNetPay: String(parseIntent(plan.current).maxNetPay), maxNetPay: String(next.maxNetPay), nonce: String(next.nonce) };
    } catch (e) {
      if (!revoked) throw e;
      const failure = new JudgeControlError('The old intent was revoked. Retry this same budget change to resume the saved replacement commitment.', 503);
      failure.confirmed = { blockNumber: String(revoked.blockNumber), hashes: [revoked.transactionHash] };
      throw failure;
    }
  });
}
export async function revokeAsJudge(intentHash: Hex): Promise<Revocation> { return await changeAsJudge(intentHash) as Revocation; }
export async function applyBudget(intentHash: Hex, maxNetPay: bigint): Promise<BudgetChange> { return await changeAsJudge(intentHash, maxNetPay) as BudgetChange; }
