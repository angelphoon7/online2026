# Step 7-A / 7-D: one block for a diagnosis

Completed on 12 September 2026. Each question selects one pool snapshot at block **N**;
all additional state used by its diagnosis and hypothetical trials is read at **that exact N**.
[Live request trace and results](checks/graph-diagnosis-block.json).

## Read contract

| Data | How its block is bound |
|---|---|
| Pool, ticket metadata, custody, timestamp | One `getPoolSnapshot(minBlock)` result; all pages are pinned to N and checked against the first page's metadata ([pagination](GRAPH_PAGINATION.md)) |
| USDC balances | `balanceOf(owner)` with viem `blockNumber: N` |
| USDC allowances | `allowance(owner, Settlement)` with viem `blockNumber: N` |
| A commitment outside the live pool | `INTENT_BY_ID` with `intent(block: { number: N })` and `_meta(block: { number: N })` |
| Baseline, condition relaxations, what-if and tool fallback | Reuse the same snapshot and block-tagged capacity; they do not acquire a later snapshot |

The receipt's `minBlock` is a lower bound when choosing N. Once chosen, N is an exact block
for additional reads; using `number_gte: N` for a later lookup would permit a different state.
The closed-intent helper also checks the returned block, deployment, intent ID and closure
block. An intent revoked after N cannot be described as revoked at N.

`readCapacity(owners, block)` requires an explicit block. Its result carries that block, and
both diagnosis and hypothetical solving reject a mismatched cached result with
`SnapshotCapacityMismatch`. The dispatcher reads capacity once per question and shares it
across tools. Closed/excluded intents and unavailable what-if targets need no unrelated USDC
reads. The rehearsal scripts now pass the snapshot block too.

## Unavailable history

Neither Graph nor RPC failures fall back to `latest` or invent zero balances.

- An unavailable historical USDC read raises `SnapshotCapacityReadError`. Diagnose/ask return
  HTTP **503**, the named error and `snapshotBlock`; no diagnosis or answer is returned.
- Pruned Graph history raises `SubgraphHistoryUnavailable`, with `oldestAvailableBlock`, and
  returns HTTP **503**. Retrying the question selects a new complete snapshot.
- A freshness floor the indexer has not reached still returns **409**. Pruned history is
  distinguished before lag detection, since waiting cannot recover a discarded old block.
- Other failed closed-intent reads also fail the request. `UNKNOWN` is reserved for a
  successful lookup that found no intent at the selected block. Older stored evidence with
  `lookupFailed` remains renderable, but new requests do not use that partial-result path.

One diagnostic response can therefore have complete evidence for its selected block or
report a read failure. It cannot fill a missing historical fact with newer state.

## Real Arc / Graph checks

The acceptance script invokes the actual API route handlers and observes their outbound
requests to the real public endpoints. It does not mock responses, load private environment
files, call a model, or send transactions. These are handler-level checks, not a browser recording.

| Check | Block | Observed request evidence |
|---|---:|---|
| Live intent diagnosis | 61774403 | Four USDC `eth_call` requests, all tagged `0x3ae9a43` |
| No-model question and answer evidence | 61774421 | Four USDC reads at `0x3ae9a55`; answer and tool evidence carry the same block |
| Revoked intent diagnosis | 61774437 | Pool and exact-block intent lookup agree; `CLOSED / REVOKED`; no USDC reads |
| Historical USDC balance and allowance | 61770753 | Both historical calls succeeded at `0x3ae8c01` |
| Old Graph revocation boundary | 61770768 / 61770769 | Endpoint reported history only from 61772205; both queries were rejected without newer-state substitution |

The last row verifies handling of a real retention limit. It does **not** claim to have
reconstructed that old boundary from data the endpoint no longer retains. Advancing-head
regression fixtures separately prove that a later commitment/revocation does not alter an
older snapshot's diagnosis.

```sh
npm test
npm run build
npx --yes tsx --conditions=react-server scripts/check-diagnosis-block.mts
```

**63 tests passed**, including the new block-coherence/API failure cases. Production build
and TypeScript passed. Changed-file lint has no errors; the two existing unused-variable
warnings in `snapshot-fixture.mts` remain.

Tests cover both USDC calls, later funding, shared tool capacity, mismatched cached blocks,
historical closure, wrong Graph block/deployment, future closure metadata, unavailable RPC
history, unavailable Graph history, and the 503/409 distinction. No new transactions are needed.

This closes the same-block data-read gap. The later [Step 7-G / H follow-up](GRAPH_7G_7H.md)
binds narration to complete evidence-rendered passages and passed four real-provider cases
with eight Anthropic calls. Hosted deployment acceptance remains separate.
Execution still performs fresh chain checks and simulation, then the contract checks
the signed conditions again; historical diagnosis does not reserve state for settlement.
