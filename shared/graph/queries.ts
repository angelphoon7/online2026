// GraphQL documents for the pool snapshot — step 5-C of docs/RESHUFFLE_GRAPH_PLAN.md.
//
// All roots and _meta share $at: a number_gte floor on the first page and its block hash
// thereafter. Cursor order is id, never a timestamp or numeric token id. pages.ts validates
// progress and completes each root independently. Presentation order is restored after loading.

/**
 * One page of solver discovery. Use getPoolSnapshot() to consume the complete pool.
 *
 * `offeredTickets` is nested rather than joined client-side so that custody can be checked
 * per intent without a second round trip, and at the same block.
 */
export const POOL_SNAPSHOT = /* GraphQL */ `
  query PoolSnapshot($at: Block_height!, $first: Int!, $intentsAfter: Bytes!, $ticketsAfter: String!, $with_intents: Boolean!, $with_tickets: Boolean!) {
    _meta(block: $at) {
      block {
        number
        timestamp
        hash
      }
      hasIndexingErrors
      deployment
    }
    intents(
      first: $first
      where: { state: LIVE, id_gt: $intentsAfter }
      orderBy: id
      orderDirection: asc
      block: $at
    ) @include(if: $with_intents) {
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
      offeredTickets(first: 1000) {
        id
        escrowed
        depositor
        redeemed
      }
    }
    tickets(
      first: $first
      where: { escrowed: true, redeemed: false, id_gt: $ticketsAfter }
      orderBy: id
      orderDirection: asc
      block: $at
    ) @include(if: $with_tickets) {
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
 * The caller must pass the pool's exact block; a freshness floor could include a later revoke.
 */
export const INTENT_BY_ID = /* GraphQL */ `
  query IntentById($id: ID!, $block: Int!) {
    _meta(block: { number: $block }) {
      block { number }
      hasIndexingErrors
      deployment
    }
    intent(id: $id, block: { number: $block }) {
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
