// GraphQL documents for the pool snapshot — step 5-C of docs/RESHUFFLE_GRAPH_PLAN.md.
//
// Two things are deliberate in POOL_SNAPSHOT:
//
//  1. `_meta` is in the SAME request as the data. The returned block number is then the block
//     the data itself came from, so "at Arc Testnet block #N" is a fact about that payload
//     rather than a separate, possibly later, read.
//
//  2. `block: { number_gte: $minBlock }` is the freshness floor (trust rule 2). graph-node
//     REJECTS the query if it has not yet indexed that block — it never silently answers from
//     an older one. That rejection is the mechanism, not a failure: shared/graph/client.ts
//     turns it into a SubgraphLagError carrying the block actually indexed, so the caller can
//     wait instead of reading a stale pool.
//
// Limits: `first` caps at 1000 per list and nested lists default to 100. Intents offer at most
// four tickets, so offeredTickets is never truncated. If the pool ever exceeds 1000, paginate
// with `id_gt` rather than raising `first`.

/**
 * Everything the solver needs to discover the pool, in one request.
 *
 * `offeredTickets` is nested rather than joined client-side so that custody can be checked
 * per intent without a second round trip, and at the same block.
 */
export const POOL_SNAPSHOT = /* GraphQL */ `
  query PoolSnapshot($minBlock: Int!, $first: Int!) {
    _meta(block: { number_gte: $minBlock }) {
      block {
        number
        timestamp
      }
      hasIndexingErrors
      deployment
    }
    intents(
      first: $first
      where: { state: LIVE }
      orderBy: committedAtBlock
      orderDirection: asc
      block: { number_gte: $minBlock }
    ) {
      id
      owner
      eventId
      offered
      sessionMask
      sectionMask
      exactCount
      mustShareSession
      mustShareSection
      mustBeAdjacent
      maxNetPay
      deadline
      nonce
      committedAtBlock
      committedTx
      offeredTickets {
        id
        escrowed
        depositor
        redeemed
      }
    }
    tickets(
      first: $first
      where: { escrowed: true, redeemed: false }
      block: { number_gte: $minBlock }
    ) {
      id
      eventId
      sessionId
      sectionId
      row
      seat
      depositor
      redeemed
    }
  }
`;

/** Cheapest possible freshness probe; used by waitForIndexed. */
export const META = /* GraphQL */ `
  query Meta {
    _meta {
      block {
        number
        timestamp
      }
      hasIndexingErrors
      deployment
    }
  }
`;

/**
 * One intent regardless of state — used by the agent to explain an intent that has left the
 * live pool, where REVOKED or SETTLED with a transaction hash is itself the answer.
 */
export const INTENT_BY_ID = /* GraphQL */ `
  query IntentById($id: ID!) {
    intent(id: $id) {
      id
      owner
      state
      committedAtBlock
      committedTx
      closedAtBlock
      closedTx
      settlement {
        id
        txHash
        blockNumber
        participantCount
      }
    }
  }
`;
