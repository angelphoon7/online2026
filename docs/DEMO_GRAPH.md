# The Graph beat: run of show

Steps 6-D, 8 and 10-B have a real Arc Testnet budget-change sample from 12 September 2026.
[Complete evidence, receipt links and recording notes](GRAPH_APPLY_BUDGET.md).

## Recorded sequence

| Beat | What to show | Observed evidence |
|---|---|---|
| 1 | Open the intent drawer and ask **Why can't this intent settle?** | Block **61770753**, `SETTLEABLE`, two intent legs, zero payment |
| 2 | Expand **Judge controls / change a signed condition**, select that intent, enter **-12**, click **Apply budget** | Revoke at **61770769**, replacement commit at **61770778**; both receipt links visible |
| 3 | Hold the indexing and block-change frames | **Indexing block #61770778**, old pool and answer hidden; drawer follows the new hash; diagnosis block **61770784** |
| 4 | Ask the same question about the new hash | Block **61771245**, `NOT_FOUND_WITHIN_BOUND`; answer identifies the signed payment limit |
| 5 | Expand **Evidence** | Supply stages all non-zero, `maxNetPay->cap` finds a candidate, dropping adjacency does not |

The original intent is now revoked:
`0xf7387010926792738ba5c0b1048ec46e5aa3197ba8ef81ca7976b8864d31baf0`.

The replacement to select is:
`0xa8304a351bbbe67ffc6d767114e57eb6504f96339aec8166602de1f8ada30488`.

It has nonce **79** and a signed limit of **-12 USDC**, meaning its owner must receive
at least 12 USDC. The other signed conditions and offered ticket order stayed the same.
The control changes a real commitment; editing a number in the input alone changes nothing.

## Watch the actual captures

1. [Before answer, real transactions, indexing and new hash](checks/graph-budget/apply-budget.webm).
2. [Read-only retry: changed answer and expanded evidence](checks/graph-budget/read-only-retry.webm).

The first capture includes an HTTP 503 when asking after the successful change. The second
capture repeats only public reads for the already-created new hash. No transaction was
resent. Both clips are at original speed; they are not an uninterrupted take. The block
transition and answer each have a held beat. Preserve both when editing a submission video.
Uploading/editing the final submission is separate from these recorded evidence clips.

The observed UI indexing phase lasted **3.018 seconds**. It is one measured browser wait,
including polling/HTTP time. Diagnosis computation and the later question retry are separate.
The final answer and evidence require no Anthropic key: this run used the deterministic
fallback with `model: null`, visibly labelled in the drawer.

## Why this budget was used

The pool changed after the earlier -4/-3 rehearsal. Its new read-only rehearsal found the
three largest other-leg debit ceilings totalled **11 USDC**, within the four-participant
cap. Requiring receipt of **12 USDC** made the signed condition bind. The final bounded
search found no settlement, while relaxing the budget produced a candidate.

This threshold is a property of the sampled signed intents. It is not a ticket price or a
constant for future demos. Do not use the old rehearsal hash or thresholds as fresh results.
[Rehearsal snapshot and bounds](checks/graph-budget-plan.json).

## Recheck without another transaction

```sh
node scripts/check-graph-budget-evidence.mjs
node scripts/record-graph-budget.mjs --verify
```

The first checks the saved observations offline. The second queries existing receipts and
opens the current replacement intent for a read-only browser verification. It does not click
Apply budget. The target still needs to be LIVE for this browser flow; future settlement,
revocation, expiry or pool changes can change the answer.

For a future new recording, first rehearse the current pool, verify the original answer on
screen, and only then apply a new signed condition. `scripts/prepare-graph-budget.mts` and
`record-graph-budget.mjs --check` are read-only. `--record` is the explicit transaction mode.
An existing attempt journal blocks another recording, so preserve and inspect it; do not
clear it simply to replay the old instructions.

Prerequisites for a new recording: a production build, Chrome and Playwright FFmpeg, working
Graph/Arc RPC reads, the relevant participant's local signing credential, and test USDC for
gas. The recorder enables judge controls only on its isolated localhost server. Public reads
and the deterministic agent answer need no signing credential.

Current validation: **50 tests passed**, production build/TypeScript passed, changed-file
lint passed, and [the live evidence assertions passed](checks/graph-budget/summary.json).
These checks cover this budget-change scene; Studio Synced/Logs and mainnet are separate.
