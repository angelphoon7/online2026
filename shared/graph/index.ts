// The shared Graph layer. Import from here rather than reaching into the modules.
//
//   getPoolSnapshot()  discovery: the live pool, hash-bound and V1-V3 filtered
//   waitForIndexed()   freshness: call with a RECEIPT block number after a transaction
//   gql()              escape hatch for one-off queries
//
// Discovery only. Registry state, custody and payment capacity are re-read from the chain
// before any proposal is submitted, so index lag can cause a failed simulation but never an
// invalid settlement.

export { gql, subgraphEndpoint, GraphError, SubgraphLagError, SubgraphIndexingError, SubgraphHistoryUnavailable } from './client';
export type { GqlOptions } from './client';

export { POOL_SNAPSHOT, META, INTENT_BY_ID } from './queries';

export { getPoolSnapshot, getIntentById, exclusionsByReason } from './snapshot';
export type {
  Snapshot,
  SnapshotOptions,
  LiveIntent,
  Exclusion,
  ExclusionReason,
  IntentStatus,
} from './snapshot';

export { waitForIndexed, getMeta, SubgraphLagTimeout } from './wait';
export type { Meta, WaitOptions } from './wait';
