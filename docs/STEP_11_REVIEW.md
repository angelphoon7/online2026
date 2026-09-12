# Step 11 implementation review

Reviewed 2026-09-12 against the supplied [Graph plan](RESHUFFLE_GRAPH_PLAN.md), current source,
tracked deployment records and live read-only parity. This is a readiness review, not a
security audit or confirmation that every historical UI interaction has been replayed.

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

## Checks run

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
| 7–8: agent and drawer | Deterministic diagnosis, single-condition solver reruns, optional Claude tools, guard/template and drawer. Limitations below qualify the plan's snapshot and narration claims |
| 9: testing | Regression suites and live parity passed. The wait script logs cases but lacks assertions; its process passing is not proof of every printed expectation |
| 10: live recording | Read-only rehearsal script and run of show exist. Rehearsal tries hypothetical budgets; it cannot prove real revoke/commit, receipt-to-index timing or browser transitions |
| 11: submission package | Local documentation and draft prepared. Hosted URL, public publication, final video and actual form submission remain external deliverables |

## Open findings

1. **Diagnosis is not completely pinned.** `server/solve-hypothetical.ts:readCapacity` reads
   balances/allowances at latest, and `server/agent/diagnose.ts` uses an unpinned closed-intent
   lookup. The Graph pool has a named block, but these additional facts may describe another
   moment. Pin those reads or report their individual blocks before making the stronger claim.
2. **Narration guard is partial.** `checkAnswer` requires the expected block somewhere in
   the text, so it can also accept additional inconsistent block references. It checks full
   identifiers and banned words, not all amounts, ticket IDs or causal claims. Passing guard
   tests does not establish full evidence entailment.
3. **Large-pool completeness is bounded.** The snapshot query caps each list at 1,000 and
   does not paginate or detect every possible truncation. The service's 256-intent search
   cap is a separate bound. Do not describe discovery as unbounded.
4. **No live-model run is established by this review.** The configured default model exists
   in [Anthropic's model documentation](https://platform.claude.com/docs/en/models/sonnet-5/whats-new-sonnet-5),
   but account access, hosted key configuration and narration still need an end-to-end check.
   The ask route has a process-local rate limit; diagnose has no equivalent rate limit and
   the full agent request has no explicit overall deadline. Review before public hosting.
5. **Step 10 evidence needs real writes and UI capture.** The rehearsal is explicitly read-only.
   Its -4/-3 USDC example is pool-specific, not a fixed benchmark. No fresh revoke/commit
   receipts, browser recording or receipt-to-index duration were produced in this review.
   Earlier lag measurements are head-distance samples, not transaction latency.
6. **Submission provenance remains a team declaration.** Current files and recent commits
   cannot establish all prior AI usage, third-party asset provenance or Start Fresh eligibility.
   The disclosure names confirmed assistance and retains the supplied specs; complete any
   additional provenance before submitting.

Existing uncommitted solver/agent work and the rehearsal guide were preserved. No contract
redeployment, new inventory, signed budget change, settlement or sponsor submission was
performed as part of step 11.
