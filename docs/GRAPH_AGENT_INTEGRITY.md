# Agent supply, inputs and commitment evidence

Follow-up to Steps 7-C/D/E/F/H and 8, 12 September 2026.

## Bounded supply diagnosis

The grouping search still checks at most 40 acceptable tickets, using the solver's existing
V5 predicate. `supply.groupSearched` and `supply.groupCandidates` expose the inspected count
and the eligible count. `largestGroup` is the largest group found in that inspected subset,
up to the requested count. It is not a maximum over uninspected tickets.

When `truncated` is true, grouping cannot set `blockedAt` or `firstZero` to claim a pool-wide
shortfall. The deterministic answer and drawer explicitly identify the subset and state that
the remaining tickets were not checked for grouping. Full event/session/section filters still
report their zero counts, and a complete grouping search can still name a grouping shortfall.
The guard accepts the qualified answer and rejects a substituted claim about the whole pool.

The regression fixture puts 40 separated seats before an adjacent pair at positions 41/42.
V5 accepts that later pair. Diagnosis now reports an incomplete grouping search, with
`groupSearched: 40`, `groupCandidates: 42`, `largestGroup: 1`, and `blockedAt: null`.
This does not promise that a settlement was found; the full solver remains bounded separately.

## Runtime validation of what-if changes

`parseWhatIfChanges` is shared by the tool dispatcher, `whatIf`, and `applyChanges`.
Only payment limit, the three boolean predicates, and additional session/section arrays are
accepted. Unsupported fields are rejected rather than silently ignored. Boolean strings,
numeric booleans, null values, malformed containers, non-finite/out-of-range payments,
and invalid class arrays are rejected with `WhatIfError`.

Class IDs must be integers from 0 through 255; arrays contain at most 256 entries. Payment
limits remain signed USDC within the existing demo range of -1,000,000 to +1,000,000.
Valid changes are copied and validated before applying them; the input object is not mutated.
An empty changes object is valid and asks about the existing conditions.

The `what_if` tool additionally requires a valid intent hash and a changes object, rejects
unexpected top-level keys, and checks input before reading payment capacity. Invalid input
returns `{ code: "WhatIfError", error, submittable: false }` to the model. It cannot produce a
candidate or transaction payload. Unknown/non-live intents do not bypass changes validation.

## Commitments belong to intents

The owner-to-transaction `counterpartyTx` map has been replaced in current API responses by
`counterpartyIntents: { intentHash, owner, committedTx }[]`.

`solveHypothetical` derives these references from the chosen candidate's actual intent hashes
and the same pinned snapshot. Baseline diagnoses, each individual relaxation, and explicit
what-if results carry their own references. The diagnosis-level array is their union, deduped
by intent hash. Two participating intents from one wallet therefore retain separate links;
an unrelated later commitment from that wallet cannot overwrite either reference.

The drawer renders the references beside their baseline, relaxation or what-if candidate,
including the intent identifier and the corresponding commit transaction. It selects the
diagnosis for the currently selected intent instead of taking the first diagnosis tool result.
Saved historical JSON evidence retains its original shape; current API consumers must use
`counterpartyIntents` rather than interpreting an owner as a unique commitment.

## Verification

`server/__tests__/agent-integrity.mts` adds 58 checks including subcases. They cover the
unsearched adjacent pair, complete grouping shortfalls, strict changes validation before I/O,
signed amounts and masks, unrelated commitments from one owner, and two participating intents
from one owner. The existing full Graph/Agent suite passes 186 checks.
[Full test output](checks/graph-agent-integrity-tests.txt).

The browser regression in `tests/browser/indexing.spec.ts` checks selection of the correct
intent's evidence, explicit grouping scope, and distinct baseline/relaxation/what-if links.
All three browser tests passed, including the existing receipt-floor cases. Production build,
TypeScript and changed-file ESLint also passed. [Browser results](checks/graph-agent-integrity-browser.json).
The runner exited successfully after cleanup of its test-only server; Windows sandbox
restrictions required verified process cleanup outside the sandbox.

All test inputs and upstream responses are fixtures. This follow-up does not establish live
Anthropic acceptance or send an on-chain transaction.
