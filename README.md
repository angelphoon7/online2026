# RESHUFFLE

Swap tickets without selling first.

*Every condition you sign is checked on-chain.*

The current demo is a single page at `/`: open the live event poster to use the workspace, then inspect receipts in place. [UI flow, contract mappings and validation](docs/UI_IMPLEMENTATION.md).

**Target Arc bounties: Best DeFi / Onchain Finance · Launch on Testnet & Push to Mainnet — [category confirmation pending](#bounty-category-verification).**

**Target The Graph bounty: Best AI Tooling or AI Use Case with The Graph (From Scratch) · AI Use Case path · Start Fresh pool.** See [submission draft and eligibility checks](docs/THE_GRAPH_SUBMISSION.md).

**A market for outcomes, not listings.**

You never give up your tickets unless the whole replacement arrives.

[Circle integration: products used, contract addresses, deployment transactions and design decisions](docs/CIRCLE_INTEGRATION.md).

[Mainnet readiness: deployment tooling, network configuration, verification checklist and actual admin permissions](docs/MAINNET_READINESS.md). Local deployment rehearsal passed; official mainnet parameters and production release gates remain pending.

<!-- Live demo: TBD · Video: TBD -->

---

## Contents

- [Ready-to-settle demo](#ready-to-settle-demo)
- [The Graph: setup, live endpoint and agent](#the-graph)
- [AI usage and planning artifacts](#ai-usage)
- [The problem](#the-problem)
- [The solution](#the-solution)
- [High-level architecture](#high-level-architecture)
- [Sponsor technology map](#sponsor-technology-map)
- [Component flows](#component-flows)
- [Technical reference](#technical-reference)
- [Sequence diagrams](#sequence-diagrams)
- [Sponsor tracks](#sponsor-tracks)
- [App Kits evaluation](#app-kits-evaluation)
- [Questions we expect](#questions-we-expect)
- [Limitations](#limitations)
- [Repository](#repository)

---

## Ready-to-settle demo

**Sign-and-leave proof is confirmed: the participant browser and signing process exited before a separate solver settled six tickets at block 61378348.** [Real transaction](https://testnet.arcscan.app/tx/0xffd5f35dcac46cd52c6593d6c2a34a74b07ed4859c848b39ba09421e109d07c9) · [Evidence](deployments/offline-demo.json) · [Reproduction and proof boundaries](docs/DEMO_OFFLINE.md). Open `/demo/offline`. All three participant transaction nonces stayed unchanged; `settle(intents, legs)` required no new participant signatures. Browser closure is a local controlled-wallet observation, separately labeled from the chain evidence.

**Act three is confirmed: an independent proposer submitted a non-adjacent allocation and the transaction reverted at block 61374887.** [Real failed transaction](https://testnet.arcscan.app/tx/0x087f78f9bdc54b5f9bb8f6939f2a4633ee1f554e8fc198cc75739b1b722279fe) · [Rejection and unchanged-state proof](deployments/act-three.json) · [Scene instructions](docs/DEMO_ACT_THREE.md). Open `/demo/act-three` to see decoded `SeatsNotAdjacent` and test valid/malicious allocations with live `eth_call`. The receipt confirms failure; replaying its exact calldata at the preceding block provides the named error bytes. The same signed intents pass with adjacent allocations.

**Act two is confirmed: a pure buyer, two swappers and a pure seller settled an open chain in one transaction at block 61369696.** [Real transaction](https://testnet.arcscan.app/tx/0x6df107019a5bb2d47654a12cf594923adf5f3cfb6259ba3a49d870f79e9ce29e) · [Open-chain evidence, including both missing-endpoint searches](deployments/act-two.json) · [Scene instructions](docs/DEMO_ACT_TWO.md). Open `/demo/act-two` to compare the failed subset searches with the four-party settlement. It uses the same deployed contracts and solver as act one.

**Act one is confirmed: three participants exchanged six tickets in one Arc Testnet settlement, at block 61301567.** [Real transaction](https://testnet.arcscan.app/tx/0xdc54e3971c04dc533b1ad3604cd29368cb67556d265fb093b60e146e5e6f3143) · [Six-transfer evidence](deployments/act-one.json) · [Scene and verification instructions](docs/DEMO_ACT_ONE.md). Open `/demo/act-one` in the running app to verify and display the completed exchange. The separate twelve-ticket `/demo` remains the interactive pending round.

With the existing Arc deployment and local operator credentials configured:

```bash
npm run demo:prepare
npm run dev
```

Open **[localhost:3000/demo](http://localhost:3000/demo)**. The first command prepares three signed, LIVE intents and twelve escrowed tickets, then verifies a three-participant candidate with the real solver and `eth_call`. It reuses an already-ready round without sending transactions. After settlement, run it again to prepare the next round using the same tickets and fresh nonces.

The demo opens without a wallet and automatically searches all live event intents through `/api/solve/pool`, retrying after public-state refreshes while the page is open. Each candidate contains two to four participants; the full pool is searched within a 100-candidate / two-second budget. Results show when that budget is reached. Pool sizes above the 256-intent service guard return an explicit error rather than being silently truncated. Checkboxes optionally switch to manual selection for testing. Submission requires a proposer wallet with Arc test USDC for gas; participants need not return or sign again. The seed command does **not** execute the settlement.

For broader wishlist inventory, `npm run demo:inventory -- --broadcast` prepares 64 additional tickets across both sessions and all four sections, deposits them and commits 32 adjacent-pair swap offers. Reruns resume the same batch. Additional batches use a name, e.g. `npm run demo:inventory -- --broadcast batch-2`. A new name adds 64 tickets; an existing name resumes its saved batch. [Inventory setup and verification](docs/DEMO_INVENTORY.md) | [Public ticket IDs and transaction hashes](deployments/section-inventory.json).

For asynchronous judging, host the Next.js frontend **and backend** and share its `/demo` URL. Seed before publishing the public manifest. A shared on-chain round can be consumed once; reseed and redeploy the updated manifest for the next round on hosts with immutable files. See [setup, recovery and hosting details](docs/DEMO_SETUP.md).

## The Graph

### Why an indexer is structurally required

`IntentRegistry` stores commitment state and owner, plus nonce reservations; it does not store
the full matching conditions in an enumerable pool. Those fields are emitted in
`IntentCommitted`. This implementation relies on The Graph to reconstruct the live intent
pool. The indexed data powers public ticket positions, standing intents, settlement history,
backend discovery and the agent's diagnosis. RPC log reconstruction remains a development
option; run the Graph demonstration with `READ_SOURCE=graph`.

### What is indexed

| Contract | Event | Entity effect |
|---|---|---|
| TicketNFT | `TicketMinted` | Ticket metadata and initial owner |
| TicketNFT | `Transfer` | Current owner, escrow custody and depositor |
| TicketNFT | `TicketRedeemedEvt` | Ticket redemption status |
| IntentRegistry | `IntentCommitted` | All 12 signed fields, ordered offered IDs, LIVE state and commitment transaction |
| IntentRegistry | `IntentRevoked` | REVOKED state and closing transaction |
| Settlement | `Settled` | Settlement receipt; listed intents become SETTLED |

The deployed schema has **Ticket, Intent and Settlement**. Escrow custody is derived from
NFT transfers; there is no separate Escrow data source. `Settled` contains hashes and a
participant count, so per-leg receipts and USDC net payments are decoded from transaction
input and verified through RPC. They are not indexed in a `SettlementLeg` entity.
[Schema](subgraph/schema.graphql) · [actual ABI audit](docs/graph-audit.txt).

### Graph trust model

1. **Hash binding:** the shared `hashIntent()` recomputes each indexed commitment and rejects
   altered fields as `HASH_MISMATCH`. The registry key is the bare struct hash; the EIP-712
   domain (`chainId` and `verifyingContract`) authenticates the signature at commit.
2. **Freshness floor:** reads following a transaction use `block: { number_gte: receiptBlock }`.
   The UI waits for indexing rather than substituting an older pool. Indexing errors are surfaced.
3. **Execution checks:** indexed discovery is followed by chain reads and `eth_call` simulation.
   Settlement checks V0–V8 again in the real transaction. Simulation does not reserve state;
   a later withdrawal can still make a proposal revert and cost its proposer gas.

Read-only audit on September 12, 2026:

```text
comparing at block 61754713 (pinned to the indexed block)
hash binding verified on 121 intents
PASS — 1719 checks at block 61754713: 121 intents, 164 tickets
```

[Full output](docs/checks/step-11-parity.txt) · [what the checks cover](docs/graph-acceptance.md).
This is evidence for that block, not a claim that the pool never changes.

### Endpoint and query

[Studio query endpoint: reshuffle v0.1.1](https://api.studio.thegraph.com/query/1760168/reshuffle/v0.1.1),
network `arc-testnet`, chain ID `5042002`. Deployment:
`QmcCXyzCr7YWjx1joA5mqNmnz4Byk5C34QMFS94FPnsVRL`.

The browser uses the same-origin `/api/graph` proxy; any query key stays server-side. This
small inspection query works in Studio with variables `{ "minBlock": 0 }`. After a write,
replace `0` with its receipt block. It displays a sample, not the complete solver input.

```graphql
query InspectPool($minBlock: Int!) {
  _meta(block: { number_gte: $minBlock }) {
    block { number timestamp }
    hasIndexingErrors
  }
  intents(first: 20, where: { state: LIVE }, block: { number_gte: $minBlock }) {
    id owner eventId offered exactCount maxNetPay committedTx
  }
  tickets(first: 20, where: { escrowed: true }, block: { number_gte: $minBlock }) {
    id sessionId sectionId row seat depositor
  }
}
```

The application's complete [PoolSnapshot query](shared/graph/queries.ts) takes
`{ "minBlock": 0, "first": 1000 }` and includes every signed field needed for hash binding.

### Run locally

Install Node.js 22 or newer, then install dependencies from the repository root:

```sh
npm ci
npm --prefix solver ci
```

Create `.env.local` only if it does not already exist. Copy the needed settings from
[.env.example](.env.example); keep existing wallet credentials private. `.env.example` is a
template, not the application's active settings. Next loads `.env.local` ahead of `.env`;
CLI scripts may load `.env` explicitly, so keep shared selections consistent.

For public Graph reads and no-model diagnosis, these settings suffice; no wallet key is needed:

```dotenv
DEPLOYMENT=arc-testnet
NEXT_PUBLIC_DEPLOYMENT=arc-testnet
ARC_RPC=https://rpc.testnet.arc.io
READ_SOURCE=graph
SUBGRAPH_URL=https://api.studio.thegraph.com/query/1760168/reshuffle/v0.1.1
```

```sh
npm run dev
```

Open `http://localhost:3000/`, open an event poster, then **Check all intents** and choose
**Why no match?** on an intent. The workspace is readable without connecting a wallet.
Signing or settlement connects when needed. The automatic search finds candidates while the
page is open; **Propose and settle** is a separate wallet transaction. The agent does not
automatically execute a swap.

The evidence can also be inspected without an Anthropic key or wallet:

```text
GET http://localhost:3000/api/agent/diagnose/<committed-intent-hash>
GET http://localhost:3000/api/agent/diagnose/<committed-intent-hash>?minBlock=<receipt-block>
```

Use a full hash from the live pool. The endpoint returns named status, evidence, bounds,
runtime and a deterministic sentence. `/api/agent/ask` also falls back to deterministic
diagnosis when no model key is set. Free-form tool selection and narration require the key.
The built app returned HTTP 200 with `SETTLEABLE` at block 61756153 in the current
[live diagnosis check](docs/checks/step-11-diagnose.json), without invoking a model or signing.
For a production server use `npm run build` and `npm start`; mount persistent storage for
`.data/evidence`. [Backend routes and permissions](server/README.md).

### Environment variables

| Variable | Consumer | Actual behavior |
|---|---|---|
| `DEPLOYMENT` | Deployment/subgraph CLI scripts | Selects `deployments/<network>.json`; default `arc-testnet` |
| `NEXT_PUBLIC_DEPLOYMENT` | Next frontend and backend chain configuration | Selects generated public deployment record at build time; keep equal to `DEPLOYMENT` |
| `SUBGRAPH_URL` | Backend and shared Graph client | Required for Graph reads; set to the versioned query endpoint above |
| `SUBGRAPH_API_KEY` | Backend | Optional query credential; never a `NEXT_PUBLIC_` value |
| `SUBGRAPH_DEPLOY_KEY` | Deployment CLI | Publishing only; not needed to run the app or query the existing subgraph |
| `READ_SOURCE` | Backend market and solver discovery | `graph` or `rpc`; defaults to `graph` when `SUBGRAPH_URL` is set, otherwise `rpc`. Local Anvil uses `rpc` |
| `ARC_RPC` | Backend and CLI | RPC used for chain verification, capacity and simulation; defaults to selected deployment RPC in the backend |
| `ARC_CHAIN_ID` | Backend consistency check / CLI | If set, must agree with the deployment; Arc Testnet is `5042002` |
| `NEXT_PUBLIC_RPC_URL` | Browser chain configuration | Public RPC override; browser public reads use the same-origin transport |
| `ANTHROPIC_API_KEY` | Agent narration only | Optional; diagnose needs no model key, ask uses a template if absent |
| `AGENT_MODEL` | Agent narration | Defaults to `claude-sonnet-5`; verify access for the hosted account |
| `BUDGET_CAP_USDC` | Deterministic diagnosis | BUDGET relaxation ceiling, default `100`; USDC has 6 settlement decimals |
| `JUDGE_CONTROLS_ENABLED` | Testnet judge routes | `true` enables hosted budget/revoke controls; enabled by default in development. Requires controlled participant keys |
| `DEMO_TICKETS_ENABLED` | Testnet issuer route | Enables hosted free-ticket claims; enabled by default in development |
| `DEMO_ISSUER_PRIVATE_KEY`, `PRIVATE_KEY`, `SEED_*_PRIVATE_KEY` | Optional issuer/judge/local transaction tooling | Signing credentials, never public. Seed keys are read from `.env.seed`; none is required for ordinary public reads or diagnosis |

The plan's `GRAPH_API_KEY`, `ARC_RPC_URL` and `NEXT_PUBLIC_READ_SOURCE` are examples; this
implementation uses **`SUBGRAPH_API_KEY`, `ARC_RPC` and `READ_SOURCE`**. Addresses and deployment
blocks come from the deployment records, not hand-edited environment variables. Regenerate
public records with `npm run deployment:public` and rebuild when changing networks. Existing
testnet signatures do not authorize intents on a different chain or registry.

### Agent

One indexed pool snapshot → deterministic supply/demand checks and solver reruns → optional
Claude tool selection and narration. Tools are `diagnose_intent`, `what_if` and `pool_overview`.
The agent module has no signing capability. Enabled testnet judge controls are a separate
server feature that can sign for controlled participants.

Diagnosis spends its search bound on candidates containing the selected intent. It tries
single-condition changes to payment limit, adjacency, cohesion and accepted sections/sessions;
it does not change event or exact ticket count. Hypotheticals are marked `submittable: false`
and omit calldata. Acting on a change requires a newly signed commitment. The drawer's
Evidence panel exposes the conditions tried and commitment transaction links.

Each solver run is bounded by **4 participants, 100 candidates and a 2,000 ms timeout**.
The real settlement service accepts at most four offered/received tickets per intent and
256 searchable live intents. Ranking minimizes gross cash moved among candidates found,
then participant count, then the ordered intent-hash set. These are configured limits,
not measured performance claims. [Recording guide](docs/DEMO_GRAPH.md).

### Graph limitations

- No result means none found within the search bound. Single-condition trials do not
  establish whether a combination of changes would work.
- The pool and its timestamp come from one indexed response, but USDC balances/allowances
  are separate latest-RPC reads. Closed-intent lookup is also a separate unpinned query.
  The current diagnosis is therefore not a historical proof of every fact at one block.
- Snapshot lists are capped at 1,000 with no pagination yet. Large markets need pagination
  before the entire pool can be claimed as searched.
- The narration guard rejects banned wording, unsupported full identifiers and a missing
  expected block reference. It does not validate every amount/ticket reference or reject
  all extra block references. Evidence JSON is the inspectable result, not proof of every
  sentence the model might generate.
- Without a model key, ask returns a baseline diagnosis rather than interpreting arbitrary
  what-if questions. Live narration and the hosted demo need separate verification.
- Adjacency is enforceable for issuer-native tickets with consecutive seat numbering;
  external ticket systems are outside this demo.

### Verification

```sh
npm test
npm --prefix solver test
npm run deployment:check
npm run subgraph:check
npm run subgraph:parity
npx tsc --noEmit
```

The current run passed 32 Solidity tests, 32 Graph/agent checks, 29 solver tests, 11 deployment checks,
36 manifest checks and 1,719 live parity checks. [Review scope and remaining gaps](docs/STEP_11_REVIEW.md).
To rebuild the subgraph, install its dependencies with `npm --prefix subgraph ci`, then run
`npm run subgraph:codegen` and `npm --prefix subgraph run build`. Querying the existing deployment
does not require redeploying it.

## AI usage

AI coding assistance was used during development under user-provided product and UI
instructions. The confirmed assisted work in this conversation includes
`component/market/Market.tsx`, `lib/section-supply.ts`,
`scripts/test-section-supply.mjs`, `scripts/seed-inventory.mjs`, `server/market.ts` and
`docs/DEMO_INVENTORY.md` (ticket flow, availability and inventory tooling).
For this step, Codex assisted with `README.md`, `server/README.md`,
`docs/THE_GRAPH_SUBMISSION.md`, `docs/PLANNING_ARTIFACTS.md`, `docs/STEP_11_REVIEW.md`,
the architecture export labels and verification records. Copied planning files preserve
their supplied content; copying does not establish who originally authored them.

The user supplied the requirements, corrections and Graph integration plan. This disclosure
does not assign authorship to every earlier file: the team should complete any additional
tool/file/asset attribution before submission. The application itself optionally uses Claude
to narrate deterministic evidence; that runtime use is distinct from coding assistance.
[Specifications, instructions and planning artifacts](docs/PLANNING_ARTIFACTS.md).

---

## The problem

### The user's version

> I bought Sunday tickets as a backup because I didn't know if I'd get the date I wanted. Then I got Tuesday. Now I'm stuck with three Sunday tickets, resale isn't open, and social media is full of scammers.

That is a real 2026 post, and it is not rare. People buy backup tickets, get better ones, and are left holding the first set. Others need four seats together and end up buying extra tickets and reselling them just so a family can sit in one row.

The intent already exists — it is written in forum comments:

> *"HAVE: 4 Toronto, Sec 105. WANT: 4 Vancouver, together. Will pay difference."*

Users are already expressing conditional replacement in natural language. Mainstream resale workflows do not natively execute it — the condition stays a forum comment rather than something a system can act on.

### Why current systems can't help

```mermaid
flowchart LR
    A["You hold<br/>Friday x2"] --> B["SELL<br/>on resale"]
    B --> C{"Risk window<br/>is yours"}
    C --> D["BUY<br/>Saturday x2"]
    C -.->|"replacement gone"| E["Left with<br/>nothing"]
    D -.->|"bought first"| F["Carrying<br/>two sets"]

    classDef bad fill:#FCEBEB,stroke:#A32D2D,stroke-width:1px,color:#501313
    classDef decide fill:#FAEEDA,stroke:#BA7517,stroke-width:1px,color:#412402
    class E,F bad
    class C decide
```

Official exchange usually requires the same event, venue and date, with the replacement priced at or above the original. Changing dates often falls outside standard exchange eligibility, pushing the user back toward resale or manual support — a sale followed by a purchase.

### And sometimes no bilateral trade exists

```mermaid
flowchart LR
    A["A<br/>holds Friday<br/>wants Saturday"]
    B["B<br/>holds Saturday<br/>wants Sunday"]
    C["C<br/>holds Sunday<br/>wants Friday"]

    A -. "✗ B doesn't want Friday" .-> B
    B -. "✗ C doesn't want Saturday" .-> C
    C -. "✗ A doesn't want Sunday" .-> A
```

No two people can trade. All three together can. Every pairwise negotiation fails, and the trade that works involves everyone at once.

### The four pains, separated

| # | Pain | Type |
|---|---|---|
| 1 | Replacement exposure — I want to *change*, not to speculate | user pain |
| 2 | No direct counterparty — nobody wants exactly what I hold | matching problem |
| 3 | Bundle constraints — not any two tickets, but a complete outcome | user pain |
| 4 | Post-match coordination — a found solution stalls until every participant returns and approves *that exact proposal* | coordination problem |

Most systems address some of 1–3. Number 4 is what makes the others usable in reality.

---

## The solution

Users sign the **outcome** they will accept, not an order.

```mermaid
flowchart TD
    subgraph INTENT["Signed once, then you leave"]
        direction TB
        G["GIVE UP<br/>Friday A12, A13"]
        R["ONLY IF I RECEIVE<br/>exactly 2 Saturday tickets<br/>same section, adjacent seats"]
        P["AND PAY AT MOST<br/>30 USDC net"]
        D["VALID UNTIL<br/>Friday 18:00"]
        G --> R --> P --> D
    end
```

A solver later composes many such intents — including buyers, sellers and unsold issuer inventory — into a reallocation where everyone's signed conditions hold at once. The contract verifies each condition independently and settles atomically.

**Ordinary marketplace:** *How much do you want for your ticket?*
**RESHUFFLE:** *What would have to be true for you to give it up?*

### The property that drives the architecture

```mermaid
flowchart TD
    A["Asynchronous execution"] --> B["User is not present<br/>at settlement"]
    B --> C["No final approval step"]
    C --> D["The solver is untrusted"]
    D --> E["The outcome predicate must be<br/>independently enforceable on-chain"]

    classDef ok fill:#E1F5EE,stroke:#0F6E56,stroke-width:1px,color:#04342C
    class E ok
```

This is why the contract checks session, section, count, cohesion, adjacency, budget, expiry and redemption status. Not to be thorough — because nobody is there to click *confirm*.

---

## High-level architecture

![RESHUFFLE architecture: Next.js frontend, Node.js solver and evidence backend, and four Arc Testnet contracts with USDC settlement and native gas.](docs/diagrams/architecture.svg)

**Presentation downloads:** [4K PNG](docs/diagrams/architecture.png) · [Scalable SVG](docs/diagrams/architecture.svg) · [Export instructions](docs/diagrams/README.md).

The backend discovers the live pool through The Graph, rechecks chain state, searches, simulates and verifies receipts; the submitting wallet broadcasts the settlement transaction. The read-only agent explains indexed conditions using solver evidence. RPC discovery remains available for local development. The confirmed USDC distribution groups payments by wallet and excludes gas from its zero-sum total. Testnet issuer and judge controls have separate server signing permissions; see the [backend boundaries](server/README.md).

### Trust model

| Layer | Responsibility | Trusted? |
|---|---|---|
| Frontend | Collect conditions, obtain one signature | No |
| Backend | Read state, simulate, persist evidence and verify receipts | No — onchain execution revalidates the proposal |
| Solver | Find a satisfying combination | **No** — the contract re-checks everything |
| Arc RPC / planned subgraph | Discovery and state reads | **No** — chain state at execution is authoritative |
| Settlement | Verify every signed condition | Yes — this is the trust anchor |

### The issuer is a participant, not an operator

Unsold inventory joins the same graph. This is what stops a reshuffle from requiring a closed cycle.

```mermaid
flowchart LR
    V["Venue<br/>unsold Saturday"] -->|"Saturday"| A["A"]
    A -->|"Friday, directly"| C["C"]
    C -->|"Sunday"| B["B"]
    B -->|"per venue's predicate"| V

    classDef ok fill:#E1F5EE,stroke:#0F6E56,stroke-width:1px,color:#04342C
    class V ok
```

One issuer ticket does not complete a single upgrade — it makes a chain possible. The venue **injects an asset** into the graph, which frees A's Friday to go **directly to C** in the same settlement.

Each ticket is received exactly once. A's Friday does not route through the venue and onward — V4 would reject that as a double receive.

---

## Sponsor technology map

```mermaid
flowchart TB
    subgraph ARC["ARC"]
        direction TB
        A1["Best DeFi / Onchain Finance<br/>conditional delivery plus<br/>multi-party net settlement"]
        A2["Launch on Testnet and Mainnet<br/>escrow and stablecoin settlement<br/>added to a marketplace"]
        A3["USDC as native gas<br/>no separate gas token<br/>for users"]
    end

    subgraph GRAPH["THE GRAPH"]
        direction TB
        G1["AI Use Case, From Scratch<br/>live indexed data drives<br/>solver and agent decisions"]
        G2["Intent pool discovery<br/>mappings cannot be<br/>enumerated on-chain"]
        G3["Persistent intents<br/>new inventory makes an old<br/>intent satisfiable"]
    end
```

---

## Component flows

### 1. Intent creation

```mermaid
flowchart TD
    A["User describes what they want<br/>in natural language"] --> B["Agent parses into<br/>structured conditions"]
    B --> C{"User reviews<br/>the conditions"}
    C -->|"edit"| B
    C -->|"confirm"| D["Deposit tickets into escrow"]
    D --> E["Sign EIP-712 intent<br/>no signature is needed when a<br/>matching settlement is later found"]
    E --> F["Commit on-chain<br/>emit IntentCommitted"]
    F --> G["User closes the tab"]

    D -.->|"withdrawable at any time"| D

    classDef ok fill:#E1F5EE,stroke:#0F6E56,stroke-width:1px,color:#04342C
    classDef decide fill:#FAEEDA,stroke:#BA7517,stroke-width:1px,color:#412402
    class E ok
    class C decide
```

### 2. Discovery and solving

```mermaid
flowchart TD
    A["Fetch live intents<br/>from subgraph"] --> B["Verify freshness<br/>against chain state"]
    B --> C["Search for valid reshuffles<br/>bounded by participants,<br/>candidates and timeout"]
    C --> D{"Any found?"}
    D -->|"no"| E["Report honestly:<br/>no solution found<br/>within the search bound"]
    D -->|"yes"| F["Rank by published rule:<br/>min gross cash moved,<br/>ties to fewer participants"]
    F --> G["eth_call simulate"]
    G --> H{"Simulation<br/>passes?"}
    H -->|"no"| C
    H -->|"yes"| I["Submit propose plus execute<br/>in one transaction"]

    classDef ok fill:#E1F5EE,stroke:#0F6E56,stroke-width:1px,color:#04342C
    class I ok
```

Simulation is immediately followed by submission, but `eth_call` and the real transaction are separate calls and do not lock state. A participant can withdraw or revoke in between. Settlement revalidates everything at execution, so any intervening change causes a clean revert with nothing half-moved; the proposer loses gas, which is why simulation runs first.

### 3. Settlement validation

The core of the project. Every guarantee is enforced here or not at all.

```mermaid
flowchart TD
    S["settle intents, legs"] --> V0{"V0 shape: one leg per intent,<br/>no duplicate hashes,<br/>each intent hashes to its key?"}
    V0 -->|"no"| E0["MalformedSettlement"]
    V0 -->|"yes"| V1{"V1 state == LIVE,<br/>unexpired?<br/>no signature here"}
    V1 -->|"no"| E1["IntentNotLive<br/>IntentExpired"]
    V1 -->|"yes"| V2{"V2 every offered ticket<br/>escrowed by its owner<br/>AND eventId matches?"}
    V2 -->|"no"| E2["TicketNotEscrowed<br/>WrongEvent"]
    V2 -->|"yes"| V3{"V3 no ticket<br/>already redeemed?"}
    V3 -->|"no"| E3["TicketRedeemed"]
    V3 -->|"yes"| V4{"V4 exact bijection<br/>offered to received?"}
    V4 -->|"no"| E4["ConservationViolated"]
    V4 -->|"yes"| V5{"V5 each bundle satisfies<br/>its own predicate?"}
    V5 -->|"no"| E5["SessionNotAccepted<br/>SectionNotAccepted<br/>CountMismatch<br/>NotSameSection<br/>SeatsNotAdjacent"]
    V5 -->|"yes"| V6{"V6 each net payment<br/>within signed budget?"}
    V6 -->|"no"| E6["BudgetExceeded"]
    V6 -->|"yes"| V7{"V7 sum of<br/>netPayment is zero?"}
    V7 -->|"no"| E7["PaymentImbalance"]
    V7 -->|"yes"| V8{"V8 every NET DEBTOR:<br/>ownerNet covered by<br/>balance and allowance?"}
    V8 -->|"no"| E8["InsufficientPaymentCapacity"]
    V8 -->|"yes"| X["1 mark intents SETTLED<br/>2 settle USDC net<br/>3 release tickets<br/>4 emit — effects before interactions"]

    classDef ok fill:#E1F5EE,stroke:#0F6E56,stroke-width:1px,color:#04342C
    classDef bad fill:#FCEBEB,stroke:#A32D2D,stroke-width:1px,color:#501313
    class X ok
    class E0,E1,E2,E3,E4,E5,E6,E7,E8 bad
```

Checks first, effects second, interactions last. Nothing transfers until every check passes, and intents are marked `SETTLED` **before** any transfer — `safeTransferFrom` calls into the recipient, so moving a ticket while its intent is still `LIVE` would open a reentrant window against stale state. A revert in any transfer rolls the marking back with it.

### 4. Redemption

```mermaid
flowchart TD
    A["Holder opens ticket"] --> B{"Caller is<br/>current owner?"}
    B -->|"no"| C["Rejected<br/>previous holder fails here"]
    B -->|"yes"| D{"Already<br/>redeemed?"}
    D -->|"yes"| E["Rejected"]
    D -->|"no"| F["redeem sets status<br/>permanently"]
    F --> G["Ticket can never re-enter<br/>escrow or a reshuffle"]

    classDef ok fill:#E1F5EE,stroke:#0F6E56,stroke-width:1px,color:#04342C
    classDef bad fill:#FCEBEB,stroke:#A32D2D,stroke-width:1px,color:#501313
    classDef decide fill:#FAEEDA,stroke:#BA7517,stroke-width:1px,color:#412402
    class G ok
    class C,E bad
    class B decide
```

A ticket sitting in escrow must be withdrawn first — revoke the intent, withdraw, then redeem.

---

## Technical reference

### Data model

```mermaid
classDiagram
    class TicketMeta {
        uint32 eventId
        uint16 sessionId
        uint16 sectionId
        uint16 row
        uint16 seat
        uint8 status
        note "one storage slot, one SLOAD per read"
    }

    class Intent {
        address owner
        uint256[] offered
        uint32 eventId
        uint256 sessionMask
        uint256 sectionMask
        uint8 exactCount
        bool mustShareSession
        bool mustShareSection
        bool mustBeAdjacent
        int256 maxNetPay
        uint64 deadline
        uint256 nonce
    }

    class Leg {
        bytes32 intentHash
        uint256[] receives
        int256 netPayment
        note "no participant field — recipient is intent.owner"
    }

    class IntentState {
        uint8 NONE
        uint8 LIVE
        uint8 REVOKED
        uint8 SETTLED
    }

    TicketMeta "n" --o "1" Intent : offered by tokenId
    Intent "1" --> "1" Leg : matched by intentHash
    TicketMeta "n" --o "1" Leg : received by tokenId
    Intent "1" --> "1" IntentState : keyed by hash
```

`exactCount` is exact, never a minimum — a user asking for two seats must not receive three.

`mustShareSection` is not implied by `sectionMask`. *Floor or Tier 1 are both acceptable* and *both my tickets must be in the same one* are different statements; two mask bits set does not imply cohesion.

`maxNetPay` is signed: positive is a debit ceiling, negative is a credit floor. One field covers both payers and receivers.

### Contract call graph

```mermaid
flowchart TB
    U["User EOA"]
    SOL["Solver EOA"]

    subgraph TN["TicketNFT · ERC-721"]
        direction TB
        T1["mint(to, TicketMeta)<br/>onlyRegisteredIssuer"]
        T2["redeem(tokenId)<br/>onlyCurrentOwner"]
        T3["meta(tokenId) → TicketMeta"]
        T4["transferFrom(from, to, id)<br/>standard ERC-721"]
    end

    subgraph ES["Escrow"]
        direction TB
        E1["deposit(uint256[] ids)"]
        E2["withdraw(uint256[] ids)<br/>unconditional"]
        E3["depositor(tokenId) → address"]
        E4["release(id, to)<br/>onlySettlement"]
    end

    subgraph IR["IntentRegistry"]
        direction TB
        I1["commit(Intent, bytes sig)<br/>verifies EIP-712 — the only<br/>place a signature is checked"]
        I2["revoke(bytes32 hash)<br/>onlyOwner"]
        I3["state(hash) → uint8"]
        I4["markSettled(hash)<br/>onlySettlement"]
    end

    subgraph ST["Settlement"]
        direction TB
        S1["settle(Intent[], Leg[])"]
        S2["_validate() internal<br/>V1 to V8"]
        S3["_execute() internal"]
    end

    USDC["USDC · ERC-20"]

    U -->|"1 approve + deposit"| E1
    U -->|"2 sign then commit"| I1
    U -->|"approve spend cap"| USDC
    SOL -->|"3 propose + execute"| S1
    S1 --> S2
    S2 -->|"read"| I3
    S2 -->|"read"| E3
    S2 -->|"read"| T3
    S2 -->|"read balance + allowance"| USDC
    S2 --> S3
    S3 -->|"releaseBatch — the only<br/>settlement exit"| E4
    E4 -->|"safeTransferFrom"| T4
    S3 -->|"transferFrom net amounts"| USDC
    S3 -->|"mark settled"| I4
    U -->|"anytime"| E2
    U -->|"after settlement"| T2

    classDef decide fill:#FAEEDA,stroke:#BA7517,stroke-width:1px,color:#412402
    class S2 decide
```

`TicketNFT` keeps standard ERC-721 transfer semantics. Restricting `transferFrom` to
`Settlement` would break `Escrow.deposit()`, whose caller is the escrow, not the settlement
contract.

The restriction lives one level up: **`Escrow.releaseBatch` is `onlySettlement`**. So the
precise claim is *Settlement is the only actor that can instruct Escrow to release an escrowed
ticket* — not *Settlement is the only actor that can transfer a TicketNFT*. Depositors can
always withdraw their own tickets; what they cannot do is move an escrowed ticket to someone
else without passing validation.

### Ticket lifecycle

```mermaid
stateDiagram-v2
    [*] --> Minted : mint by registered issuer
    Minted --> Escrowed : deposit
    Escrowed --> Minted : withdraw, unconditional
    Escrowed --> Reallocated : settle, V1 to V8 all pass
    Reallocated --> Escrowed : new owner deposits again
    Minted --> Redeemed : redeem by current owner
    Redeemed --> [*] : terminal, can never re-enter escrow

    note right of Escrowed
        V2 reads depositor(tokenId)
        at settlement time, not at
        commit time
    end note

    note right of Redeemed
        V3 rejects any leg
        containing a redeemed ticket
    end note
```

A ticket in escrow cannot be redeemed. Revoke the intent, withdraw, then redeem.

### Intent lifecycle

```mermaid
stateDiagram-v2
    [*] --> None
    None --> Live : commit with valid EIP-712 signature
    Live --> Revoked : revoke by owner
    Live --> Settled : settle succeeds
    Live --> Live : deadline not yet passed
    Revoked --> [*]
    Settled --> [*]

    note right of Live
        V1 checks state == LIVE
        and block.timestamp <= deadline.
        An expired intent is rejected,
        not silently filtered.
    end note

    note right of Settled
        Terminal. The nonce is consumed,
        so the same signature cannot
        be replayed.
    end note
```

### EIP-712 commitment

```mermaid
flowchart TB
    subgraph D["Domain separator"]
        direction TB
        D1["name: RESHUFFLE"]
        D2["version: 1"]
        D3["chainId"]
        D4["verifyingContract"]
    end

    subgraph H["Struct hash"]
        direction TB
        H1["INTENT_TYPEHASH"]
        H2["owner, eventId"]
        H3["keccak256 of offered[]"]
        H4["sessionMask, sectionMask"]
        H5["exactCount, cohesion flags"]
        H6["maxNetPay, deadline, nonce"]
    end

    D --> DIG["digest = keccak256(<br/>0x1901, domainSeparator, structHash)"]
    H --> DIG
    DIG --> SIG["user signs once"]
    SIG --> REC["ecrecover at COMMIT<br/>must equal intent.owner<br/>then state = LIVE"]
    REC --> SET["at settlement: no signature.<br/>V0 rebinds the struct to its hash,<br/>V1 checks state == LIVE"]

    classDef ok fill:#E1F5EE,stroke:#0F6E56,stroke-width:1px,color:#04342C
    class REC ok
```

**The signature is verified once, at commit.** `settle()` takes no signatures and performs no `ecrecover`; a `LIVE` entry in the registry is the proof of authorisation. What settlement must do is rebind — recompute the hash from the struct it was handed and require it to match the one presented (V0) — otherwise a solver could pair a live hash with a struct carrying looser bounds.

**An intent signature authorizes one chain and one IntentRegistry.** Its EIP-712 domain is `{ name: "RESHUFFLE", version: "1", chainId, verifyingContract: intentRegistryAddress }`. The verifier is **IntentRegistry**, which authenticates `commit()`, not Settlement. Changing the chain ID or deploying a new Registry changes the signing digest: **all previously signed intents must be signed and committed again for the new deployment**. This is a correctness requirement, not an RPC configuration detail.

Frontend signing uses the `chainId` and `IntentRegistry` address from `deployments/<network>.json`, selected by `NEXT_PUBLIC_DEPLOYMENT` and read through [`lib/deployment.ts`](lib/deployment.ts) and [`lib/config.ts`](lib/config.ts) and [`signAndCommitIntent`](lib/contracts.ts). Reconfigure both with the target deployment, rebuild the frontend, verify the wallet/RPC chain and Registry `DOMAIN_SEPARATOR`, and discard cached signatures/proposals for the previous domain before accepting new signatures. [Domain mapping and migration acceptance checklist](docs/MAINNET_READINESS.md#eip-712-domain-and-signature-migration).

**Invalid on the new deployment does not mean revoked on the old one.** Old LIVE intents remain actionable on their original chain/Registry while their conditions remain valid; explicitly revoke them there if retiring that authorization. Switching RPC providers on the same chain with the same Registry does not change the domain. Replacing only Settlement while retaining the Registry does not rotate the EIP-712 domain either; that is a separate privileged configuration change.

### V4 — conservation, in detail

The check that stops entitlement being created or destroyed.

```mermaid
flowchart TB
    A["Collect all offered ids<br/>across every Intent"] --> B["Collect all received ids<br/>across every Leg"]
    B --> C{"len(offered) ==<br/>len(received)?"}
    C -->|"no"| X["ConservationViolated"]
    C -->|"yes"| D["Sort both id arrays<br/>in memory"]
    D --> E{"any duplicate<br/>within either array?"}
    E -->|"yes"| X
    E -->|"no"| F["Walk both sorted arrays<br/>in lockstep"]
    F --> G{"every position<br/>matches?"}
    G -->|"no"| X
    G -->|"yes"| J["Exact bijection proven"]

    classDef ok fill:#E1F5EE,stroke:#0F6E56,stroke-width:1px,color:#04342C
    classDef bad fill:#FCEBEB,stroke:#A32D2D,stroke-width:1px,color:#501313
    class J ok
    class X bad
```

Length equality alone is insufficient — it would admit a proposal that duplicates one ticket and drops another, which is why duplicates must be rejected inside each array before the two are compared.

Solidity has no memory mapping, so *use a scratch map* is not an implementable instruction. Sort and compare, or do a bounded O(n²) duplicate check at demo scale.

### V5 — per-participant predicate, in detail

Runs once per leg. Bitmask operations rather than array scans.

```mermaid
flowchart TB
    A["For leg L with intent I"] --> B{"len(L.receives)<br/>== I.exactCount?"}
    B -->|"no"| E1["CountMismatch"]
    B -->|"yes"| C["Load TicketMeta<br/>for each received id"]
    C --> D{"every m.eventId<br/>== I.eventId?"}
    D -->|"no"| E2["WrongEvent"]
    D -->|"yes"| F{"(1 shl m.sessionId)<br/>and I.sessionMask != 0<br/>for all?"}
    F -->|"no"| E3["SessionNotAccepted"]
    F -->|"yes"| G{"(1 shl m.sectionId)<br/>and I.sectionMask != 0<br/>for all?"}
    G -->|"no"| E4["SectionNotAccepted"]
    G -->|"yes"| H{"I.mustShareSession?"}
    H -->|"yes"| H2{"all sessionId equal<br/>to the first?"}
    H2 -->|"no"| E5["NotSameSession"]
    H -->|"no"| J
    H2 -->|"yes"| J{"I.mustShareSection?"}
    J -->|"yes"| J2{"all sectionId equal<br/>to the first?"}
    J2 -->|"no"| E6["NotSameSection"]
    J -->|"no"| K
    J2 -->|"yes"| K{"I.mustBeAdjacent?"}
    K -->|"no"| OK["Predicate satisfied"]
    K -->|"yes"| L{"same session AND section<br/>AND row?"}
    L -->|"no"| E7["SeatsNotAdjacent"]
    L -->|"yes"| M["Sort seats ascending"]
    M --> N{"seat[i+1] - seat[i]<br/>== 1 for all i?"}
    N -->|"no"| E7
    N -->|"yes"| OK

    classDef ok fill:#E1F5EE,stroke:#0F6E56,stroke-width:1px,color:#04342C
    classDef bad fill:#FCEBEB,stroke:#A32D2D,stroke-width:1px,color:#501313
    class OK ok
    class E1,E2,E3,E4,E5,E6,E7 bad
```

Adjacency implies **same session, same section, same row and consecutive seats** — all four, independently of the cohesion flags. Someone who accepts Saturday or Sunday and wants adjacent seats does not mean Saturday row A seat 10 beside Sunday row A seat 11; seat numbers are only comparable within one session, section and row.

It is checkable only because we issue the tickets and guarantee seat numbers are consecutive integers within a row. It does not generalise to arbitrary venues.

### V6 to V8 — money

```mermaid
flowchart TB
    A["For each Leg"] --> B{"netPayment<br/><= I.maxNetPay?<br/>one comparison,<br/>both directions"}
    B -->|"no"| X1["BudgetExceeded"]
    B -->|"yes"| E["accumulate total"]
    E --> F{"sum of all<br/>netPayment == 0<br/>exactly?"}
    F -->|"no"| X2["PaymentImbalance"]
    F -->|"yes"| G["ownerNet = SIGNED sum<br/>of that owner's legs<br/>+80 and −30 nets to +50"]
    G --> H{"for every NET DEBTOR:<br/>balanceOf and allowance<br/>>= ownerNet?"}
    H -->|"no"| X3["InsufficientPaymentCapacity"]
    H -->|"yes"| I["Safe to transfer"]

    classDef ok fill:#E1F5EE,stroke:#0F6E56,stroke-width:1px,color:#04342C
    classDef bad fill:#FCEBEB,stroke:#A32D2D,stroke-width:1px,color:#501313
    class I ok
    class X1,X2,X3 bad
```

`netPayment <= maxNetPay` is a **single** comparison, correct in both directions: positive is a debit ceiling, negative is a credit floor, and receiving more makes `netPayment` more negative. Splitting it into a payer branch and a receiver branch inverts the receiver case — a draft of this spec did exactly that, accepting anyone who received *less* than their floor.

Integer USDC, no rounding tolerance — the sum is exactly zero or the proposal is rejected.

Capacity is checked on the owner's **signed net position**, not per leg and not on the sum of positive legs. An owner holding legs of `+80` and `-30` nets to `+50` and needs 50, not 80 — anything else contradicts the phrase *net settlement*. One address may hold several intents, and an issuer normally does, so a per-leg check would also pass two `+80` debits against a 100 USDC balance and then fail mid-transfer.

Routing is specified rather than left open: **pull every debit into the settlement contract, then push every credit**, two deterministic passes in owner order. `Σ ownerNet == 0` follows from V7, so the passes balance exactly. Pairwise debtor-to-creditor routing would require inventing a matching, which is an arbitrary choice no implementation should be left to make.

Approval is a spending allowance, not a reservation. A user can spend their balance elsewhere after signing, which is why V8 reads live state rather than trusting a commitment.

### Solver internals

```mermaid
flowchart TB
    A["Query subgraph<br/>live intents + escrow state"] --> B["Filter by eventId<br/>and unexpired deadline"]
    B --> C["Build candidate graph<br/>node = intent<br/>edge = this bundle could satisfy that predicate"]
    C --> D["Enumerate reallocations<br/>within caps:<br/>maxParticipants, maxCandidates, timeout"]
    D --> E{"Candidate<br/>satisfies every<br/>predicate locally?"}
    E -->|"no"| D
    E -->|"yes"| F["Solve payment vector<br/>subject to per-participant<br/>maxNetPay and sum == 0"]
    F --> G{"Feasible?"}
    G -->|"no"| D
    G -->|"yes"| H["Add to candidate set"]
    H --> I{"Caps<br/>exhausted?"}
    I -->|"no"| D
    I -->|"yes"| J["Rank: min gross cash moved<br/>ties to fewer participants<br/>then smallest intent-hash set"]
    J --> K["Re-verify freshness<br/>against chain state"]
    K --> L["eth_call simulate"]
    L --> M["Submit propose + execute<br/>in one transaction"]

    classDef ok fill:#E1F5EE,stroke:#0F6E56,stroke-width:1px,color:#04342C
    classDef decide fill:#FAEEDA,stroke:#BA7517,stroke-width:1px,color:#412402
    class M ok
    class E,G,I decide
```

This is a combinatorial exchange and clearing it is NP-hard. The search is bounded and the caps are published. *No solution found* means *none found within the search bound*, not *none exists*.

The solver duplicates the contract's constraint logic so proposals do not fail on-chain, but that duplication is an optimisation, not a guarantee — a different solver could submit anything, and V1–V8 still refuse it.

### Subgraph schema

```mermaid
erDiagram
    TICKET }o--o{ INTENT : offeredTickets
    SETTLEMENT o|--|{ INTENT : settles
    TICKET {
        id ID PK
        tokenId BigInt
        eventId Int
        sessionId Int
        sectionId Int
        row Int
        seat Int
        owner Bytes
        depositor Bytes
        escrowed Boolean
        redeemed Boolean
    }
    INTENT {
        id Bytes PK
        owner Bytes
        eventId Int
        offered BigIntArray
        sessionMask BigInt
        sectionMask BigInt
        exactCount Int
        mustShareSession Boolean
        mustShareSection Boolean
        mustBeAdjacent Boolean
        maxNetPay BigInt
        deadline BigInt
        nonce BigInt
        state IntentState
        committedTx Bytes
        closedTx Bytes
    }
    SETTLEMENT {
        id Bytes PK
        proposer Bytes
        txHash Bytes
        blockNumber BigInt
        timestamp BigInt
        participantCount BigInt
    }
```

This shows the deployed [schema](subgraph/schema.graphql). Ticket custody lives on `Ticket`;
all signed fields and the original offered-ticket order live on `Intent`. Settlement records
link to the affected intents. `Settled` emits no per-leg payment data, so there is no
`SettlementLeg` entity. [Indexed events and receipt boundary](#what-is-indexed).

The subgraph supplies discovery and prefiltering. Chain state at execution is authoritative.

---

## Sequence diagrams

### Happy path — a three-way reshuffle with nobody online

```mermaid
sequenceDiagram
    autonumber
    participant A as Family A
    participant B as Family B
    participant C as Family C
    participant ESC as Escrow
    participant REG as IntentRegistry
    participant SUB as Subgraph
    participant SOL as Solver
    participant SET as Settlement
    participant USDC as USDC

    A->>ESC: deposit Friday A12, A13
    A->>REG: commit signed intent
    B->>ESC: deposit Saturday
    B->>REG: commit signed intent
    C->>ESC: deposit Sunday
    C->>REG: commit signed intent
    REG-->>SUB: IntentCommitted events

    Note over A,C: All three go offline. No further signatures.

    SOL->>SUB: query live intent pool
    SUB-->>SOL: three standing intents
    SOL->>SOL: bounded search, rank candidates
    SOL->>SET: eth_call simulate
    SET-->>SOL: would succeed
    SOL->>SET: settle in one transaction

    SET->>REG: check intentHash state == LIVE
    SET->>SET: V0 V1 V2 V3 V4 V5 V6 V7 V8
    SET->>REG: mark intents SETTLED (effects first)
    SET->>USDC: net payments, sum equals zero
    SET->>ESC: releaseBatch — tickets to recipients

    SET-->>A: Settled, Saturday B14 and B15, paid 18 USDC
    SET-->>B: Settled
    SET-->>C: Settled
```

### Rejection path — the contract refuses a malicious proposal

```mermaid
sequenceDiagram
    autonumber
    participant SOL as Malicious solver
    participant SET as Settlement
    participant ESC as Escrow

    SOL->>SET: settle with non-adjacent seats
    SET->>SET: V1 intents live ✓
    SET->>SET: V2 tickets escrowed ✓
    SET->>SET: V3 none redeemed ✓
    SET->>SET: V4 conservation holds ✓
    SET->>SET: V5 A required adjacent, got B14 and B27 ✗
    SET--xSOL: revert SeatsNotAdjacent
    Note over SET,ESC: Nothing moved. Everyone keeps their tickets.
```

The guarantee does not rest on trusting our solver. A different solver could submit anything; the contract still refuses.

### Issuer inventory unlocking a broken chain

```mermaid
sequenceDiagram
    autonumber
    participant A as Family A
    participant V as Venue
    participant SOL as Solver
    participant SET as Settlement

    A->>SOL: wants Saturday, no user holds one
    Note over SOL: No closed cycle exists among users
    V->>SET: unsold Saturday sits in escrow
    SOL->>SET: settle including venue as a participant
    SET->>A: A receives Saturday from venue
    SET->>SET: A's Friday goes directly to C
    SET->>SET: C's Sunday goes to B
    SET->>V: venue settles per its own predicate
    Note over A,SET: The venue injected an asset. Each ticket received exactly once — V4 holds.
```

---

## Sponsor tracks

### Bounty category verification

The two Arc targets stated above are the project's originally selected categories. Checked on 2026-09-10: the [current official ETHOnline 2026 prize page](https://ethglobal.com/events/ethonline2026/prizes#arc) does not list “Launch on Testnet & Push to Mainnet”. It makes $2,500 of the Best DeFi/Onchain Finance award conditional on the same project actually deploying to Arc Mainnet by September 30; it does not state that deployment readiness substitutes for deployment. See the [readiness package and pending release gates](docs/MAINNET_READINESS.md). Confirm current category names and availability before submitting; this README does not establish eligibility or register either bounty.

| Sponsor | Track | Why |
|---|---|---|
| **Arc** | Best DeFi / Onchain Finance | Conditional delivery and multi-party net settlement for non-fungible entitlements. Ticket delivery determines whether payment is permitted; every participant's debits and credits correspond within one settlement |
| **The Graph** | AI Use Case — From Scratch | Live indexed data drives the solver and the agent. Change a budget and the answer changes, because the pool is re-queried |
| **Arc** | Launch on Testnet & Push to Mainnet | *Conditional.* Its examples include stablecoin settlement and escrow logic added to a marketplace. Mainnet readiness is a separate bar — confirming what qualifies before committing |

### App Kits evaluation

**Evaluated on 2026-09-09; not integrated.** App Kit's [Send](https://docs.arc.io/app-kit/send) supports USDC transfers on Arc Testnet. The reviewed [public API](https://docs.arc.io/app-kit/references/sdk-reference) does not provide a drop-in module for our NFT custody, signed seat conditions and multi-owner net settlement. Individual sends would not preserve the existing transaction's combined payment and ticket checks.

We retain Escrow and Settlement for that execution path. Bridge and Unified Balance could support future wallet funding; currency conversion and treasury yield are outside this demo's scope. This is our response to the Arc track's relevance criterion, not a claim of App Kits usage. See the [capability comparison, official sources and presentation answer](docs/APP_KITS_EVALUATION.md), including an assessment of Arc's separate ERC-8183 escrow example.

### How Arc is load-bearing

```mermaid
flowchart TD
    A{"Every ticket condition<br/>satisfied?"} -->|"no"| B["No payment occurs at all"]
    A -->|"yes"| C["USDC nets across all participants"]
    C --> D["A −50 · D −100<br/>B +120 · C +30<br/>sum equals zero"]

    classDef bad fill:#FCEBEB,stroke:#A32D2D,stroke-width:1px,color:#501313
    classDef decide fill:#FAEEDA,stroke:#BA7517,stroke-width:1px,color:#412402
    class B bad
    class A decide
```

Money is not appended at the end. Delivery gates payment, and every participant's cash position resolves in the same settlement.

### How The Graph is load-bearing

Intents live in a Solidity mapping, and mappings cannot be enumerated on-chain. A contract cannot see the pool. Events are what make discovery possible.

More importantly, intents are **persistent**:

```mermaid
flowchart LR
    M["Monday<br/>intent signed"] --> N["No solution<br/>found"]
    N --> T["Tuesday<br/>venue releases<br/>20 tickets"]
    T --> S["Subgraph indexes<br/>new inventory"]
    S --> R["The same intent<br/>becomes satisfiable"]
    R --> X["Settles, with the user<br/>doing nothing"]

    classDef ok fill:#E1F5EE,stroke:#0F6E56,stroke-width:1px,color:#04342C
    class X ok
```

The market changes around a standing intent. That is what live indexed data is for.

*The subgraph is discovery and prefiltering. Chain state at execution is the source of truth — balances and allowances move, and an indexer lags.*

---

## Questions we expect

**Isn't this just a multi-party NFT swap?**
Multi-party barter exists — NeoSwap did it in 2022 with budgets, reserve prices and combinatorial optimisation. Its documented flow is: bring items to a room, bid on the specific items you see, receive a proposed trade, then every participant approves *that proposal* before it can execute. Their AI-recommended trades follow the same shape. We scope the comparison to that documented flow; their litepaper describes always-on rebalancing as future work, and we make no claim about later products. Ours is: sign an outcome predicate once, and any future combination inside those bounds needs no further approval. Proposal authorisation versus outcome authorisation.

To be precise about what that does and does not buy: it removes the post-match round trip, not the need for participants to exist. And it is one signature *per intent* — you sign again if the intent expires, is revoked, or changes.

**Isn't this CoW Protocol?**
CoW clears fungible tokens at a uniform price. Tickets are non-fungible and carry per-person bundle constraints — four seats must share a session and a section. No uniform clearing price exists, so what gets verified is not a price but each participant's declared conditions.

**Isn't this Seaport criteria orders?**
Seaport can express "any NFT matching this criterion", and that part is genuinely not new — predicate-based orders are established. Nor is Seaport limited to two parties: `matchOrders` settles any number of orders together, and zones allow custom validation around fulfilment. Seaport is a general settlement engine, and a sufficiently determined team could build something like this on top of it.

The difference is what the predicate is about, and what is first-class. A criteria order constrains *which asset may fill one side of my order*. An intent here constrains *the outcome of this settlement for me* — the bundle I must receive, its internal relationships (same session, same section, adjacent seats), and the maximum cash I will part with. Relational bundle constraints and per-participant cash bounds are the primitives, not something assembled from them.

> You don't sign the asset you want. You sign the post-settlement outcome you're willing to accept.

**Hasn't the theory been done?**
Yes, and we cite it. Top Trading Cycles dates to 1974; kidney exchange is its best-known application; a 2026 Imperial paper studies exactly this for Wimbledon ballot winners, including price differences between courts and dates. Matching-market research shows the reallocation can be improved. We made the conditional replacement executable — signed predicates, on-chain enforcement, asynchronous settlement, issuer inventory as a standing participant.

**What if there's no cycle?**
Buyers and sellers participate in the same pool, so a chain can terminate in cash at either end. Issuer inventory can start one. A closed cycle is one solution shape, not a requirement.

**Two solutions are both valid — who picks?**
The contract checks conditions; it does not rank. Selection is the solver's, and the rule is published: minimise gross cash moved — `sum of max(netPayment, 0)` — with ties breaking toward fewer participants, then toward the lexicographically smallest ordered set of intent hashes — a hash comparison rather than gas, so ranking is deterministic from the inputs alone. Gross rather than net, because V7 forces the net total to zero on every valid settlement, so a net objective would rank nothing. The interface separates *your limit*, *what you actually paid*, and *why this candidate*. We never call a result optimal — the search is bounded.

**How do I know the solver isn't cheating me?**
You don't have to. The contract validates the final state against the predicate you signed. A malicious solver can propose anything; V1–V8 refuse it. Try it in the demo.

**What if someone withdraws before settlement?**
The transaction reverts. Nobody is half-traded — that is EVM default behaviour, not our contribution. The proposer loses gas, which is why simulation runs first. Withdrawal is unconditional and immediate, by design.

**Doesn't signing in advance lock my funds?**
No. ERC-20 approval is a spending allowance, not a reservation, and escrowed tickets can be withdrawn at any time. You need not be online at settlement, but settlement still requires your intent, tickets and payment capacity to remain valid.

**Does this work with my Ticketmaster tickets?**
No. Only tickets issued by contracts in our registry. Minting an NFT from a PDF transfers nothing. This is a post-allocation reshuffling layer for issuer-native tickets, not a replacement for existing platforms.

**Couldn't a centralised platform just do this?**
Yes. A sufficiently motivated ticketing platform could search its own inventory, reserve a replacement, take back the old tickets, net the cash and commit — no blockchain required. We do not claim otherwise. The difference is who may propose a solution and who decides whether it executes: there, the platform's search, rules and settlement must all be trusted; here, anyone may propose, and a signed predicate plus the contract decide whether the proposal is allowed to execute. Discovery can be permissionless; authorisation does not have to trust the solver.

**Why do tickets have to be NFTs?**
They are not mathematically required — a database can run an atomic transaction, check seat adjacency and update ownership, and we said above that a centralised platform could do all of this. What changes is *who is the authority*. With a database, our backend performs the final reallocation and users trust that it did so correctly. With issuer-native onchain tickets, ticket state and transfer are enforceable by the same settlement contract that validates the signed predicates, so nobody has to trust our backend — including us.

**What stops scalpers?**
Nothing here. This reallocates tickets that have already been sold; it creates no seats and prevents no bot from buying them in the first place.

**What about the atomicity guarantee?**
A single transaction reverting wholesale is EVM default behaviour, so we don't claim it as an innovation. The contribution is verifying that a reshuffle satisfies every participant's own signed conditions before it executes.

---

## Limitations

Named, not hidden.

| Limitation | Status |
|---|---|
| **Cold start** | Reshuffles need density of compatible intent. Buyers, sellers and issuer inventory reduce the dependency; they do not remove it. A constructed cycle is not evidence of market demand |
| **Issuer trust is centralised** | Only registered issuer contracts are recognised. Their permissions are published |
| **No incentive-compatibility claim** | Conditions are self-reported. Users may misreport |
| **Bounded search** | *No solution found* is not *no solution exists*. Participant, candidate and timeout caps are published |
| **Unaudited** | Demonstration only. Do not deposit real assets |
| **Adjacency depends on us issuing** | Seat numbers are consecutive integers within a row by construction. This does not generalise to arbitrary venues |
| **The Graph is not the only possible discovery mechanism** | Mappings cannot be enumerated on-chain, but RPC logs could be indexed by other means. This implementation relies on The Graph |

---

## Repository

```text
src/                   Four Solidity contracts
script/                Foundry deployment and seeding
scripts/               Deployment, evidence and verification tools
test/                  Solidity validation and rejection tests
solver/src/            TypeScript bounded search and validation
shared/                Shared intent hashing and Graph snapshot client
subgraph/              Schema, generated manifest and event mappings
server/                Market adapters, solver, receipts and read-only agent
app/api/               Next.js backend route handlers
component/market/      Interactive ticket workspace and agent drawer
lib/                   Frontend models, configuration and API clients
deployments/           Chain records and public transaction evidence
docs/                  Specifications, demo guides and submission package
```

### Build

```bash
forge build
forge test -vvvv
forge test --gas-report
forge script script/Deploy.s.sol --rpc-url $ARC_RPC --broadcast
```

`foundry.toml` sets `evm_version = "paris"` — a current workaround for the documented open PUSH0 compatibility issue on Arc Testnet. Arc's chain docs describe the execution environment as Prague, so treat this as a present-state workaround and re-test before any mainnet deployment. Gas estimation on some USDC writes is also unreliable, so deployment scripts pass explicit gas limits.

### Deployment

| Contract | Address | Network |
|---|---|---|
| TicketNFT | [0xb2490568bb27c9c38588e3b5511ee3980892cce4](https://testnet.arcscan.app/address/0xb2490568bb27c9c38588e3b5511ee3980892cce4) | Arc Testnet |
| Escrow | [0x07ab57380db7df630fab2d3d3a1019a5a890b018](https://testnet.arcscan.app/address/0x07ab57380db7df630fab2d3d3a1019a5a890b018) | Arc Testnet |
| IntentRegistry | [0x479b4455f494679dcdd6f6f32e93e08682deda75](https://testnet.arcscan.app/address/0x479b4455f494679dcdd6f6f32e93e08682deda75) | Arc Testnet |
| Settlement | [0x75872168f2d6ae13c7d9258159e59025fd9b5eae](https://testnet.arcscan.app/address/0x75872168f2d6ae13c7d9258159e59025fd9b5eae) | Arc Testnet |

### Measured settlement gas

Measured on **2026-09-10** with `forge test --gas-report`: **32 tests passed, 0 failed**. Each row below comes from a separate successful test's **`Settlement.settle` function row**, with exactly one call (min = average = median = max). The test body's total gas, which includes preparing the tickets and intents, is not used.

| Successful scenario | Participants / intents | Tickets transferred | Optional constraints enabled¹ | Measured `settle` gas | Raw report |
|---|---:|---:|---:|---:|---|
| Two-party exchange; participants absent after commit | 2 / 2 | 2 | 0 | **208,016** | [Report](docs/gas/test_settles_without_participant_online.txt) |
| Buyer → swapper → seller | 3 / 3 | 4 | 4 | **291,716** | [Report](docs/gas/test_buyer_seller_chain_completes.txt) |
| Three-party adjacent-pair reshuffle | 3 / 3 | 6 | 6 | **378,779** | [Report](docs/gas/test_three_way_reshuffle_succeeds.txt) |
| Seeded three-party reshuffle, four tickets each | 3 / 3 | 12 | 9 | **561,664** | [Report](docs/gas/test_seed_is_live_then_settles_without_participants.txt) |

¹ Count of enabled `mustShareSession`, `mustShareSection` and `mustBeAdjacent` predicates, summed across intents. The rows enable respectively `(0, 0, 0)`, `(0, 2, 2)`, `(0, 3, 3)` and `(3, 3, 3)` in that order. Mandatory checks such as validity, event/masks, exact count, budget, conservation and payment capacity still run; they are not included in this optional-constraint count. These are different workloads, not an isolated measurement of each additional predicate's cost.

Environment: **Forge 1.8.1, Solidity 0.8.36, Paris EVM, via IR, optimizer enabled with 200 runs**. These are local Foundry measurements using `MockUSDC`; separate mint/approval/deposit/commit calls are excluded from the `settle` row. They are not Arc receipt `gasUsed` or a USDC fee quote. Arc's native USDC implementation and actual transaction state can produce different costs.

[Full passing suite report](docs/gas/full-suite.txt) · [Exact commands, fixtures and measurement scope](docs/gas/README.md). The full suite's aggregate `settle` statistics include expected reverts, so they are not presented as successful-settlement costs.

---

## Prior art

We build on existing work and say so.

| Work | What it established |
|---|---|
| Shapley & Scarf (1974), Top Trading Cycles | Multi-party reallocation from endowments |
| Roth et al., kidney exchange | All-or-nothing multi-way chains in practice |
| Haugh (2026), *From Luck to Choice: The Wimbledon Ballot and Matching Markets* | Ticket reallocation with price differences between dates and courts |
| NeoSwap | Multi-party NFT barter with budgets and combinatorial optimisation |
| Seaport | Criteria-based orders — bidding on any item matching a predicate |
| CoW Protocol | Signed intents cleared in batches, coincidence of wants |

None of them combines persistent outcome predicates, asynchronous multi-party clearing without re-approval, issuer inventory as a standing participant, and net cash settlement over non-fungible bundles. That combination is what this implements.


<!-- BEGIN ARC SETTLEMENTS -->
## Confirmed Arc Testnet settlements

Ten demonstration settlements on Arc Testnet (chain ID 5042002), using the same 12 tickets across three controlled test wallets. Each round commits fresh signed conditions; the backend searches current chain state and simulates before the local runner submits. These are repeatable integration demonstrations, not evidence of organic market demand.

| Round | Block | Confirmed transaction |
| --- | --- | --- |
| 1 | 61266588 | [0xb729bccb47a92fd5775f0f1974818058a0e20282d76389575e1f9cbc1a4146bb](https://testnet.arcscan.app/tx/0xb729bccb47a92fd5775f0f1974818058a0e20282d76389575e1f9cbc1a4146bb) |
| 2 | 61266673 | [0xec86d53308e935a71325ee62a8dd1af9a7aa7f82fbcf0d735e1e93b739114dd3](https://testnet.arcscan.app/tx/0xec86d53308e935a71325ee62a8dd1af9a7aa7f82fbcf0d735e1e93b739114dd3) |
| 3 | 61266753 | [0x30c51121dc88e05bb94bdc164555f29131ecce314b303e12638a48596df7df07](https://testnet.arcscan.app/tx/0x30c51121dc88e05bb94bdc164555f29131ecce314b303e12638a48596df7df07) |
| 4 | 61266819 | [0xe15a4645a810d7a88b384df7b73fcf0233e1af6dd946807147c28deb0e727859](https://testnet.arcscan.app/tx/0xe15a4645a810d7a88b384df7b73fcf0233e1af6dd946807147c28deb0e727859) |
| 5 | 61266894 | [0x6642c04d38c1c9423f3109261a4ed26da68266beed7f39211eaabda8c8db2d04](https://testnet.arcscan.app/tx/0x6642c04d38c1c9423f3109261a4ed26da68266beed7f39211eaabda8c8db2d04) |
| 6 | 61266967 | [0x3d613f3e32f01ee35a5829343bbc6db73bec31cdba0e7e6ae14337ea23b604c8](https://testnet.arcscan.app/tx/0x3d613f3e32f01ee35a5829343bbc6db73bec31cdba0e7e6ae14337ea23b604c8) |
| 7 | 61267051 | [0x8fb078b9743c3e3f107162505ef1b66a54eb0c9c2f81d6c8a1a135b4176e09a3](https://testnet.arcscan.app/tx/0x8fb078b9743c3e3f107162505ef1b66a54eb0c9c2f81d6c8a1a135b4176e09a3) |
| 8 | 61267118 | [0x9b64f8b52f88affce9fb6f49b06b09e14ccbb8af8dec2ba0cf992570a4efdf38](https://testnet.arcscan.app/tx/0x9b64f8b52f88affce9fb6f49b06b09e14ccbb8af8dec2ba0cf992570a4efdf38) |
| 9 | 61267198 | [0x3979f0de503bf45d352be0d90eb8ba9a841099c47841f1271ad0797dea063122](https://testnet.arcscan.app/tx/0x3979f0de503bf45d352be0d90eb8ba9a841099c47841f1271ad0797dea063122) |
| 10 | 61267278 | [0x3875f8f525e7bd826898a0f8f6b7838e79f3caa83cd742fe024c21fac90f2296](https://testnet.arcscan.app/tx/0x3875f8f525e7bd826898a0f8f6b7838e79f3caa83cd742fe024c21fac90f2296) |

Full per-round proposals, exclusions, simulation results and verified receipts: [settlement evidence](deployments/settlements/). Backend setup: [server documentation](server/README.md).
<!-- END ARC SETTLEMENTS -->
