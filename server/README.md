# RESHUFFLE backend

Next.js Node.js route handlers run public market reads, the solver, state checks, simulation, evidence persistence and the read-only agent. A connected wallet signs final settlement transactions. The solver and agent do not sign. Separate enabled testnet issuer and judge routes can mint or revoke/commit using controlled server wallets; they are not part of the agent's tool set.

## Run

```powershell
npm.cmd run dev -- --port 3101
# Or production:
npm.cmd run build
npm.cmd run start -- --port 3101
```

`predev` and `prebuild` compile the shared TypeScript solver into `solver/dist`. The backend imports that build behind `server-only`. `NEXT_PUBLIC_DEPLOYMENT` selects generated deployment records for both Next client and server; `DEPLOYMENT` selects CLI records. Keep them consistent. Contract addresses and start blocks come from those records; `ARC_RPC` overrides the backend RPC. [Current environment table](../README.md#environment-variables). ABI snapshots in `server/abis.json` correspond to the deployed contracts.

## API

| Endpoint | Behavior |
| --- | --- |
| `POST /api/rpc` | Same-origin, read-only Arc RPC transport for browser chain reads. Contract calls are restricted to the configured contracts and USDC; log ranges are bounded to 10,000 blocks. Signing and broadcasting remain in the wallet. |
| `GET /api/market?minBlock=N` | Public market state from the selected Graph/RPC adapter. |
| `POST /api/graph` | Same-origin GraphQL proxy; query credentials stay on the server. |
| `POST /api/solve` | Accepts `{ "intentHashes": ["0x…", "0x…"], "minBlock": "N" }`, discovers signed conditions, reads chain state, searches and simulates. The block floor is optional. |
| `POST /api/solve/pool` | Searches the full supported live pool; optional `{ "minBlock": "N" }`. Returns source, snapshot block, bounds, candidates and simulation evidence. |
| `GET /api/agent/diagnose/{hash}?minBlock=N` | Deterministic diagnosis and evidence; no wallet or model key required. |
| `POST /api/agent/ask` | `{ "intentHash": "0x…", "question": "Why can't this intent settle?", "minBlock": "N" }`. Model tool selection/narration when configured, deterministic baseline diagnosis otherwise. |
| `GET /api/evidence/{id}` | Returns the saved evidence, including source block, considered hashes, excluded candidates, chosen proposal, search caps and simulation result. |
| `POST /api/evidence/{id}/receipt` | Accepts `{ "transactionHash": "0x…" }`. Checks chain ID, successful receipt, exact destination/calldata, `Settled` event and SETTLED registry states before attaching confirmation. |

Only hashes are accepted as explicit solver inputs; client-supplied budgets and ownership claims cannot change signed conditions. Explicit requests support 2–4 distinct committed intents. The pool service accepts up to 256 searchable live intents, forming candidates of at most four participants and four offered/received tickets per intent. Each search has 100-candidate and 2-second limits. Assignment recursion also checks the deadline. RPC mode scans bounded log pages; Graph discovery is the demo path. There is no claim about unbounded market search.

Market Graph queries apply `number_gte` to metadata, intents, tickets and settlements; an unmet
floor returns HTTP 409. Judge-list reads also accept `minBlock`. A budget replacement that
fails after revocation returns the confirmed revoke block/hash in `confirmed`, so the browser
can retain the receipt floor even on an error response. [Post-write UI and drawer checks](../docs/GRAPH_6B_8.md).

Both solver routes return top-level `snapshotBlock`, `bounds`, ranked `candidates` and `excluded`,
alongside the existing evidence fields. Only the chosen `proposal` has RPC simulation evidence
and, on success, transaction calldata. `snapshotBlock` is null in RPC mode. An unmet Graph
floor returns HTTP 409; requested hashes unavailable in the searchable snapshot return HTTP
422 without a log fallback. [Live HTTP responses and source logs](../docs/GRAPH_4A_6C.md).

The ranking rule is least gross cash moved among candidates found within the search budget, then fewer participants, then the lexicographically smallest ordered set of hashes. The backend sorts input hashes before searching. No solution found within the search bound does not establish infeasibility.

All capacity, custody, ticket and intent reads use one block snapshot. A subsequent simulation uses a fresh block. The local runner simulates again immediately before signing and sending. Simulation does not lock state; Settlement validates again at execution. A failed proposal costs its proposer gas.

Evidence persists under `.data/evidence` on the server filesystem. Mount persistent storage when deploying the service; an ephemeral serverless filesystem will not preserve it. Public artifacts for the ten recorded rounds are also exported to `deployments/settlements`. Responses never include private keys or authenticated RPC URLs.

`READ_SOURCE=graph` uses `server/market-graph.ts` and `server/solve-graph.ts` to discover the market from Studio. `READ_SOURCE=rpc` retains log-based discovery for local development. If unset, the presence of `SUBGRAPH_URL` selects Graph. Agent routes require Graph independently of this selector. Graph-mode explicit-hash solving stays within the indexed pool and never substitutes newer RPC log discovery. Receipts and execution simulation always use RPC.

The agent's pool, USDC balances/allowances and closed-intent lookup use the same snapshot block.
Payment capacity is cached with its block and rejected if reused for another snapshot.
Historical read failures return 503 without substituting `latest`; pruned Graph history is
distinguished from indexing lag. [Step 7-A / D checks](../docs/GRAPH_7A_7D.md).
The model guard requires the exact block prefix and accepts complete evidence-rendered
passages only. Amounts remain bound to direction and hypothetical context; arbitrary prose
cannot pass based on a value allowlist. Provider IDs and token usage appear in `modelCalls`;
fallback evidence is labelled separately. [Step 7-G / H checks and live acceptance setup](../docs/GRAPH_7G_7H.md).

## Testnet signing routes

`/api/demo/tickets` uses a registered issuer key to issue free test tickets when enabled.
`/api/demo/budget` and `/api/demo/revoke` use controlled participant keys for real on-chain
changes; a budget replacement revokes the old commitment and signs/commits a new nonce.
These are enabled by default in development and require their enable flags in a hosted
production demo. They cannot change arbitrary visitors' intents. Keep `PRIVATE_KEY`,
`DEMO_ISSUER_PRIVATE_KEY` and `.env.seed` server-side. Public reads and diagnosis need none.

## Ten real settlements

Start the backend, then:

```powershell
$env:SOLVE_API_URL = 'http://127.0.0.1:3101'
npm.cmd run arc:settle:ten
```

The runner uses the three existing local test wallets and the same 12 tickets. Each round's conditions are signed afresh from actual holdings, then passed as hashes to the HTTP backend. Only the proposal returned by the solver is submitted. Each successful transaction is checked against the evidence and ticket recipients. The README table contains only confirmed settlement transactions, not approvals, deposits or commits.

`.arc-settlements.json` saves signed transaction hashes before submission and supports resuming after interruption. Keep this local journal and `.env.seed`; do not run concurrent copies. Repeating the completed command reuses receipts. Round 11 is prepared but left unexecuted, with its live intents in `deployments/demo-ready.json`.

Run integration checks against the running backend after the ten-round runner has completed:

```powershell
node --test scripts/test-backend.mjs
```

These check malformed/duplicate/oversized requests, persisted evidence, unrelated receipt rejection, refusal to reuse already-settled intents and preservation of live signed budgets despite client overrides. Settlement broadcasts happen in the local runner or user's wallet; the optional issuer/judge routes described above are separate transaction writers.

`node scripts/audit-arc-settlements.mjs` independently checks the ten receipts, including their NFT recipients and balanced USDC transfers. Results are recorded in `deployments/settlement-audit.json`.

## Public demo and deferred wallet actions

Open `/` and an event poster for the current workspace. Ticket positions, intent data, automatic candidate search and settlement history render without wallet authorization. Graph mode reads indexed history; the RPC adapter uses bounded event scans. Read errors do not require a wallet connection.

Sign and commit, Deposit/Withdraw, and Propose and settle connect only when clicked, switch to Arc Testnet when needed, and continue the original action. The intent nonce is read for the account returned by that connection. Settlement is re-simulated after connection before submission. Connection or network rejection does not submit a transaction. The header shows address and native USDC balance only when connected. Redemption is omitted from this swap flow.

Browser regression check (isolated mock wallet and mocked public reads; no broadcasts):

```powershell
$env:WALLET_TEST_URL = 'http://localhost:3101'
node scripts/test-deferred-wallet-browser.mjs
```
