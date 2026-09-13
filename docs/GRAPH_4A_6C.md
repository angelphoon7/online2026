# Step 4-A and 6-C follow-up — 12 September 2026

## 4-A: public index health and a real transaction sample

**The public checks and receipt-to-index measurement pass. The literal Studio Synced label
and complete Logs inspection remain unverified.** The user's screenshot shows Deployed,
Not published and Subgraph not indexed, with INFO write batches through block 61761333.
Those visible INFO rows do not establish the absence of historical warnings.

The later public refresh reached block **61797886**, with **183 intents, 284 tickets,
250 escrowed tickets and 15 settlements**; indexing errors remained false and block hash and
ticket counts matched RPC. [Latest public record](checks/graph-status.json).
Authenticated panel evidence is still pending; use the [specific review checklist](GRAPH_STUDIO_REVIEW.md).

The [public status check](checks/graph-status.json) at block 61762011 found
`hasIndexingErrors=false`, 122 intents, 164 tickets, 130 escrowed tickets and 15 settlements.
The indexed block hash, minted count and escrow count agree with RPC at that same block.
Initial deployment seed commitments are present. Counts differ from earlier reports because
they describe different snapshots.

The measurement sent one real testnet transfer of ticket #10 to its existing owner:

| Observation | Measured value |
|---|---|
| Receipt block | 61762063 |
| First successful query's indexed block | 61762071 |
| Ticket `updatedAtBlock` | 61762063 |
| Receipt observed → indexed ticket observed | **7,294 ms** |
| Queries | 5; four behind, then indexed |
| Actual fee | 0.00063664 test USDC |
| Ownership / custody changed | No |

[Transaction](https://testnet.arcscan.app/tx/0x276568800432ccaaf83bfac6377de48644b8222008205ec9c3ba6b14533f479e)
· [Raw measurement](checks/graph-transfer-10.json)
· [Method, commands and qualifications](graph-acceptance.md#follow-up-12-september-2026).
This is one observation including polling and network requests; it is not an upper bound or
a browser measurement. No budget change, settlement or recording is established by this sample.

## 6-C: Graph discovery, response fields and HTTP evidence

Graph-mode discovery now stays within the supplied Graph snapshot. A requested intent missing
from that searchable snapshot returns HTTP 422; it cannot be recovered from RPC logs while
claiming the earlier snapshot's provenance. RPC log discovery remains available in RPC mode.
An unmet `minBlock` returns HTTP 409. Chain-state revalidation and `simulateContract(settle)`
still run; calldata is returned only for the chosen proposal whose simulation succeeds.

Both `/api/solve/pool` and `/api/solve` return top-level `snapshotBlock`, `bounds`, `candidates`
and `excluded`. Existing `source.snapshotBlock`, `pool.snapshotBlock`, `candidatesExcluded`,
`proposal` and `transaction` fields remain available to current clients. RPC mode returns
`snapshotBlock: null`. `candidates` contains the ranked search results; the simulation evidence
applies to the chosen `proposal`, not every returned candidate.

Actual production-server requests used `minBlock=61762063`, the measured receipt block:

| Request | Snapshot block | Intents searched | Candidates found | Search time | HTTP duration | Chosen simulation |
|---|---|---|---|---|---|---|
| `POST /api/solve/pool` | 61762525 | 74 | 100 | 146.233 ms | 19,101 ms | Passed |
| `POST /api/solve` | 61762563 | 2 | 2 | 1.064 ms | 1,027 ms | Passed |

Search bounds were 4 participants, 100 candidates and 2,000 ms. Full-pool search reached its
candidate cap; these are results within that bound. Search timing excludes public reads and
simulation; HTTP timing includes those operations. No claim of exhaustive discovery follows.

Server output, corroborated against each response's snapshot block:

```text
pool source: subgraph @ block 61762525 — 74 searchable, 0 excluded
pool source: subgraph @ block 61762563 — 2 of 2 requested hashes discovered
```

[Full pool request/response](checks/graph-solve-pool.json)
· [Selected intents request/response](checks/graph-solve-selected.json)
· [Captured server lines](checks/graph-solver-server.txt)
· [Unmet floor: real HTTP 409](checks/graph-solve-lag.json).
These requests discovered, revalidated and simulated; they did not broadcast a settlement.

## Reproduce and validate

```sh
npm run subgraph:status
npm run test:graph-acceptance
npm test
npm run build
npm run graph:solve:check
```

`graph:solve:check` starts and stops its own local production server on an available port,
forces Graph mode, requests the whole pool and then its chosen hashes, and checks a future
floor is rejected. It writes the dated HTTP and log reports above. It needs a live matching
pool for the positive simulation assertions. It does not call wallet, model or settlement
submission endpoints. The separate `subgraph:lag:tx -- --send TOKEN_ID` command is the only
new acceptance command that signs and broadcasts a transaction; see its preflight procedure.

Validation on this change: production build and TypeScript passed; 34 existing/new Graph and
agent test entries passed, plus five measurement/evidence tests. The existing wait script is
still a logging-only test entry, as described in the earlier review; this change does not
upgrade that entry into assertion coverage. New assertions cover missing Graph intent
rejection, hash mismatch, elapsed-time semantics, timeout, wrong deployment/owner/entity
block, and failed simulation/provenance evidence.

The local build initially lacked the already-declared `ogl` package. Installing the declared
root dependencies resolved it; no dependency manifest or lockfile change was needed.
