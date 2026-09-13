import { gql, subgraphEndpoint, SubgraphIndexingError, SubgraphLagError, type GqlOptions } from './client';

export const GRAPH_PAGE_SIZE = 1000;
export const GRAPH_MAX_PAGES = 100;
export const GRAPH_READ_TIMEOUT_MS = 20_000;

export type GraphPageMeta = {
  block: { number: number; timestamp: string; hash?: string | null };
  deployment: string;
  hasIndexingErrors: boolean;
};
export type GraphPageOptions = GqlOptions & {
  minBlock?: bigint;
  pageSize?: number;
  /** A resource bound, never permission to return a partial list. */
  maxPages?: number;
  timeoutMs?: number;
};

export class SubgraphPaginationError extends Error {
  constructor(detail: string) { super(`SubgraphPaginationError: ${detail}. No partial snapshot was returned.`); this.name = 'SubgraphPaginationError'; }
}
export class SubgraphSnapshotChanged extends SubgraphPaginationError {
  constructor() { super('page block, timestamp or deployment changed; retry the snapshot'); this.name = 'SubgraphSnapshotChanged'; }
}
export class SubgraphPageLimit extends SubgraphPaginationError {
  constructor(pages: number) { super(`snapshot still has unread pages after ${pages} requests`); this.name = 'SubgraphPageLimit'; }
}
export class SubgraphReadTimeout extends SubgraphPaginationError {
  constructor(timeout: number) { super(`snapshot read exceeded ${timeout}ms; retry the snapshot`); this.name = 'SubgraphReadTimeout'; }
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const hexHash = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{64}$/i.test(v);

function metadata(value: unknown, floor: bigint): GraphPageMeta {
  if (record(value) && value.hasIndexingErrors === true) throw new SubgraphIndexingError();
  const timestamp = record(value) && record(value.block) ? value.block.timestamp : undefined;
  const validTimestamp = typeof timestamp === 'string' ? /^\d+$/.test(timestamp) : typeof timestamp === 'number' && Number.isSafeInteger(timestamp) && timestamp >= 0;
  if (!record(value) || !record(value.block) || !Number.isSafeInteger(value.block.number)
    || (value.block.number as number) < 0 || !validTimestamp
    || typeof value.deployment !== 'string' || !value.deployment || value.hasIndexingErrors !== false
    || (value.block.hash != null && !hexHash(value.block.hash))) throw new SubgraphPaginationError('missing or malformed page metadata');
  const meta = { ...value, block: { ...value.block, timestamp: String(timestamp) } } as GraphPageMeta;
  if (BigInt(meta.block.number) < floor) throw new SubgraphLagError(`SubgraphLagError: indexed ${meta.block.number}, required ${floor}`, BigInt(meta.block.number));
  return meta;
}

/**
 * Read all roots with independent id_gt cursors. The first response chooses the snapshot;
 * subsequent requests pin its hash, and every page must attest to the same metadata.
 * Completion is per root: a full page always requires another read, including exactly 1000.
 * Callers receive arrays only after every root finishes, never after an error or resource cap.
 */
export async function readGraphPages<T extends { _meta: GraphPageMeta }>(
  query: string, initialCursors: Record<string, string>, options: GraphPageOptions = {},
): Promise<T> {
  const pageSize = options.pageSize ?? GRAPH_PAGE_SIZE, maxPages = options.maxPages ?? GRAPH_MAX_PAGES;
  const timeout = options.timeoutMs ?? GRAPH_READ_TIMEOUT_MS, floor = options.minBlock ?? 0n;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > GRAPH_PAGE_SIZE
    || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > GRAPH_MAX_PAGES
    || !Number.isInteger(timeout) || timeout < 1 || timeout > GRAPH_READ_TIMEOUT_MS
    || floor < 0n || floor > 2147483647n) throw new SubgraphPaginationError('invalid pagination options');

  const deadline = AbortSignal.timeout(timeout);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const cursors = { ...initialCursors }, pending = new Set(Object.keys(cursors));
  const result: Record<string, { id: string }[]> = Object.fromEntries([...pending].map(name => [name, []]));
  let pinned: GraphPageMeta | undefined;
  // Resolve the endpoint once: changing process configuration cannot switch providers mid-read.
  const gqlOptions = { ...options, signal, url: options.url ?? (typeof window === 'undefined' ? subgraphEndpoint() : '/api/graph') };
  try {
    for (let page = 0; pending.size; page++) {
      signal.throwIfAborted();
      if (page === maxPages) throw new SubgraphPageLimit(maxPages);
      if (pinned && !pinned.block.hash) throw new SubgraphPaginationError('a block hash is required to continue pagination');
      const variables: Record<string, unknown> = {
        first: pageSize, at: pinned ? { hash: pinned.block.hash } : { number_gte: Number(floor) },
      };
      for (const name of Object.keys(cursors)) {
        variables[`${name}After`] = cursors[name];
        variables[`with_${name}`] = pending.has(name);
      }
      const data = await gql<Record<string, unknown>>(query, variables, gqlOptions);
      signal.throwIfAborted();
      if (!record(data)) throw new SubgraphPaginationError('missing page data');
      const meta = metadata(data._meta, floor);
      if (pinned && (meta.block.number !== pinned.block.number || meta.block.timestamp !== pinned.block.timestamp
        || meta.block.hash !== pinned.block.hash || meta.deployment !== pinned.deployment)) throw new SubgraphSnapshotChanged();
      pinned ??= meta;
      for (const name of [...pending]) {
        const rows = data[name];
        if (!Array.isArray(rows) || rows.length > pageSize) throw new SubgraphPaginationError(`invalid ${name} page`);
        let previous = cursors[name];
        for (const row of rows) {
          if (!record(row) || typeof row.id !== 'string' || row.id <= previous) {
            throw new SubgraphPaginationError(`${name} cursor did not advance in ascending id order`);
          }
          previous = row.id;
          result[name].push(row as { id: string });
        }
        cursors[name] = previous;
        if (rows.length < pageSize) pending.delete(name);
      }
    }
    return { _meta: pinned, ...result } as T;
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    if (deadline.aborted) throw new SubgraphReadTimeout(timeout);
    throw error;
  }
}
