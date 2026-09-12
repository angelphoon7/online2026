# Step 4-A: authenticated Studio review

**Status: awaiting authenticated panel evidence.** No authenticated Studio browser session
was available to the assistant in this check. The older user screenshot showed truncated
Deployed status and INFO batches, which do not establish Synced or the absence of warnings
throughout the version's logs. Do not mark this item PASS from the public endpoint alone.

The public follow-up on 12 September 2026 passed at **block 61797886**, against observed
chain head **61797893**. `hasIndexingErrors=false`, the block hash and inventory totals match
RPC, and initial seed commitments are present. Counts: 183 intents, 284 tickets, 250 escrowed,
15 settlements. [Dated raw checks](checks/graph-status.json). This is a point-in-time health
check; it does not expose Studio's historical warning/error log.

## Remaining review

1. Open Studio, sign in with the existing project wallet, and select **reshuffle / v0.1.1**.
   Match the deployment ID to `subgraphDeployment` in `deployments/arc-testnet.json`.
2. Record the complete sync-status text and check time. Expand or hover any shortened label;
   record indexing progress separately from deployment/publication status. If only Deployed
   is available, record that fact instead of substituting Synced.
3. Inspect Indexing errors. Save the full message for every error, or evidence of an empty
   error view for this version.
4. In Logs, enable **warning and error**, disable info/debug, and clear search text. Inspect
   all available pages/loaded rows. Record the earliest and latest covered timestamps or
   blocks, the version, and whether older history is unavailable. A first page is not a
   complete log check.
5. Search `reverted` and `unknown intent` separately as supplementary checks. Preserve any
   matching row in full. An empty keyword search alone cannot establish an empty error log.
6. Attach the status/error view and log evidence or paste their complete text. Update this
   record with the observed status and log coverage. If retention excludes part of the
   version history, keep that limitation explicit; do not certify unobserved history.

The Graph's [Studio deployment guide](https://thegraph.com/docs/en/subgraphs/developing/deploying-publishing/using-subgraph-studio/)
directs users to the dashboard logs to check errors and distinguishes deployment from
publication. Publishing is a separate operation; it is not a repair for a missing review.
