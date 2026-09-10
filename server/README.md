# RESHUFFLE backend

Next.js Node.js route handlers run the solver, state checks, simulation and evidence persistence on the server. The frontend calls these handlers; it contains no matching algorithm. A connected wallet signs the final settlement transaction. The HTTP service never signs or spends from the deployment wallet.

## Run

```powershell
npm.cmd run dev -- --port 3101
# Or production:
npm.cmd run build
npm.cmd run start -- --port 3101
```

`predev` and `prebuild` compile the shared TypeScript solver into `solver/dist`. The backend imports that build behind `server-only`. `.env` supplies `ARC_RPC`, `ARC_CHAIN_ID`, the four contract addresses and `NEXT_PUBLIC_DEPLOYMENT_BLOCK`. ABI snapshots in `server/abis.json` correspond to the deployed contracts.

## API

| Endpoint | Behavior |
| --- | --- |
| `POST /api/rpc` | Same-origin, read-only Arc RPC transport for browser chain reads. Contract calls are restricted to the configured contracts and USDC; log ranges are bounded to 10,000 blocks. Signing and broadcasting remain in the wallet. |
| `POST /api/solve` | Accepts `{ "intentHashes": ["0x…", "0x…"] }`, reconstructs signed conditions from registry events, reads current chain state, searches and simulates. |
| `GET /api/evidence/{id}` | Returns the saved evidence, including source block, considered hashes, excluded candidates, chosen proposal, search caps and simulation result. |
| `POST /api/evidence/{id}/receipt` | Accepts `{ "transactionHash": "0x…" }`. Checks chain ID, successful receipt, exact destination/calldata, `Settled` event and SETTLED registry states before attaching confirmation. |

Only hashes are accepted as solver inputs; client-supplied budgets and ownership claims cannot change signed conditions. Requests support 2–4 distinct committed intents, at most four offered and four received tickets each, 100 candidates and a 2-second search budget. Assignment recursion also checks the deadline. Discovery scans at most 100 pages of 10,000 blocks and stops once all requested hashes are found; an older/larger deployment needs indexed discovery. There is no claim about unbounded market search.

The ranking rule is least gross cash moved among candidates found within the search budget, then fewer participants, then the lexicographically smallest ordered set of hashes. The backend sorts input hashes before searching. No solution found within the search bound does not establish infeasibility.

All capacity, custody, ticket and intent reads use one block snapshot. A subsequent simulation uses a fresh block. The local runner simulates again immediately before signing and sending. Simulation does not lock state; Settlement validates again at execution. A failed proposal costs its proposer gas.

Evidence persists under `.data/evidence` on the server filesystem. Mount persistent storage when deploying the service; an ephemeral serverless filesystem will not preserve it. Public artifacts for the ten recorded rounds are also exported to `deployments/settlements`. Responses never include private keys or authenticated RPC URLs.

Discovery currently uses Arc RPC logs. Evidence explicitly identifies `source.kind = rpc` and `subgraphEndpoint = null`. The Graph is not configured yet. This server boundary is where the subgraph adapter and server-only `SUBGRAPH_API_KEY` belong once an indexed endpoint exists; RPC evidence is not described as The Graph evidence.

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

These check malformed/duplicate/oversized requests, persisted evidence, unrelated receipt rejection, refusal to reuse already-settled intents and preservation of live signed budgets despite client overrides. All transaction broadcasts happen in the local runner or user's wallet, never through the public API.

`node scripts/audit-arc-settlements.mjs` independently checks the ten receipts, including their NFT recipients and balanced USDC transfers. Results are recorded in `deployments/settlement-audit.json`.

## Public demo and deferred wallet actions

`/demo` and `/reshuffle` render tickets, intent data, the prepared round's current solver result and settlement history without wallet authorization. History reads `Settled` events over at most the most recent 100,000 blocks since deployment and displays the exact scanned range. Chain/RPC failures show read errors; they do not require a wallet connection.

Sign and commit, Deposit/Withdraw, and Propose and settle connect only when clicked, switch to Arc Testnet when needed, and continue the original action. The intent nonce is read for the account returned by that connection. Settlement is re-simulated after connection before submission. Connection or network rejection does not submit a transaction. The header shows address and native USDC balance only when connected. Redemption is omitted from this swap flow.

Browser regression check (isolated mock wallet and mocked public reads; no broadcasts):

```powershell
$env:WALLET_TEST_URL = 'http://localhost:3101'
node scripts/test-deferred-wallet-browser.mjs
```
