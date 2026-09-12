// waitForIndexed — step 5-E of docs/RESHUFFLE_GRAPH_PLAN.md.
//
// Called after a transaction, before re-reading the pool. Without it the UI reads a snapshot
// that predates the user's own action, and the deposit or revocation they just made appears
// not to have happened — the single most confusing failure an indexed frontend can show.
//
// Call it with a RECEIPT's block number, never with getBlockNumber(). A receipt names the
// block a transaction is actually in, which is definite. The RPC's reported head is not: Arc's
// public endpoint is load balanced and can serve a head a few blocks stale — measured, see
// docs/graph-acceptance.md, where the subgraph sometimes reported a HIGHER block than the RPC.
//
// Polling is deliberately slow-starting and backs off. Studio's dev query endpoint is rate
// limited and there is no API key that lifts it (the key is for the decentralised gateway,
// which does not serve this subgraph). A tight poll loop is how a demo gets throttled.

import { gql, SubgraphIndexingError, type GqlOptions } from './client';
import { META } from './queries';

/** graph-node did not reach the target block before the deadline. */
export class SubgraphLagTimeout extends Error {
  constructor(
    public target: bigint,
    public indexed: bigint,
    public waitedMs: number
  ) {
    super(
      `SubgraphLagTimeout: indexed ${indexed}, needed ${target} (${target - indexed} behind) after ${waitedMs}ms`
    );
    this.name = 'SubgraphLagTimeout';
  }
}

export type Meta = {
  block: { number: number; timestamp: string };
  hasIndexingErrors: boolean;
  deployment: string;
};

export async function getMeta(options: GqlOptions = {}): Promise<Meta> {
  const data = await gql<{ _meta: Meta }>(META, {}, options);
  return data._meta;
}

export type WaitOptions = GqlOptions & {
  /** Give up after this long. Default 90s; typical wait is ~2s (measured median 4 blocks). */
  timeoutMs?: number;
  /** First poll delay; grows by 1.5x to maxDelayMs. */
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Called after each poll, for an "Indexing block #M…" indicator. */
  onProgress?: (indexed: bigint, target: bigint) => void;
};

/**
 * Wait until the subgraph has indexed `target`, and return the block it actually reached.
 *
 * Throws SubgraphLagTimeout if it does not get there in time, and SubgraphIndexingError if the
 * subgraph reports a mapping failure — in which case waiting longer cannot help, because the
 * entities are already untrustworthy.
 */
export async function waitForIndexed(target: bigint, options: WaitOptions = {}): Promise<bigint> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const maxDelayMs = options.maxDelayMs ?? 5_000;
  let delay = options.initialDelayMs ?? 800;

  const started = Date.now();

  for (;;) {
    const meta = await getMeta(options);
    // A mapping failure will not resolve by waiting; fail now rather than at the timeout.
    if (meta.hasIndexingErrors) throw new SubgraphIndexingError();

    const indexed = BigInt(meta.block.number);
    options.onProgress?.(indexed, target);
    // Usually true on the first poll — graph-node is typically a couple of blocks behind, and
    // the round trip alone often covers that.
    if (indexed >= target) return indexed;

    const waited = Date.now() - started;
    if (waited > timeoutMs) throw new SubgraphLagTimeout(target, indexed, waited);

    // Do not overshoot the deadline just to complete one more sleep.
    const remaining = timeoutMs - waited;
    await sleep(Math.min(delay, remaining + 50), options.signal);
    delay = Math.min(Math.round(delay * 1.5), maxDelayMs);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
