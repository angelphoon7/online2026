import 'server-only';
import { randomUUID } from 'node:crypto';
import { keccak256, type Hex, type TransactionReceipt } from 'viem';
import { durableStore, encodeRecord, type DurableStore } from './durable-store';

export class SigningBusy extends Error {
  readonly status = 409;
  constructor(message = 'This signer has an unfinished operation. Retry that same claim or judge action to resume it.') { super(message); }
}
type Step = { raw: Hex; hash: Hex };
export type SigningJob<P = unknown, R = unknown> = { plan: P; steps: Record<string, Step>; result?: R };
export const jobKey = (id: string) => `signing:job:${id}`;
export async function readJob<P, R>(id: string, store = durableStore()): Promise<SigningJob<P, R> | null> {
  const raw = await store.get(jobKey(id)); return raw === null ? null : JSON.parse(raw);
}
type TransactionIO = {
  prepare: () => Promise<Hex>;
  receipt: (hash: Hex) => Promise<TransactionReceipt | null>;
  broadcast: (raw: Hex) => Promise<unknown>;
  wait: (hash: Hex) => Promise<TransactionReceipt>;
};

/** The durable active reservation does not expire: an uncertain transaction must be resumed,
 * never replaced with a different job after a server restart. Only the worker lease expires. */
export async function signingJob<P, R>(signer: string, id: string, initialize: () => Promise<P>,
  execute: (plan: P, transaction: (name: string, io: TransactionIO) => Promise<TransactionReceipt>) => Promise<R>,
  store: DurableStore = durableStore()): Promise<R> {
  const lease = { key: `signing:lease:${signer.toLowerCase()}`, value: randomUUID() };
  if (!await store.compareAndSet(lease.key, null, lease.value, { ttlMs: 90_000 })) throw new SigningBusy('Another request is using this signer. Retry shortly.');
  const activeKey = `signing:active:${signer.toLowerCase()}`;
  let job: SigningJob<P, R> | null = null;
  let reserved = false;
  let saved: string | null = null;
  const refresh = async () => {
    if (!await store.compareAndSet(lease.key, lease.value, lease.value, { ttlMs: 90_000 })) throw new SigningBusy('The worker lease ended. Retry this same action to resume its saved transaction.');
  };
  const save = async () => {
    const next = encodeRecord(job);
    if (!await store.compareAndSet(jobKey(id), saved, next, { guard: lease })) throw new SigningBusy();
    saved = next;
  };
  try {
    const active = await store.get(activeKey);
    if (active !== null && active !== id) throw new SigningBusy();
    if (active === null && !await store.compareAndSet(activeKey, null, id, { guard: lease })) throw new SigningBusy();
    reserved = true;
    saved = await store.get(jobKey(id));
    job = saved === null ? { plan: await initialize(), steps: {} } : JSON.parse(saved);
    if (!job) throw new Error('Missing signing journal');
    if (saved === null) await save();
    if (job.result !== undefined) return job.result;
    const transaction = async (name: string, io: TransactionIO) => {
      await refresh();
      let step = job!.steps[name];
      if (!step) {
        const raw = await io.prepare();
        step = { raw, hash: keccak256(raw) };
        job!.steps[name] = step;
        await save(); // Never send transaction bytes that have not been saved under the lease.
      }
      let receipt = await io.receipt(step.hash);
      if (!receipt) {
        await refresh();
        await io.broadcast(step.raw).catch(() => {}); // Already known / response lost: check the same hash.
        receipt = await io.wait(step.hash);
      }
      if (receipt.status !== 'success') throw new SigningBusy(`Recorded transaction ${step.hash} reverted. The operator must inspect this job before recovery.`);
      return receipt;
    };
    job.result = await execute(job.plan, transaction);
    await refresh();
    await save();
    return job.result;
  } finally {
    // A crash/timeout after signing keeps the active reservation for the identical retry.
    if (reserved && (job?.result !== undefined || !job || Object.keys(job.steps).length === 0)) {
      await store.compareAndSet(activeKey, id, null, { guard: lease });
    }
    await store.compareAndSet(lease.key, lease.value, null);
  }
}
