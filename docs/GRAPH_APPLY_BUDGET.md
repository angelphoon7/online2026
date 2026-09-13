# Apply budget: Steps 6-D, 8 and 10-B

Verified on Arc Testnet on 12 September 2026 through the real production UI and public
Graph/RPC endpoints. The two transactions below succeeded. No API responses were mocked.
[Assertion summary](checks/graph-budget/summary.json) · [Independent receipt/calldata/Graph verification](checks/graph-budget/verification.json).

## The two real transactions

| Operation | Receipt block | Transaction |
|---|---:|---|
| Revoke the old intent | 61770769 | [0x0c477d9ea7156fb418c17464f3fb49fd83b06d14bf38bafccbc9e570284b3430](https://testnet.arcscan.app/tx/0x0c477d9ea7156fb418c17464f3fb49fd83b06d14bf38bafccbc9e570284b3430) |
| Commit the replacement | 61770778 | [0x3d9fd3d353e564b9a48add42266480d059ad78ce820f9f07de81516b6e93000a](https://testnet.arcscan.app/tx/0x3d9fd3d353e564b9a48add42266480d059ad78ce820f9f07de81516b6e93000a) |

- Old intent: `0xf7387010926792738ba5c0b1048ec46e5aa3197ba8ef81ca7976b8864d31baf0`, now **REVOKED**.
- New intent: `0xa8304a351bbbe67ffc6d767114e57eb6504f96339aec8166602de1f8ada30488`, **LIVE** at verification.
- Signed limit: **0 → −12 USDC**. A negative limit means the owner must receive at least 12 USDC.
- Intent nonce: **15 → 79**. Revocation does not release the old nonce.
- The other signed conditions and the ordered offered tickets **36, 37** are unchanged.

RPC verification decoded both transactions, checked their successful receipts, registry
destination and owner, recomputed the new struct hash from commit calldata, and checked the
new nonce reservation. Graph verification independently found the old closing transaction
and the new commitment transaction, budget and nonce. Contract addresses come from
`deployments/arc-testnet.json` through the shared deployment loader.

These calls change commitments; they do not execute settlement or transfer a payment.
Actual native gas fees were **0.000626778 + 0.00212622975 = 0.00275300775 test USDC**.
Revoke and commit used explicit gas limits of 200,000 and 400,000 respectively.

## What the browser showed

| Beat | Observed result | Capture |
|---|---|---|
| Before | Block **61770753**, `SETTLEABLE`, two intent legs, zero payment | [Before](checks/graph-budget/01-before.png) |
| Receipts | Both hashes visible; **Indexing block #61770778**; old pool and answer hidden | [Indexing](checks/graph-budget/02-indexing.png) |
| Refreshed diagnosis | Drawer automatically follows `0xa8304a35…`; block **61770784** | [New hash](checks/graph-budget/03-new-hash.png) |
| Same question, later state | Block **61771245**, `NOT_FOUND_WITHIN_BOUND`; answer identifies the signed budget | [After](checks/graph-budget/04-after.png) |
| Evidence | Supply stages remain non-zero; `maxNetPay->cap` finds a candidate; removing adjacency does not | [Evidence](checks/graph-budget/05-evidence.png) |

The observed UI indexing phase lasted **3,018 ms**: from the receipt floor becoming visible
at `18:21:37.880Z` until the refreshed workspace was accepted at `18:21:40.898Z`.
This includes polling and HTTP time; it is one browser observation, not an indexer latency
guarantee. The later diagnosis/answer computation is separate from this wait.

Every recorded market, judge-list and agent request after the budget response carried a
floor of at least **61770778**. The new-hash diagnosis request specifically carried
`minBlock=61770778`. No old pool or old answer was displayed during the observed wait.
[Request and DOM transition log](checks/graph-budget/live.json).

The final answer began:

> At Arc Testnet block #61771245, no settlement was found within the search bound.

The live rehearsal chose −12 from the current signed limits: the largest combined debit
ceilings on the other three allowed legs were 11 USDC. This is specific to that snapshot
and the four-participant cap. The UI and agent continue to report bounded search results.
The old −4/−3 rehearsal values are not current instructions.
[Read-only rehearsal](checks/graph-budget-plan.json).

## Recording and read-only retry

- [Clip 1: before answer, Apply budget, both receipts, indexing and automatic new hash](checks/graph-budget/apply-budget.webm).
- [Clip 2: read-only question retry on that same new hash, changed answer and evidence](checks/graph-budget/read-only-retry.webm).

Both clips are original **1× speed**, with visible held beats; they are two captures rather
than a claimed uninterrupted take. After the successful transactions and indexing, the
first question attempt returned HTTP 503. The second clip retries public reads only; it
does not repeat either transaction. The original capture/report retains that failure.
These are local evidence clips; uploading or editing a final submission video is separate.

The recording server had `ANTHROPIC_API_KEY` unset. `/api/agent/ask` returned the deterministic
answer and complete diagnosis evidence with `model: null`. No model key is needed for this beat.

## Implementation and checks

The judge backend now starts nonce selection above this owner's highest known live nonce,
then verifies availability against `usedNonce` on-chain. This avoids walking every old nonce
when editing an early intent. Closed and unindexed reservations still win over the Graph hint.
The original nonce walk made 64 sequential checks for this intent; the revised walk found 79
with one check. Three regression tests cover owner scoping, retained reservations and failures.
Unexpected budget errors now emit a limited server diagnostic without signing data.

An earlier HTTP 500 attempt left the old intent LIVE and the operator at transaction nonce
338 with no pending transaction. Its journal was preserved before recovery. The precise
original exception was not logged, so it is not attributed conclusively to nonce lookup.
The successful recording then produced exactly the two receipts above.

Validation: **50 tests passed**, production build/TypeScript passed, changed-file lint passed,
and the real browser/RPC/Graph evidence assertions passed.

```sh
# Recheck the saved observations; no network or transactions.
node scripts/check-graph-budget-evidence.mjs

# Query the existing new intent and verify existing receipts. Never resubmits.
node scripts/record-graph-budget.mjs --verify
```

For a separate future recording, rehearse against the then-current pool with
`scripts/prepare-graph-budget.mts`, run `record-graph-budget.mjs --check`, then explicitly
run `--record`. The recorder starts an isolated localhost production server and needs
Google Chrome plus `npx playwright install ffmpeg`. It requires an existing production build.
A prior attempt journal stops another write; preserve it and inspect its receipts rather
than deleting it to force a retry. Signing credentials remain in local server environment files.

This verifies the Apply budget path of Step 8. Other actions use the shared floor covered by
[Step 6-B / 8 regression checks](GRAPH_6B_8.md); this recording does not claim to have broadcast
every other action. It also does not close the separate Studio Synced/Logs check or mainnet work.
