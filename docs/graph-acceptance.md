# Subgraph acceptance — step 4

Measured results for `reshuffle` on Arc Testnet. Every figure here came from a script in this
repo, run against the live deployment. Re-run after any redeploy or reseed.

| | |
|---|---|
| Subgraph | `reshuffle` v0.1.1 |
| Query URL | `https://api.studio.thegraph.com/query/1760168/reshuffle/v0.1.1` |
| Deployment | `QmcCXyzCr7YWjx1joA5mqNmnz4Byk5C34QMFS94FPnsVRL` |
| Network | arc-testnet (chainId 5042002) |
| Indexing errors | none |

Commands:

```bash
npm run subgraph:parity     # audit the index against chain state
npm run subgraph:lag        # measure how far the index trails the chain head
```

---

## 4-A Acceptance

### Entities populated

At block 61643973:

| Entity | Count | Detail |
|---|---|---|
| `Intent` | 121 | LIVE 73, SETTLED 46, REVOKED 2 |
| `Ticket` | 164 | 130 escrowed, 0 redeemed |
| `Settlement` | 15 | 3 intents each |

All three intent states occur, so `IntentCommitted`, `IntentRevoked` and `Settled` handlers
all fire. No ticket carries placeholder metadata, so `TicketMinted` is always indexed before
the ticket is first referenced and the `meta()` fallback never ran.

### Indexing delay — measured, 12 samples at 2.5s

```
  gap blocks     min -4  median 4  mean 3.4  max 11
  block time     0.55s  (observed over 54 blocks of head movement)
  gap seconds    median ~2.2s  max ~6.1s  (inferred from the gap)
  caught up      indexed advanced 59 blocks while the head advanced 54 — keeping pace
```

**Use ~2s as the expected on-screen duration of "Indexing block #M…", and ~6s as the worst
case observed.** The gap is directly measured; the seconds are inferred from the observed
block time, not from a published constant.

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
could not match. This is what makes a wrong intent impossible rather than merely unlikely, and
it is why the solver can treat subgraph output as trustworthy input.

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
