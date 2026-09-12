// The shared GraphQL client — step 5-B of docs/RESHUFFLE_GRAPH_PLAN.md.
//
// One implementation for both sides, so getPoolSnapshot() and waitForIndexed() are written
// once rather than twice:
//
//   server  -> Studio directly, using SUBGRAPH_URL (and the key, if there is one)
//   browser -> /api/graph, the same-origin proxy, so no endpoint or key reaches the bundle
//
// The endpoint is deliberately not a NEXT_PUBLIC_ variable. The Studio query URL is
// version-pinned (…/reshuffle/v0.1.1), so baking it into the client bundle would freeze a
// version into a build; the proxy reads it per request instead.

export class GraphError extends Error {
  constructor(
    public errors: { message: string }[],
    public status?: number
  ) {
    super(errors.map((e) => e.message).join('; '));
    this.name = 'GraphError';
  }
}

/** Raised when graph-node has not reached the block a query required. Retry, do not fail. */
export class SubgraphLagError extends Error {
  constructor(
    message: string,
    public indexedBlock?: bigint
  ) {
    super(message);
    this.name = 'SubgraphLagError';
  }
}

/** The subgraph reported a mapping failure; its data is not trustworthy until redeployed. */
export class SubgraphIndexingError extends Error {
  constructor() {
    super('SubgraphIndexingError: the subgraph reports hasIndexingErrors');
    this.name = 'SubgraphIndexingError';
  }
}

/** The index has moved past this retained history; waiting cannot recover a pruned block. */
export class SubgraphHistoryUnavailable extends Error {
  constructor(message: string, public oldestAvailableBlock: bigint) {
    super(message);
    this.name = 'SubgraphHistoryUnavailable';
  }
}

const isServer = typeof window === 'undefined';

/**
 * graph-node rejects a query whose `block: { number_gte: N }` it has not reached yet. That is
 * the freshness floor working as designed, not a failure — it is what guarantees a read after
 * a transaction is never older than that transaction. Recognise it so callers can wait.
 */
// Matched in two passes, deliberately. A single alternation would be wrong: JS regex takes the
// LEFTMOST match, and the generic "subgraph <hash> has only indexed …" text begins earlier in
// graph-node's message than the part carrying the block number, so the capturing branch would
// never win and indexedBlock would silently come back undefined.
//
// Observed message:
//   Failed to decode `block.number_gte` value: `subgraph Qm… has only indexed up to block
//   number 61648866 and data for block number 61653863 is therefore not yet available`
const LAG_BLOCK = /has only indexed up to block (?:number )?(\d+)/i;
const LAG_GENERIC = /has only indexed|not yet available|block .* is therefore/i;

function asLagError(messages: string[]): SubgraphLagError | null {
  for (const message of messages) {
    const withBlock = message.match(LAG_BLOCK);
    if (withBlock) return new SubgraphLagError(message, BigInt(withBlock[1]));
    if (LAG_GENERIC.test(message)) return new SubgraphLagError(message);
  }
  return null;
}

export function subgraphEndpoint(): string {
  const url = process.env.SUBGRAPH_URL;
  if (!url) {
    throw new Error(
      'SUBGRAPH_URL is not set. Deploy the subgraph (npm run subgraph:deploy vX.Y.Z), which records it.'
    );
  }
  return url;
}

export type GqlOptions = {
  /** Override the endpoint; used by scripts that target a specific version. */
  url?: string;
  signal?: AbortSignal;
};

export async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {},
  options: GqlOptions = {}
): Promise<T> {
  const url = options.url ?? (isServer ? subgraphEndpoint() : '/api/graph');
  // Server-side only: the key must never be bundled. It is optional — Studio's dev query
  // endpoint does not authenticate (see docs/graph-acceptance.md).
  const key = isServer ? process.env.SUBGRAPH_API_KEY : undefined;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
    signal: options.signal,
    cache: 'no-store',
  });

  let body: { data?: T; errors?: { message: string }[] };
  try {
    body = await response.json();
  } catch {
    throw new GraphError([{ message: `Non-JSON response (HTTP ${response.status})` }], response.status);
  }

  if (body.errors?.length) {
    const messages = body.errors.map((e) => e.message);
    for (const message of messages) {
      const retained = message.match(/only has data starting at block (?:number )?(\d+)/i);
      if (retained) throw new SubgraphHistoryUnavailable(message, BigInt(retained[1]));
    }
    const lag = asLagError(messages);
    if (lag) throw lag;
    throw new GraphError(body.errors, response.status);
  }

  if (!response.ok) {
    throw new GraphError([{ message: `HTTP ${response.status}` }], response.status);
  }
  if (body.data === undefined) {
    throw new GraphError([{ message: 'Response contained no data' }], response.status);
  }
  return body.data;
}
