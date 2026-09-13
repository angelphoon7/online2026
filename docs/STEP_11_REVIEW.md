# Step 11 implementation review

Reviewed 2026-09-12 against the supplied [Graph plan](RESHUFFLE_GRAPH_PLAN.md), current source,
tracked deployment records and live read-only parity. This is a readiness review, not a
security audit or confirmation that every historical UI interaction has been replayed.

## Current status after the follow-ups

This table supersedes the original findings. The dated measurements below remain historical
evidence; they are not a new replay of transactions, a hosted deployment or a submission.

| Steps | Current result | Evidence |
| --- | --- | --- |
| 11-B setup | `.env.example` exists and is tracked; `npm run setup:env` creates `.env.local` without overwriting it. Public reads need no shared private files | [Template](../.env.example), [local setup](../README.md#run-locally) |
| 7-A / D | Pool, USDC balance/allowance and closed-intent lookup share the exact diagnosis block; missing history fails explicitly | [Block traces](checks/graph-diagnosis-block.json), [behavior](GRAPH_7A_7D.md) |
| 7-G / H | Four real-provider scenarios PASS, eight Anthropic calls, no guard fallback. Amounts and answer prefixes are checked against tool evidence | [Provider receipts](checks/graph-agent-model.json), [275 regression checks](checks/graph-agent-model-regressions.txt) |
| 6-D / 8 / 10-B | Real revoke and replacement commit verified; drawer followed the new hash and retained the receipt floor | [Two receipts, indexed states and captures](GRAPH_APPLY_BUDGET.md) |
| 6-B / 8 | Post-write floor and stale-response rejection implemented and asserted | [Freshness checks](GRAPH_6B_8.md) |
| 5-C / D / 6-A | UI, solver and Agent paginate at one block hash; limits/errors cannot return a partial pool | [Boundary and real-page checks](GRAPH_PAGINATION.md) |
| 7-D / E / F / H; 8 | Bounded supply claims, strict hypothetical inputs, per-intent commitment links and drawer identity checks implemented | [Integrity](GRAPH_AGENT_INTEGRITY.md), [drawer](GRAPH_8_EVIDENCE.md) |
| 7-I | Both routes have overall deadlines; production admission requires shared Redis and trusted client identity | [Current policy and test scope](GRAPH_7I.md) |
| 4-A / 6-C | Public health/parity, transaction indexing delay and Graph solver source evidence recorded; authenticated Studio review remains open | [Measured results](GRAPH_4A_6C.md), [remaining panel checks](GRAPH_STUDIO_REVIEW.md) |
| 11-A / C | Public app/repository identified and anonymous check recorded: frontend 200, health 503. Production configuration/tooling and attribution inventory prepared; backend acceptance and team declarations remain open | [Draft](THE_GRAPH_SUBMISSION.md), [13 September status](SUBMISSION_STATUS.md) |

Run `npm run docs:check` before sharing the repo. It checks the tracked template, safe setup,
documentation links and recorded completion evidence without reading private environment files
or contacting any provider.

This documentation/setup follow-up passed the isolated first-run and repeat-run setup
checks, changed-script ESLint and TypeScript. The [full server/Graph regression output](checks/step-11-followup-tests.txt)
records **277 passed, zero failed**, retaining the earlier guard, snapshot, input, commitment,
drawer and pagination cases. [Documentation/setup check output](checks/step-11-docs.txt).

The template was already tracked when this follow-up began. The fix makes that fact explicit,
adds a non-overwriting copy command and fills empty judge placeholders during `judge:setup`.
Existing nonempty settings, access codes and explicit false flags are preserved. The real
workspace's `.env`, `.env.local` and `.env.seed` were not modified by these checks.

## Completed documentation

- README: explicit Graph target, indexed events/entities, trust model, public endpoint,
  executable query, local setup, actual environment names, agent behavior and limitations.
- Replaced placeholder deployment addresses and the obsolete schema in README.
- Corrected backend signing/discovery descriptions and regenerated PNG/SVG architecture
  artifacts from the updated export script.
- Prepared [submission form answers](THE_GRAPH_SUBMISSION.md), AI disclosure and
  [planning artifact index](PLANNING_ARTIFACTS.md), including the supplied Graph plan and
  both original UI prompts. Original files are retained as historical inputs; their sample
  commands and superseded requirements are not new execution instructions.

## Original Step 11 checks (historical)

| Check | Result / scope |
|---|---|
| `npm test` | 32 passed, 0 failed: Graph parsing, captured fixture, deterministic diagnosis, hypotheticals and guard cases |
| `node solver/node_modules/vitest/vitest.mjs run --root solver` | 29 passed across search, validation and hash suites |
| `npm run deployment:check` | 11 checks passed; deployment record and public configuration agree |
| `npm run subgraph:check` | 36 checks passed; three data sources match actual ABIs, addresses and start blocks |
| `npm --prefix subgraph run build` | Successful AssemblyScript build for all three data sources |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Production build passed, including frontend and agent/market/solver route handlers |
| `.tools/foundry/forge.exe test -vvvv` | 32 Solidity tests passed, 0 failed; [full traces and named rejection results](checks/step-11-forge.txt) |
| `npm run subgraph:parity` | 1,719 checks passed at block 61754713; 121 intents and 164 tickets; [output](checks/step-11-parity.txt) |
| Architecture export | Both artifacts regenerated; PNG visually inspected for text fit |
| Built app HTTP smoke check | Landing page and `GET /api/agent/diagnose/{hash}?minBlock=61754713` returned HTTP 200; diagnosis was SETTLEABLE at 61756153, satisfying the requested floor. [Evidence](checks/step-11-diagnose.json). No model call or signing operation was used |

The solver initially lacked Windows optional dependencies. A local dependency repair allowed
its tests to run; the dependency changes made by that repair were then removed from the diff.
No package manifest or lockfile was changed. A fresh checkout should install dependencies
for its own operating system rather than rely on the repository's tracked solver node_modules.
The subgraph CLI's initial sandbox profile-read error was resolved by rerunning the build
outside that sandbox. The live parity check likewise needed network access.
The bundled Forge executable also passed outside the sandbox after an initial native-runtime
crash inside it. The retained trace is the successful run; existing gas tables remain dated
historical gas-report measurements.

## Plan coverage and actual differences

| Plan area | What exists / qualification |
|---|---|
| 0: contracts | C1–C6 recorded in `graph-audit.txt`; all passed. Arc deployment journal is JSON rather than the plan's Foundry broadcast path |
| 1: deployment configuration | `deployments/arc-testnet.json`, CLI normalization and generated public records. Runtime reads `NEXT_PUBLIC_DEPLOYMENT`; CLI reads `DEPLOYMENT` |
| 2–4: Studio, mappings, acceptance | Live `reshuffle` v0.1.1 endpoint, three actual entities/data sources, fresh parity. The slug is not the plan's example `reshuffle-arc-testnet` |
| 5–6: Graph reads and solver | Shared hash/snapshot client, freshness floor, Graph market/solver adapters, RPC execution checks. Actual APIs start with `/api`; read selector is server-side `READ_SOURCE` |
| 6: judge writes | Budget/revoke routes sign real transactions only for locally controlled demo participants. No write was triggered by this review |
| 7–8: agent and drawer | Exact-block diagnosis, strict tool inputs, evidence-bound guard and drawer; real-provider acceptance now passed, with bounded-search limitations retained |
| 9: testing | Named wait/freshness assertions and later regression suites pass; see the dated follow-up records above |
| 10: live recording | Rehearsal remains read-only; separate real Apply budget receipts and browser captures now establish the N-to-M transition |
| 11: submission package | Documentation, attribution inventory and public URLs recorded. Backend readiness, final revision, team declarations, video and actual form submission remain open |

## Remaining external checks

1. **4-A:** authenticated Studio sync status and full available warning/error history still
   need review. Public `_meta.hasIndexingErrors=false` does not prove the private log history.
2. **Hosted acceptance:** local real-provider calls and local production-server persistence
   do not establish a public deployment with the developer's laptop off. Verify the hosted
   URL, Redis persistence, actual ingress identity and model calls there.
   The URL is now recorded; its first anonymous run failed backend readiness (HTTP 503).
   [Live result and production follow-up](SUBMISSION_STATUS.md).
   [Hosting checklist and recorded scope](JUDGING_SETUP.md).
   The Step 7-I rate-limit follow-up adds 15 passing regression tests for trusted IPs,
   shared admission wiring, Redis failures/deadlines and health readiness (277 total
   server/Graph checks pass). The real Redis run failed its connectivity preflight, and
   public two-IP checks still require deployment. These remain unaccepted under 7-I / 11-C.
   [Assertion scripts and recorded deployment status](GRAPH_7I.md#deployment-acceptance).
3. **11-C:** the team must confirm Start Fresh eligibility, full AI/asset attribution,
   public repository access, final video/presentation and actual form/prize selections.
   [Current official categories and deployment handoff](SUBMISSION_STATUS.md) and
   [known assistance / asset source inventory](PROVENANCE.md) are prepared. These documents
   explicitly leave unverified team facts open.
   The draft has not been submitted by this documentation update.
4. **12:** Arc Mainnet deployment and release gates remain separate and incomplete.
   [Readiness package](MAINNET_READINESS.md).

Updating this review reuses the linked proof. It does not resend budget transactions,
replace signed intents, renew inventory or change the deployment/domain configuration.
