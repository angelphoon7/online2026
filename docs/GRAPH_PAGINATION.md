# Steps 5-C / 5-D / 6-A — complete paginated discovery

The UI market, solver discovery and Agent now use the same cursor reader in
[`shared/graph/pages.ts`](../shared/graph/pages.ts). Reaching 1,000 records starts another
page. It neither rejects an ordinary full page nor treats that page as the whole pool.

## Query and completion contract

- Every root uses `orderBy: id`, ascending, with its own `id_gt` cursor. Intents and
  settlements use Bytes cursors; ticket IDs use String cursors. Commit timestamps are not
  cursors, so multiple intents committed in one block cannot be skipped.
- `_meta` and all roots share the first request's `block: { number_gte: minBlock }`. That
  response chooses N. Further pages use **its block hash**, and must return the same block
  number, hash, timestamp and subgraph deployment. An advancing indexer cannot move the
  next page to a later snapshot.
- Each collection finishes independently when it returns fewer than the requested page
  size. Exactly 1,000 (or another exact multiple) requires a final probe. Finished roots
  are omitted from later requests. A missing unfinished root is an error, not an empty list.
- Lists are returned only after all pages finish. Repeated IDs, a cursor that does not
  advance, incorrect ordering, oversized pages and inconsistent metadata are rejected.
  Fetch/GraphQL errors propagate; they never terminate pagination as a successful short page.
- All roots include metadata in the same request. Legacy single-response test captures
  without a block hash remain parseable; continuing pagination without a hash is refused.
- After collection, tickets are sorted numerically for the UI, intents by commit block
  then hash, and settlements by descending block then entity ID. Separate settlement events
  from one transaction remain separate entities. Signed `offered` arrays are never sorted.

This follows The Graph's documented [ID pagination and historical queries](https://thegraph.com/docs/en/subgraphs/querying/graphql-api/).
The indexer remains a discovery source; execution still checks signed conditions on-chain.
Pinning a Graph block does not reserve tickets/funds or establish chain finality.

## Failure and resource bounds

| Condition | Result |
| --- | --- |
| First response below the receipt floor | Existing `SubgraphLagError`, HTTP 409 |
| A later page changes block/hash/timestamp/deployment | `SubgraphSnapshotChanged`, HTTP 503 |
| Repeated/invalid cursor, missing list or incomplete nested relation | `SubgraphPaginationError`, HTTP 503 |
| Unfinished lists after 100 page requests | `SubgraphPageLimit`, HTTP 503 |
| Pagination exceeds its overall 20-second deadline | `SubgraphReadTimeout`, HTTP 503 |
| Caller or Agent request budget aborts | Cancellation propagates; the existing Agent timeout response takes precedence |

The default page size is 1,000. Page/time limits bound the read, not the amount silently
returned. Exhausting a limit produces **no partial snapshot**. The nested `offeredTickets`
query explicitly requests up to 1,000 relations; if it reaches that bound while more signed
offered IDs remain, the snapshot fails instead of falsely diagnosing `TICKET_UNKNOWN`.

`/api/market`, both solver routes and both Agent routes expose named pagination failures
with `Cache-Control: no-store`. A failed post-transaction refresh retains `Indexing block #M`
and disables stale Agent answers until a complete sufficiently fresh snapshot succeeds.

These read bounds are separate from the existing **256 searchable intent** execution-service
limit, four-participant/four-ticket proposal bounds, 100-candidate search budget and two-second
search deadline. Larger pools are discoverable; the automatic execution service still rejects
oversized search pools explicitly. Agent grouping retains its existing subset disclosure.

## Verification

- **258 Graph/Agent checks passed**, including **30 pagination cases**. Fixtures cover
  0, 999, 1,000, 1,001, 2,000 and 2,001 rows; independent root completion; tied commit blocks;
  later-page ticket event checks; every metadata mismatch; invalid/missing/repeated pages;
  timeout/cancellation; nested truncation; and all five public route error responses.
  [Test output](checks/graph-pagination-tests.txt).
- Previous supply-bound, strict what-if validation, individual commitment-link, single-block
  diagnosis, narration guard, request control and drawer-binding checks remain in that suite.
- **12 browser tests passed**. The suite opens a market with 1,003 intents and selects its
  final request, alongside the prior receipt-floor and evidence-drawer regression scenarios.
  [Browser result record](checks/graph-pagination-browser.json).
- Production build and TypeScript passed. Changed-file lint reported zero errors; the
  existing `_a`/`_b` unused-variable warnings in the captured-fixture test remain.

Live read-only verification used page size **50** at block **61795322**:

| Reader | Page requests | Intents | Tickets | Settlements |
| --- | ---: | ---: | ---: | ---: |
| Solver/Agent pool | 6 | 134 live, 0 excluded | 250 | Not queried |
| UI market | 6 | 183, all states | 284 | 15 |

All pages returned the same block hash, timestamp and deployment; UI intent hash mismatches
were zero. The 250-ticket pool exercised the exact-page-multiple empty probe.
[Actual per-page record](checks/graph-pagination-live.json). No transactions or model calls
were made. Counts above 1,000 are tested with fixtures; they are not presented as live volume.

Reproduce:

```sh
npm test
npm run build
npm run test:browser
npm run subgraph:pagination -- 50
```

The final command reads the configured Studio endpoint and writes only public block/count
evidence. Browser tests intercept API requests and do not need a wallet or provider key.
