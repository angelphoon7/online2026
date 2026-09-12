# Step 6-B / 8: freshness after transactions

Implemented and checked on 12 September 2026 for the main market workspace and Agent drawer.

## Receipt → indexing → refreshed pool

The receipt block raises a shared, monotonic freshness floor immediately. Every periodic,
manual, reconnect and post-write market read uses that floor. Successful Graph metadata polling
is followed by a market read with `number_gte` on all four roots; the returned block is checked
again before replacing the displayed market. Concurrent requests are coalesced only when their
floor agrees. A pre-transaction response or an older receipt cannot roll state backwards.

Until the replacement snapshot passes those checks, the workspace shows **Indexing block #M**,
keeps confirmed transaction links visible, hides the old pool/matching data and disables actions
that depend on it. The intent builder stays mounted so its draft survives the wait.
`SubgraphLagTimeout`, `SubgraphIndexingError` and stale-response errors retain the pending block.
**Retry indexing** repeats the wait and read; the 30-second refresh also retries using that floor.
The 90-second indexing deadline includes network requests, including a hung fetch.

The public receipt floor is saved in session storage, scoped by chain ID and registry address,
so reconnecting or reloading the same tab does not forget a pending Arc write. No wallet key or
signature is stored there. Local Anvil uses RPC snapshot checks and skips Graph polling; its
floor is not persisted across local chain resets.

| Action | Freshness input |
|---|---|
| Deposit / Withdraw | Successful RPC receipt block |
| Sign and commit / Revoke / Redeem | Successful RPC receipt block |
| NFT / USDC approval | Successful RPC receipt block |
| Free-ticket issuance | Final successful mint receipt, from RPC |
| Propose and settle | Successful receipt block, recorded before receipt-detail loading |
| Apply budget | Confirmed commit block; both revoke and commit links appear immediately |
| Budget replacement fails after revoke | Backend returns the confirmed revoke block/hash, which still raises the floor |
| Local demo preparation | The operator's post-preparation verification block; this is explicitly a verification floor |

A reverted settlement does not raise the receipt floor because it changed no market state.
Existing floors remain in force. Waiting or retrying indexing never resubmits a transaction.
For a submission whose receipt is not yet known, transaction-status recovery is still required;
these checks start from an observed confirmation, not from a guessed block number.

## Agent drawer and judge list

The drawer shares the same floor and pending state. Both diagnosis and question requests carry
`minBlock`. Waiting disables Ask and hides answers/evidence from the earlier revision.
In-flight requests are aborted on context changes; revision, hash and returned block checks
also reject late responses. Once the refreshed pool is accepted, the drawer automatically
loads diagnosis for the current hash. Apply budget moves selection to `newHash` immediately.

Questions use at least the currently displayed evidence block. An answer's diagnosis must refer
to its answer block; an unrelated earlier diagnosis is not retained as its evidence. The judge
participant list also sends the same floor and waits before reloading after a change.

This fixes post-confirmation freshness. It does not address the separate Step 7 findings about
pinning all payment-capacity reads or validating every model-generated numerical claim.

## Validation and reproduction

```sh
npm test
npm run build
npm run test:browser
```

- **47 assertion-based tests passed**, including eight market freshness/request-race checks and
  six named wait tests. The old wait file's logging-only scenarios have been replaced by assertions.
- **Two Chrome browser regressions passed** against the production build. They cover an old
  market request and old agent answer arriving after a receipt, indexing failure, HTTP 200 with
  an old entity block, retry, new-hash diagnosis, question floors, reload persistence and a
  partial budget failure. [Browser results](checks/graph-freshness-browser.json).
- Production build / TypeScript passed. Lint reported no errors; two existing unused-variable
  warnings for `opened` / `setOpened` remain in `Market.tsx`.

The browser command needs an installed Google Chrome. It starts its own server on port 3215,
uses a fresh browser profile and intercepts every API request. It performs no wallet signing,
real transaction or model call. Its fixture blocks 100/200 are regression inputs, not chain
evidence. Local traces/results stay under `.data/browser-tests/`. Real-chain latency remains
the separate [Step 4-A measurement](graph-acceptance.md); a live budget-change video is still
a distinct submission deliverable.
