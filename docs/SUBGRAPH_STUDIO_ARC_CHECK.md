# Subgraph Studio: Arc Testnet support check

Checked: **2026-09-09**.

**Result: Studio is serving indexed Arc Testnet data. Continue the Arc subgraph implementation; do not redeploy the contracts to another chain on the assumption that Arc indexing is unsupported.** Creating and deploying a new subgraph under the project's Studio account remains a separate, unverified step.

## What was actually checked

| Check | Observation | What it establishes |
| --- | --- | --- |
| Open Studio in an isolated browser | The live dashboard displayed `DISCONNECTED WALLET` and `Connect wallet to use Studio`. | Studio was visited, but the authenticated creation screen and its network selector were not reached. |
| Official network registry | `arc-testnet`, `eip155:5042002`, with `https://api.studio.thegraph.com/deploy` in its subgraph services. | Studio is listed as a service for Arc, beyond a generic chain-ID entry. |
| Query a public Studio deployment | The existing ArcNS subgraph returned `_meta`, a deployment ID, an indexed block and `hasIndexingErrors: false`. | Studio is actually serving indexed data, rather than only advertising the network. |
| Compare the indexed block with Arc RPC | Arc returned chain ID `5042002`; the same block number returned exactly the hash reported by Studio. | The indexed data belongs to Arc Testnet. |
| Studio indexing-status API | The read-only status query returned `UNAUTHENTICATED` / `Please login first.` | Account-level status inspection requires authentication; it was not bypassed. |

The latest recorded query indexed block **61290055**, with no indexing errors. The full timestamp, deployment ID, block hash, registry entry and RPC comparison are in [the machine-readable evidence](../deployments/graph-studio-support-check.json).

## Sources and reproducibility

- [Subgraph Studio dashboard](https://thegraph.com/studio/).
- [The Graph's Arc Testnet registry entry](https://github.com/graphprotocol/networks-registry/blob/main/registry/eip155/arc-testnet.json).
- [Public Studio query endpoint used for this check](https://api.studio.thegraph.com/query/1748590/arcnslatest/v3), discovered through the [ArcNS project's published endpoint](https://github.com/khenzarr/arcns). This is a third-party project, not RESHUFFLE and not proof of our integration.

The public query was:

```graphql
{
  _meta {
    deployment
    block { number hash }
    hasIndexingErrors
  }
}
```

Re-run the read-only checks and refresh the evidence file from the repository root:

```sh
node scripts/check-studio-arc.mjs
```

This script uses public endpoints. It does not read private keys, connect wallets, create a subgraph, deploy contracts or modify environment files. The public example can change or disappear; a future query failure alone would not prove Arc support was removed.

## Remaining gate for RESHUFFLE

1. Connect the intended project wallet to Studio and complete its authentication. Inspect the project's creation flow in that authenticated account.
2. Create the RESHUFFLE subgraph and obtain its deploy key locally. The intended manifest network identifier is `arc-testnet`; chain ID is `5042002`.
3. Index the existing four addresses from [the deployment manifest](../deployments/arc-testnet.json), starting no later than block `61264501`.
4. Deploy, inspect indexing status, and query actual RESHUFFLE entities, including the existing settlement transactions. A successful public example is not a substitute for this check.
5. Configure our own endpoint and the required server-side credentials, then make the backend consume those entities and recheck freshness against chain state.

No Graph endpoint was installed or configured during this check. The application still uses RPC discovery, and the architecture's planned-subgraph label remains accurate. Successful indexing alone also does not establish bounty qualification: the backend must meaningfully consume the live indexed data.

If a new deployment is rejected, record the exact Studio/CLI error before considering a chain migration. Network support, account permissions, manifest validity and indexing failures are different problems.
