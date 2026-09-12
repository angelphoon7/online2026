# Subgraph acceptance — step 4

Measured results for `reshuffle` on Arc Testnet. Every figure here came from a script in this
repo, run against the live deployment. Re-run after any redeploy or reseed.

| | |
|---|---|
| Subgraph | `reshuffle` v0.1.1 |
| Query URL | `https://api.studio.thegraph.com/query/1760168/reshuffle/v0.1.1` |
| Deployment | `QmcCXyzCr7YWjx1joA5mqNmnz4Byk5C34QMFS94FPnsVRL` |
| Network | arc-testnet (chainId 5042002) |
| Public `_meta.hasIndexingErrors` | `false`; see the dated [status check](checks/graph-status.json) |
| Studio UI | User screenshot shows Deployed / Not published / Subgraph not indexed; a Synced label and complete warning history are not established |

Commands:

```bash
npm run subgraph:parity     # audit the index against chain state
npm run subgraph:lag        # measure how far the index trails the chain head
npm run subgraph:status     # public health, block hash and inventory count checks
npm run subgraph:lag:tx -- --check 10  # read-only preflight for a receipt-to-index sample
```

---

## 4-A Acceptance

Latest read-only follow-up: block **61797886**, 183 intents / 284 tickets / 250 escrowed /
15 settlements, no indexing errors, and matching RPC block hash and ticket counts.
The private Studio status and full warning/error log review remain pending.
[Exact remaining panel checks](GRAPH_STUDIO_REVIEW.md).

### Follow-up, 12 September 2026

The public endpoint was healthy at **61762011**: 122 intents (74 LIVE, 46 SETTLED, 2 REVOKED),
164 tickets, 130 escrowed and 15 settlements. The indexed block hash, total minted tickets and
escrow balance match RPC reads pinned to that block; the initial seed commitments are present.
[Machine-readable status and count checks](checks/graph-status.json).

One real `TicketNFT.transferFrom(owner, owner, 10)` was confirmed in block **61762063**.
The timer started immediately when the RPC receipt was observed. The Graph returned behind
four times, then returned `_meta.block.number=61762071` and the ticket's
`updatedAtBlock=61762063`. **Observed receipt-to-index wait: 7,294 ms, five queries.**
The checks also verify the deployment ID, unchanged owner and `hasIndexingErrors=false`.
[Transaction](https://testnet.arcscan.app/tx/0x276568800432ccaaf83bfac6377de48644b8222008205ec9c3ba6b14533f479e)
· [Timing, polling and entity evidence](checks/graph-transfer-10.json).

This is one sample including request latency, polling and local receipt checks. It is not a
processing-time percentile, maximum delay or a measurement of the browser's indexing banner.
The actual gas fee was 0.00063664 test USDC; custody and ownership did not change. It does not
prove the separate Apply budget revoke/commit or recording requirements. Those now have
[their own live receipts and browser evidence](GRAPH_APPLY_BUDGET.md), recorded separately
at commit block **61770778**.

The user-provided Studio screenshot shows INFO write batches through block 61761333, together
with Deployed, Not published and Subgraph not indexed labels. Its visible rows contain no
`reverted` / `unknown intent` warnings, but a cropped log view cannot establish their absence
across the full history. **The literal Studio Synced / complete Logs check remains open.**
Deployment and publication are separate: Studio's development endpoint can be queried before
publication. [The Graph's Studio deployment documentation](https://thegraph.com/docs/en/subgraphs/developing/deploying-publishing/using-subgraph-studio/).

For another sample, choose an unredeemed ticket outside escrow, held by the public deployment
operator, and run `npm run subgraph:lag:tx -- --check TOKEN_ID`. Then explicitly run
`npm run subgraph:lag:tx -- --send TOKEN_ID`. The send command uses the local testnet credential,
checks a 0.02 test-USDC fee ceiling and keeps a private journal under `.data/graph-acceptance/`.
A completed token sample is not resent; an interrupted journal stops the command for inspection.
Public reports contain no private keys or raw signed transaction. Do not delete a journal to
force a retry. The send mode is a real testnet transaction, whereas check mode is read-only.

### Entities populated

At block 61643973:

| Entity | Count | Detail |
|---|---|---|
| `Intent` | 121 | LIVE 73, SETTLED 46, REVOKED 2 |
| `Ticket` | 164 | 130 escrowed, 0 redeemed |
| `Settlement` | 15 | 3 intents each |

All three intent states occur, showing populated commitment, revocation and settlement data.
The parity run checks ticket metadata against the chain; populated metadata alone does not
prove whether the mapping's `meta()` fallback ever ran.

### Indexing delay — measured, 12 samples at 2.5s

```
  gap blocks     min -4  median 4  mean 3.4  max 11
  block time     0.55s  (observed over 54 blocks of head movement)
  gap seconds    median ~2.2s  max ~6.1s  (inferred from the gap)
  caught up      indexed advanced 59 blocks while the head advanced 54 — keeping pace
```

The gap is directly measured; the seconds are inferred from observed block time. These
samples do not measure how long "Indexing block #M…" remains on screen after a particular
transaction. The dated follow-up above records a separate receipt-to-index sample.

Two caveats that matter beyond this table:

- **The gap can read negative.** That is not the subgraph running ahead of the chain. Arc's
  public RPC is load balanced and its reported head can itself be a few blocks stale. Since
  `waitForIndexed()` (plan 5-E) compares the subgraph against a block number obtained from
  that same RPC, a target block can briefly appear already-indexed. The freshness floor still
  holds — `number_gte` is enforced by graph-node, not by the client — but do not treat the
  RPC head as ground truth in UI copy.
- This is steady-state trailing distance, not a round-trip measurement for one specific
  transaction. They coincide only while graph-node is keeping pace, which the `caught up`
  line reports.

---

## 4-B Parity against chain state

`scripts/check-subgraph-parity.mjs` audits the indexer against Arc, pinned to the subgraph's
own indexed block so both sides describe the same moment.

```
subgraph  https://api.studio.thegraph.com/query/1760168/reshuffle/v0.1.1
deployment QmcCXyzCr7YWjx1joA5mqNmnz4Byk5C34QMFS94FPnsVRL
indexed block 61643973, chain head 61643975, lag 2 blocks
comparing at block 61643973 (pinned to the indexed block)
intents 121, tickets 164

hash binding verified on 121 intents

PASS — 1719 checks at block 61644115: 121 intents, 164 tickets
```

This historical excerpt mixes the initial block of one run with another completion block.
Use the consistent [step 11 report at block 61754713](checks/step-11-parity.txt) for submission.

### What the 1719 checks cover

| Check | Count | Against |
|---|---|---|
| Hash binding | 121 | `hashIntent()` recomputed off-chain == the published `id` |
| Intent state | 121 | `IntentRegistry.state(hash)` |
| Ticket owner | 164 | `TicketNFT.ownerOf` |
| Escrowed / depositor | 328 | `Escrow.depositor` |
| Redeemed + eventId/session/section/row/seat | 984 | `TicketNFT.meta` |

**Hash binding is the load-bearing one.** The registry keys on the bare struct hash, so
re-hashing binds all twelve signed fields at once: had the indexer altered any field, the hash
would be rejected by the hash comparison. This binds the signed intent fields; it does not
authenticate indexed ticket metadata, prove query completeness or replace chain-state checks.

### The check is falsifiable

A passing check proves nothing unless it can fail. Verified by injecting a fault — swapping
`row` and `seat` in the GraphQL projection:

```
FAIL ticket 106 row: chain=20100 graph=7
FAIL ticket 106 seat: chain=7 graph=20100
...
111 pass, 22 fail
```

### Notes on running it

- Arc's public RPC rejects JSON-RPC batching with `Request exceeds defined limit` and rate
  limits sustained reads. The script therefore issues one call per request at concurrency 2
  with exponential backoff. A full audit of 121 intents and 164 tickets takes ~90s. Raise with
  `PARITY_CONCURRENCY` on a private RPC.
- A dropped read is reported as a failed *read*, never as a mismatch — a rate limit must not
  be mistaken for a parity violation.
- Historical `eth_call` at the indexed block does work on Arc's public RPC, so reads are
  pinned. If that changes, the script says so and falls back to the head; pass `--latest` to
  force it, which is only sound while no transactions are in flight.

---

## Step 9 test evidence

Every figure below came from an actual run; nothing here is estimated.

### Captured fixture

`node scripts/capture-snapshot.mjs` writes the untouched PoolSnapshot response body to
`fixtures/snapshot-<block>.json`. The current capture:

```
captured fixtures/snapshot-61727725.json
  block 61727725 · 73 live intents · 130 escrowed unredeemed tickets
```

The fixture exists so the diagnosis tests exercise the real `getPoolSnapshot` parse path —
hash binding, signed-integer conversion, the V1–V3 exclusions — against data graph-node
actually produced, rather than a hand-built object that skips all of it. Re-capture after
re-seeding. Never hand-edit a fixture: an edited one stops being evidence.

### Suite

`npm test` — 31 tests, 31 passing, across five files:

| File | Covers |
|---|---|
| `shared/graph/__tests__/snapshot-exclusions.mts` | Each named exclusion reason (HASH_MISMATCH, EXPIRED, TICKET_UNKNOWN, TICKET_REDEEMED, TICKET_NOT_IN_ESCROW withdrawn and wrong-owner, WRONG_EVENT), plus deadline-equals-block being *not* expired |
| `shared/graph/__tests__/wait.mts` | `waitForIndexed` backoff, timeout, indexing-error short circuit, abort |
| `server/__tests__/snapshot-fixture.mts` | Real indexed data: all 73 intents re-hash to their committed ids; ticket metadata survives the parse; one altered field is caught and only that intent; signed `maxNetPay`; a real diagnosis whose sentence passes the guard; the same diagnosis twice is identical |
| `server/__tests__/diagnose.mts` | Budget-blocked, adjacency-blocked, section-blocked, nobody-wants-your-tickets, settleable, excluded, revoked; what-if never submittable; the three guard rejections |
| `server/__tests__/solve-hypothetical.mts` | A hypothetical is never submittable; a raised budget settles; a candidate excluding the hypothetical is not reported as found; V8 capacity is enforced |

Every case asserts a **named** result — which stage blocks, which relaxation worked, what the
participant would pay. A rejection test that passes for the wrong reason is indistinguishable
from one that passes correctly, which is why `snapshot-exclusions.mts` was converted from a
print script into assertions: as a print script it passed no matter what it printed.

One bug that conversion found: `Exclusion.detail` is a readable phrase (`ticket 2 is not in
escrow`), not a bare ticket id, and the agent's template was interpolating it as one —
producing `ticket #ticket 2 is not in escrow is no longer escrowed by its owner`. Fixed in
`server/agent/template.ts`, which now appends the detail whole.

### Parity, re-run after the agent work

```
subgraph  https://api.studio.thegraph.com/query/1760168/reshuffle/v0.1.1
deployment QmcCXyzCr7YWjx1joA5mqNmnz4Byk5C34QMFS94FPnsVRL
indexed block 61728176, chain head 61728185, lag 9 blocks
comparing at block 61728176 (pinned to the indexed block)
intents 121, tickets 164

hash binding verified on 121 intents

PASS — 1719 checks at block 61728176: 121 intents, 164 tickets
```

### What is not covered by an automated test

- **The hypothetical-to-settle rejection** the plan asks for has no endpoint to test: there is
  no `/settle` route. The frontend re-solves from committed hashes and submits from the user's
  wallet, so a hypothetical has no channel to a transaction at all. `submittable: false` is a
  literal type and the result shape carries no calldata, which is a stronger guarantee than
  the test would have been.
- **`/api/agent/ask` narration** is not asserted against a live model: the deterministic engine
  and the guard are tested, and the guard is what decides whether any model answer is shown.
- **The end-to-end demo sequence** is step 10, and is manual.
