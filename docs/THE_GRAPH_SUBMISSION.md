# The Graph submission draft

Prepared 2026-09-12 for step 11 of the [supplied plan](RESHUFFLE_GRAPH_PLAN.md).
These are reviewable form answers and a checklist; no submission has been sent.
The [13 September submission status](SUBMISSION_STATUS.md) tracks the actual URL,
hosting acceptance, final selections and outstanding team declarations.

## Partner and track selection

Select **Arc** and **The Graph** in the partner-prize form.

Graph target: **Best AI Tooling or AI Use Case with The Graph (From Scratch)**,
**AI Use Case** path, **Start Fresh** pool. The official prize page lists this track.
Start Fresh requires a project begun during the event; verify the team's full history,
including designs and assets, before declaring eligibility. An existing project belongs in
the applicable Continuity pool. [Official prize requirements](https://ethglobal.com/events/ethonline2026/prizes#the-graph).

Arc target on the current page: **Best DeFi/Onchain Finance Application**. The earlier plan's
“Launch on Testnet & Push to Mainnet” is not a separately listed category. The mainnet portion
of the award requires actual deployment by September 30; the readiness document alone does
not meet that condition. [Official Arc requirements](https://ethglobal.com/events/ethonline2026/prizes#arc).

## How we use The Graph — form answer

RESHUFFLE lets people swap event tickets without selling first. Each participant signs the
outcome they accept: session, section, exact ticket count, seat cohesion, adjacency and a net
USDC payment limit. The settlement contract checks every signed condition before execution.

Our deployed Subgraph Studio subgraph reconstructs the live market from Arc Testnet events.
IntentRegistry retains commitment state and owner, while the matching fields are emitted in
IntentCommitted. We index TicketMinted, Transfer and TicketRedeemedEvt for ticket metadata,
custody and redemption; IntentCommitted and IntentRevoked for signed conditions and closure;
and Settled for receipts and settled intent states. The frontend and backend solver consume
these indexed records. This implementation relies on The Graph to reconstruct the live intent
pool.

The read-only agent does meaningful work with that live data: a deterministic engine checks
available supply, demand for the offered tickets, and individual condition changes by rerunning
the bounded solver. Claude can select read-only tools and narrate their evidence. The drawer
shows the indexed block, diagnosis, counterparty commitment links and search bounds. Changing
a budget requires real revoke and commit transactions; later indexed data can change the
answer. The no-model diagnose endpoint exposes the evidence independently of narration.

Every indexed intent is re-hashed against its commitment. Post-transaction queries require
an indexed block at least as recent as the receipt. Before settlement the backend rereads
chain state and simulates; the contract validates again on execution. Hypotheticals return
`submittable: false` and contain no transaction calldata. The agent cannot sign or submit.
Pool data, USDC balances/allowances and closed-intent lookups use the same exact snapshot
block. Historical read failures return an error instead of substituting newer state.
The guard checks the exact block prefix and complete supported passages, including payment
direction and hypothetical qualifications. [Block evidence](GRAPH_7A_7D.md) and
[real-provider acceptance](GRAPH_7G_7H.md) document the measured behavior.

## Developer feedback — observed facts only

- Studio serves the deployed `reshuffle` v0.1.1 subgraph on `arc-testnet`. The ABI/manifest
  check passes with the actual event name `TicketRedeemedEvt`; the plan's generic event
  examples needed adaptation to our contracts.
- The read-only parity audit passed **1,719 checks at block 61754713** across 121 intents
  and 164 tickets. [Recorded output](checks/step-11-parity.txt).
- `number_gte` allows the client to treat an indexer behind the receipt as an explicit wait;
  the client recognizes the indexed block in graph-node's lag error. This is more useful
  than silently showing the pre-transaction pool.
- Arc's public RPC rejects batching and can rate-limit parity reads. Our checker uses
  bounded concurrency and backoff. This is an RPC observation, not a Studio defect.
- A real transfer was observed in the index after **7.294 seconds**; the separate Apply budget
  browser indexing phase lasted **3.018 seconds**. These are dated individual observations
  including polling/HTTP time. Earlier head-distance samples are not transaction latency.
  [Measurement scope](graph-acceptance.md), [budget receipts and browser transition](GRAPH_APPLY_BUDGET.md).
- Four real Anthropic scenarios passed with **eight provider calls** and no guard fallback.
  Each answer's reads and evidence share its block. This is local handler-level acceptance,
  not verification of a public hosted deployment. [Provider receipts](checks/graph-agent-model.json).

## Links and review path

| Item | Artifact |
|---|---|
| Query endpoint | [Studio v0.1.1](https://api.studio.thegraph.com/query/1760168/reshuffle/v0.1.1) |
| Schema and mappings | [Schema](../subgraph/schema.graphql), [mappings](../subgraph/src/) |
| Setup and executable query | [README](../README.md#the-graph) |
| Agent source | [Agent](../server/agent/), [API routes](../app/api/agent/) |
| Real indexed fixture | [Snapshot at 61727725](../fixtures/snapshot-61727725.json) |
| Contract audit | [C1–C6](graph-audit.txt) |
| Checks and gaps | [Step 11 review](STEP_11_REVIEW.md) |
| Live no-model diagnosis | [HTTP evidence at block 61756153](checks/step-11-diagnose.json) |
| Real model narration | [Four scenarios and provider receipts](checks/graph-agent-model.json) |
| Budget replacement and drawer | [Two real transactions and captures](GRAPH_APPLY_BUDGET.md) |
| Teammate configuration | [Tracked template](../.env.example), [setup](../README.md#run-locally) |
| Graph recording guide | [Run of show](DEMO_GRAPH.md) |
| Arc execution proof | [Confirmed settlement transactions](../README.md#confirmed-arc-testnet-settlements) |
| Architecture | [PNG](diagrams/architecture.png), [SVG](diagrams/architecture.svg) |
| AI disclosure and specs | [AI usage](../README.md#ai-usage), [file/asset provenance](PROVENANCE.md), [planning index](PLANNING_ARTIFACTS.md) |
| Public deployment and final declarations | [Step 11-C status](SUBMISSION_STATUS.md), [hosted verification command](JUDGING_SETUP.md#verify-before-handing-it-to-judges) |
| Public app / backend | [Frontend](https://online2026.vercel.app/), [backend health](https://online2026.vercel.app/api/health): currently 200 / 503 respectively; [actual check](checks/hosted-acceptance.json) |

## Submission checklist

- [x] README names the Graph track and explains the indexer, agent, trust boundaries,
  environment, commands and limitations.
- [x] Public endpoint and a current read-only parity result are recorded.
- [x] Known AI assistance is disclosed with file paths and planning artifacts indexed;
  the separate complete team/asset attestation remains open below.
- [x] Tracked environment template and non-overwriting setup command are available.
- [x] Local real Anthropic acceptance passed; all three tools and conflicting instructions
  are covered with provider provenance.
- [x] Apply budget revoke/commit receipts and the drawer moving to the new hash are recorded
  in the separate live browser proof.
- [ ] Complete authenticated Studio status and full available warning/error log review.
- [ ] Confirm Start Fresh eligibility and complete any earlier AI-tool/asset attribution
  that cannot be established from this workspace.
- [ ] Commit the reviewed implementation and documentation to the public repository;
  verify access from a signed-out browser and record its URL in the submission form.
- [x] Identify the hosted frontend/backend URL and verify anonymous repository access.
- [ ] Restore hosted backend readiness. The public check failed at `/api/health` (503);
  publishing a hostname alone does not establish a working backend.
- [ ] Check model narration on the hosted URL. Local provider acceptance does not establish
  the hosted credentials, ingress, rate limits or persistence.
- [ ] Upload the demo and presentation, then complete the actual partner selections.

The event asks for AI attribution and the specs/prompts used in a spec-driven workflow.
Its video guidance permits cutting waits, requires a 2–4 minute video of at least 720p,
and disallows speeding it up or using AI voiceover. Submission is due September 13, 2026,
12:00 EDT (16:00 UTC). [Official submission and video rules, checked September 12](https://ethglobal.com/events/ethonline2026/info/details).
