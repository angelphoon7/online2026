# Step 8 — intent-scoped drawer evidence

The drawer binds each accepted answer to the selected intent hash, the answer's snapshot
block and the current market freshness revision. It no longer chooses the first diagnostic
tool result regardless of the intent being inspected.

## Selection and freshness

- The direct diagnosis response must contain the requested intent hash. The request URL
  alone is insufficient evidence of identity.
- `diagnose_intent` and `what_if` are selected by their **output** `intent`, case-insensitively.
  Model-written tool inputs do not establish the identity of a successful result.
- Each selected diagnostic/hypothetical result, and each `pool_overview`, must have exactly
  the answer's block. A conflicting block rejects the answer and its evidence together.
- Other intents' results are omitted from both the visible cards and the expandable JSON.
  An omission count makes this explicit. They never replace the selected diagnosis.
- Answers are stored together with their validated tool results. Starting another question
  clears the earlier answer and diagnosis. A pool-only or what-if-only answer cannot inherit
  a diagnosis fetched before that question.
- The existing receipt floor, revision tags, cancellation checks and `Indexing block #M`
  flow still apply. A result arriving after a budget replacement cannot restore the earlier
  intent or an older pool.

Malformed tool result shapes produce a retry error before rendering. Failed tool calls are
shown separately as errors; they are not interpreted as a failed matching search.

## What the Evidence panel shows

| Tool | Visible evidence |
| --- | --- |
| `diagnose_intent` | Selected intent and block, status, exclusion/closure, supply funnel, bounded grouping, demand, single-condition trials, candidate commitment links and search bounds |
| `what_if` | Every returned call, its intent/block, actual requested changes (including `false` and signed USDC limits), candidate participants, this intent's net payment, received ticket IDs, individual counterparty commitment links, configured search bounds and read-only status |
| `pool_overview` | Snapshot block, searchable live intents, escrowed/unredeemed tickets, pure buyers/sellers, ticket counts by session and section, and exclusion counts by reason |

What-if cards distinguish **candidate found**, **no candidate found within the search bound**,
and **not evaluated because the intent was not live**. A hypothetical payment limit is shown
separately from the net payment of the candidate that was actually found. Acting on changed
conditions still requires a new signed intent and settlement validation.

Pool counts describe the returned indexed snapshot, across events. Escrowed inventory is
not necessarily offered in a live intent or compatible with the selected intent. Zero totals
and empty distributions are displayed explicitly. Existing upstream snapshot size limits
still apply; this change does not add pagination or claim to search an unlimited market.

The Evidence panel renders even when the answer contains no diagnosis. Its nested JSON
section exposes every accepted input/output and any supplied model/fallback provenance;
it is collapsed by default. Tool-call errors may lack a snapshot identity: their inputs
identify only the attempted call, and the panel labels them as errors rather than chain facts.

Implementation: [scope validation](../lib/agent-evidence.ts),
[drawer state](../component/market/AgentDrawer.tsx),
[tool panels](../component/market/AgentToolEvidence.tsx),
[shared wording](../lib/agent-copy.ts).

## Verification

Regression fixtures cover foreign diagnoses appearing first, input/output hash disagreement,
case-insensitive hashes, mismatched blocks for each tool, what-if-only/pool-only answers,
candidate and unsuccessful results, signed micro-USDC, exact commitment links, zero counts,
malformed results and clearing previous answers. Browser tests also retain the receipt-floor
and partial-budget-replacement scenarios.

All browser API requests are intercepted. These checks make no wallet, on-chain transaction
or Anthropic calls. Live model-provider acceptance remains a separate Step 7-G/H check.

- **215 Graph/agent checks passed**, including 29 drawer evidence checks.
  [Captured test output](checks/graph-drawer-evidence-tests.txt).
- **9 browser tests passed**, including independent tool panels and the existing receipt-floor
  scenarios. The fixture models the judge controls' authenticated session endpoint; it does
  not connect to the real login or signing routes.
  [Browser result record](checks/graph-drawer-evidence-browser.json).
- Production build, TypeScript and lint for the changed implementation and tests passed.

Reproduce with `npm test`, `npm run build`, and `npm run test:browser`. Browser tests start
the production build locally and require an installed Chrome (or `PW_BROWSER` override).
