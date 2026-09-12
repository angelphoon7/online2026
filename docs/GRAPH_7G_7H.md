# Step 7-G / H: evidence-bound answers

Checked 12 September 2026. **Implementation and local validation complete; live Anthropic
acceptance remains pending.** The local environment has no `ANTHROPIC_API_KEY`. The
[live acceptance record](checks/graph-agent-model.json) is `BLOCKED`, with zero model requests;
SDK transport fixtures are not counted as live model calls.

## What changed

`server/agent/guard.ts` requires the exact opening `At Arc Testnet block #N, `, rejects
additional inconsistent block references, and checks tool outputs belong to N. Ticket `#7`
and the historical block of a revocation do not redefine the snapshot block. Model-supplied
tool inputs cannot establish an address, transaction or claim.

A number allowlist cannot check whether a model reverses a payment direction, exchanges a
ceiling with an actual payment, or describes a hypothetical as executed. Instead,
`answer-options.ts` renders complete supported passages from each tool's result. Claude
selects tools and a relevant passage; it must copy that passage. The guard recomputes the
passages from the outputs and compares the whole answer, allowing only whitespace variation
after the mandatory prefix. It does not trust a model-supplied list of approved text.

This binds six-decimal USDC amounts to payer/receiver direction, participant and counterparty
counts, section/session counts, ticket IDs, candidate status, and the particular hypothetical
tested. A proposed negative limit is a minimum receipt. Each hypothetical answer includes its
changed conditions and the requirement for a new signature. Arbitrary extra prose, shortened
invented identifiers and omitted qualifications are rejected. Responses remain plain English.

Only the selected intent's diagnosis/hypotheticals can be narrated. Pool overview is a separate
market-wide result. A rejected, empty, refused, truncated or exhausted reply uses the selected
intent's deterministic diagnosis at N. Its evidence is attached with `source: fallback` if the
model never requested that diagnosis; it cannot retroactively authorize the rejected answer.
A fallback diagnosis belonging to another block throws `AgentEvidenceMismatch`.

`narrate.ts` records provider message ID, request ID, returned model, stop reason and token
usage in `modelCalls`, alongside the existing tool log. It permits four model turns, eight
tool calls total and 4,096 output tokens per turn. Each model request has a 45-second timeout
and no automatic retry. These are configured bounds, not performance measurements. This is
not an overall deadline for Graph/RPC reads and solver work.

The drawer labels accepted responses as evidence selected by the model. A rejected model
response is labelled as a deterministic answer; it is not presented as successful narration.

## Local verification

| Check | Result |
| --- | --- |
| `npm test` | 95 passed, 0 failed; includes 32 added guard/SDK cases and subcases |
| `npm run build` | PASS, including TypeScript |
| Changed-file ESLint | PASS, no errors or warnings |
| Real provider acceptance | BLOCKED, no key configured; zero requests |

`server/__tests__/agent-guard.mts` tests the exact prefix, simultaneous correct/incorrect
blocks, signs, payment direction, six-decimal conversion, participant counts, claimed
execution, short/full identifiers, poisoned model inputs, stale evidence, another intent,
ticket IDs, historical closure metadata, hypothetical limits and pool counts.

`server/__tests__/agent-narrate.mts` exercises the real POST handler and Anthropic SDK with
explicitly mocked HTTP responses: all three tools, payment corruption, uncalled tools,
refusal, output truncation and loop exhaustion. These establish protocol behavior, not
provider access or real model compliance. Existing named diagnosis assertions remain.

## Configure and run the real acceptance

Create an API key in Claude Console under **Settings → API keys → Create key**. Add it to the
local `.env` as `ANTHROPIC_API_KEY=...`; never put it in a `NEXT_PUBLIC_` variable or commit it.
Configure API billing in Console and restart the Next server. API authentication is described
in the [official guide](https://platform.claude.com/docs/en/manage-claude/authentication), and
API billing is described in the [billing guide](https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage).
`AGENT_MODEL` remains configurable; the current default is `claude-sonnet-5` and requires
access in that account.

```powershell
# Local check only: exits before any network request.
npm.cmd run agent:check:model -- --preflight

# Four read-only questions with real Graph, RPC and Anthropic HTTP calls.
npm.cmd run agent:check:model
```

The script uses the live replacement hash in `docs/checks/graph-budget/summary.json`. Set
`AGENT_ACCEPTANCE_INTENT` locally to another full, currently live hash if that intent has
since closed. It never commits or settles an intent. It invokes the POST route handler with
a real Request object; this is not a browser or hosted-server deployment check.

| Question | Required result |
| --- | --- |
| Diagnose the selected intent | Actual `diagnose_intent` model tool call and accepted answer |
| Hypothetical 30 USDC ceiling | Actual `what_if`, echoed ceiling, hypothetical qualification and evidence-matching payment |
| Pool counts | Actual `pool_overview` and accepted answer |
| Conflicting prefix/block/payment instructions | Safe supported answer or explicitly labelled deterministic fallback |

Every nominal case requires `guardFallback: false`, a provider request ID, message ID and
positive token usage. The script matches those IDs against the real HTTP responses, checks
all recorded Graph/RPC blocks and validates the returned answer. Failures produce `FAILED`;
missing credentials produce `BLOCKED`, never `PASS`. The JSON stores questions, answers,
tool evidence, provider provenance and read blocks, without authentication headers.

### Data sent for this acceptance

The destination is `https://api.anthropic.com/v1/messages`. The four questions above, selected
public intent hash, snapshot block, public section/session counts, and tool outputs are sent.
Outputs can contain counterparty wallet addresses, commitment/revocation transaction hashes,
ticket IDs, solver payment amounts, constraints tried, exclusion reasons and bounded-search
results. These are derived from public Arc Testnet/Subgraph state. The API key is sent only
as provider authentication. Wallet private keys and environment file contents are not in the
prompt or tool results.

The workspace's automatic approval review rejected the live command because sending the
intent/address evidence to Anthropic had not been explicitly approved. The subsequent local
`--preflight` was allowed and confirmed the missing key. Running the model acceptance from
this assistant session still requires that data-sharing approval and a configured key.

## Limits

This guard validates the supported passages, not unrestricted English. A relevant but
paraphrased answer falls back; a correctly worded but less helpful tool choice can still pass.
Adding a new kind of answer requires a renderer and rejection tests. The guard does not prove
the underlying indexer, solver or renderer correct; those retain their own checks and search
bounds. Snapshot evidence does not reserve tickets or payment capacity for later execution.
