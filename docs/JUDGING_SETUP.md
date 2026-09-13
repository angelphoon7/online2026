# Judging setup

The app can serve live matching and saved evidence without the developer's laptop once its
Next.js backend and storage are hosted. These changes prepare that path; they do not create
a hosting account, deploy to Vercel or provision a database.

## What a judge needs

| Activity | What the judge needs |
| --- | --- |
| Read the market, run pair/circle matching, inspect evidence and ask for a diagnosis | The public app URL; no wallet or account registration |
| Change a prepared request's budget or revoke it | The private judging access code; the configured testnet participant signs on the server |
| Claim free tickets | Their own wallet and a claim-message signature; the issuer pays mint gas |
| Deposit, commit their own request or settle a candidate | Their own wallet on Arc Testnet and test USDC for gas; a paying participant also needs settlement balance and allowance |

Judges can use an existing wallet address. They do not register an issuer address and never
need the operator's or participants' private keys. Share the **access code**, app link and
instructions privately through the submission. Keep server configuration and wallet keys
in the host's secret environment settings.

For gas, use the [Circle faucet](https://faucet.circle.com/), select **Arc Testnet**, and enter
the judge's wallet address. Arc's [connection guide](https://docs.arc.io/integrate/connect-to-arc)
lists the network settings. Free tickets do not fund a visitor's gas balance.

Open the event workspace and expand **Start here / judge the live demo**. Select a group,
check A+B, A+C and B+C, then A+B+C. These buttons invoke the real Graph-backed solver on
those exact hashes. Availability, exclusions and deadlines are read from live snapshots;
a match is established only by a new search and successful simulation. Other inventory in
the full market can allow a direct swap. A judge can then unlock **Judge controls**, change
a budget or revoke a request and observe the indexed change. Budget replacements keep the
group selection linked to the new hash.

## Local setup

```sh
npm ci
npm --prefix solver ci
npm run setup:env
npm run judge:setup
npm run dev
```

`setup:env` copies the tracked [template](../.env.example) to `.env.local` without overwriting
an existing file. Its defaults enable public reading with empty credential fields and keep
signing features disabled. `judge:setup` fills empty placeholders and adds missing judging
settings to ignored `.env.local`, including a random access code and the exact hashes from
`deployments/circle-inventory-sep12.json`. It does
not print the code, replace existing settings, create wallets or send transactions. An
explicit `false` remains `false`; set `JUDGE_CONTROLS_ENABLED=true` and
`DEMO_TICKETS_ENABLED=true` if enabling those features. Restart after editing environment
settings. Existing `.env` and `.env.seed` wallet keys remain private.

## Hosted backend and shared storage

Run the repository's Next.js Node service on a host that supports `npm run build` and
`npm start`. It includes the API routes; a static frontend export cannot run the solver,
save evidence or issue tickets. Use HTTPS, a Node 22+ runtime, install root **and solver**
dependencies, and allow up to 120 seconds for signing requests. The solver runs when an
API request arrives; it does not need a separate process on the developer's laptop.

For multiple instances or serverless hosting, create a persistent Redis database with
the [Redis REST API](https://upstash.com/docs/redis/features/restapi) (for example Upstash).
Configure the following server environment variables on every instance:

```dotenv
DEPLOYMENT=arc-testnet
NEXT_PUBLIC_DEPLOYMENT=arc-testnet
ARC_CHAIN_ID=5042002
ARC_RPC=https://rpc.testnet.arc.io
READ_SOURCE=graph
SUBGRAPH_URL=https://api.studio.thegraph.com/query/1760168/reshuffle/v0.1.1
STORAGE_BACKEND=redis
STORAGE_NAMESPACE=reshuffle-arc-testnet
AGENT_RATE_LIMIT_STORE=redis
# Use vercel on Vercel; trusted-proxy requires an ingress that overwrites client IPs.
AGENT_IP_SOURCE=trusted-proxy
REDIS_REST_URL=<your HTTPS REST endpoint>
REDIS_REST_TOKEN=<your private REST token>
JUDGE_CONTROLS_ENABLED=true
JUDGE_ACCESS_CODE=<copy the private access code from .env.local>
JUDGE_ALLOWED_INTENT_HASHES=<comma-separated demo intent hashes>
DEMO_TICKETS_ENABLED=true
PRIVATE_KEY=<existing funded testnet operator key>
DEMO_ISSUER_PRIVATE_KEY=<existing registered testnet issuer key, or omit to use PRIVATE_KEY>
SEED_B_PRIVATE_KEY=<existing demo participant B key>
SEED_C_PRIVATE_KEY=<existing demo participant C key>
```

Add `SUBGRAPH_API_KEY` only if the query endpoint requires it. The optional model key is
not required for deterministic diagnosis. Set the same public event dates at build time
as the local app. [Complete template](../.env.example).

Use the same persistent namespace across releases. Give separate deployments and preview
environments separate namespaces **and separate signing wallets**. Never let a preview,
local script or another service sign concurrently with a hosted writer using the same
wallet. Keep the Redis token server-side and use a database retention/eviction policy that
preserves claim and transaction journals. Back up storage and monitor its capacity: saved
evidence and transaction journals do not expire automatically. Judge sessions expire after
one hour; claim challenges after five minutes.

For one long-running Node backend with a real persistent volume, `STORAGE_BACKEND=file`,
`ALLOW_PERSISTENT_FILE_STORAGE=true` and an absolute `STORAGE_DIRECTORY` are supported.
The directory must survive releases/restarts and be writable by that backend. Ordinary
production local files are rejected unless explicitly configured. File storage is always
rejected on Vercel. Do not point a multi-region service at unrelated local directories.

Agent admission uses atomic Redis windows shared by the same storage namespace. Redis is
required in production even when evidence uses a persistent file volume. Set
`AGENT_IP_SOURCE=vercel` on Vercel, or `trusted-proxy` behind an ingress that overwrites
`X-Forwarded-For` with exactly one client IP and prevents direct app access. `auto` selects
Vercel on that runtime or the trusted proxy when `AGENT_TRUST_PROXY=true`; unidentified
production callers and unavailable Redis return `503 AgentRateLimitUnavailable` before
Graph/model work. Development-only memory counters do not establish hosted behavior.
[Current policy and validation scope](GRAPH_7I.md).

Before claiming deployment acceptance, run the [two-process Redis and public-IP checks](GRAPH_7I.md#deployment-acceptance).
The public-IP check needs two real networks, such as broadband and a mobile hotspot;
changing a forwarding header does not create a second client. No Vercel deployment has
been made as part of this rate-limit change.

For a hosted public-read error, see [public-read troubleshooting](#public-read-troubleshooting).

## Move existing local data

Tickets, escrow, intent state and settlements already live on Arc, and indexed entities
live at the Graph provider. Existing local evidence, claims and pending signing journals
need migration if you want their links and once-per-wallet history to remain valid.

Stop local **and hosted** writers before migration. Configure the target Redis credentials
locally without changing the namespace used by the source files, then run:

```sh
npm run storage:migrate -- --check
npm run storage:migrate -- --apply
```

The check reports record counts without printing signed transaction bytes or secrets. Apply
copies legacy `.data/evidence`, `.data/demo-tickets` claims and `.data/shared` records into
Redis. Existing identical records are accepted; conflicting records stop migration rather
than being overwritten. A partial import can be rerun. Local files are preserved. Keep
traffic stopped until the import and readiness checks finish. Do not run a fresh empty
database against the existing issuer and describe it as preserving previous claims.

## Renew a consumed or expired demo

A settled request is consumed; an expired signature cannot be extended. The bundled
`sep12` groups had an earliest deadline of **2026-09-19 04:00 UTC** when seeded. The guide
shows current indexed availability and signed deadlines, so it can report that a group
needs replacement instead of promising a match.

Pause hosted issuer/judge writes before using the same signing wallets locally. For a new
round, choose a new batch name and ensure the configured event dates leave a future cutoff:

```sh
npm --prefix solver run build
node scripts/seed-circle-inventory.mjs --check judging-round-2
node scripts/seed-circle-inventory.mjs --broadcast judging-round-2
node scripts/check-circle-inventory.mjs judging-round-2
npm run demo:catalog -- deployments/circle-inventory-judging-round-2.json
npm run demo:catalog -- deployments/circle-inventory-judging-round-2.json --publish
```

`--broadcast` creates real testnet tickets and commitments and spends test USDC. The check
script verifies all three pair rejections and the three-party simulation for each group.
Publishing updates only the shared catalog after live availability checks; it does not
mint or settle. All instances see the new catalog without a frontend redeploy. Update the
host's `JUDGE_ALLOWED_INTENT_HASHES` to permit editing the new requests, then resume writers.
Changing public event dates needs a new build as well as fresh signed intents.

## Retry and recovery

Claims are keyed by contract and wallet. The server saves a signed transaction before
broadcast and retries the identical bytes/hash. Issuance and judge actions share a signer
lease and a durable active-operation reservation. A worker lease can expire; the active
reservation does **not** expire while transaction status is uncertain. Another action
cannot use that signer until the original action is resumed or reconciled.

- Interrupted claim: click **Get free tickets** again with the same wallet. Sign a new
  challenge; the server resumes the existing pair rather than issuing another pair.
- Interrupted budget/revoke action: use **Resume saved action** in Judge controls. The
  saved plan survives the old hash leaving the Graph pool, and confirmed revoke receipts
  still raise the browser's indexing floor.
- Confirmed reverted transaction or a permanently unavailable RPC: the operator must
  inspect the saved transaction hash and chain nonce before recovering the job. Do not
  delete signing journals or clear an active reservation just because a request timed out.
  A confirmed revert may require a new commitment under a fresh nonce; it is not silently
  retried as a different transaction. With local file storage, a crashed `mutation.lock`
  also needs inspection after stopping writers.

Judge controls require a one-hour HttpOnly, SameSite=Strict session and exact Origin
checks on mutations. Only configured root hashes and their saved replacements are editable.
Removing a root from the allowlist removes its descendants' permissions; changing the
access code invalidates existing sessions. Per-mint and per-judge-transaction fee ceilings
are 0.1 test USDC; the issuer admits at most 20 new wallet claims per UTC day. A two-step
budget change is not atomic; a revoke can succeed while the replacement needs recovery.

## Verify before handing it to judges

The root `vercel.json` installs both dependency trees and uses the existing Next build.
`.vercelignore` and Next's trace exclusions keep local secrets and journals out of uploaded
source/function traces. This prepares a deployment; it does not create a hosting account or
a public URL. See [Step 11-C status](SUBMISSION_STATUS.md).
The existing URL was subsequently identified as [online2026.vercel.app](https://online2026.vercel.app/).
Its first public check returned frontend 200 but health 503; see the
[actual failure record](checks/hosted-acceptance.json) and
[configuration follow-up](SUBMISSION_STATUS.md#actual-hosting-failure-and-next-configuration-step).

```sh
npm test
npm run build
npm start
npm run judge:check -- https://online2026.vercel.app
npm run submission:check:hosted -- https://online2026.vercel.app --model
```

`GET /api/health` checks trusted Agent client identity and Redis admission, shared-storage
write/read, live Graph data, index lag (at most 120
seconds for this readiness policy), group availability, judge access configuration,
controlled signers' gas balances, unfinished signing reservations and the registered issuer. Its 0.2-USDC balance check is
a readiness threshold, not a transaction cost estimate. It returns 503 if a required
capability is unavailable, without exposing secrets.

`judge:check` asserts that each selected pair has no candidate after a complete bounded
search, each selected triple passes simulation, returned evidence can be read back through
its public link, and anonymous judge access is denied. It uses live data and broadcasts no
transactions. Changed budgets can correctly make this initial-circle check fail; prepare a
fresh round before rerunning it as an acceptance check.

Finally run that command from another computer with the developer's laptop **off**. Restart
the hosted service and open one of the previously returned evidence URLs again. In a fresh
browser, verify the access-code flow, revoke/budget response, wallet claim and one settlement.
These external checks require an actual hosted URL, persistent credentials and test gas;
passing local fixture tests does not establish them. Refresh inventory after a settlement
before the next judge's session.

`submission:check:hosted` records anonymous frontend/API responses, real Graph-backed
simulation, saved evidence, same-intent diagnosis and anonymous judge denial in
`docs/checks/hosted-acceptance.json`. With `--model` it also requires a real hosted model
response with provider IDs and no guard fallback. It sends no wallet transactions; solver
requests save evidence, and model questions consume the host's API allowance. Its
`PASS_PUBLIC_HTTP` result is separate from restart, different-network quota, wallet-write
and laptop-off acceptance. Redirects to deployment login cannot pass. Fixture tests produce
`PASS_FIXTURE`, never a public acceptance record.

Local validation on September 12 is recorded in [judging-readiness.json](checks/judging-readiness.json):
12 pair checks, four successful three-user simulations and 16 evidence records unchanged
across a local production-server restart. This used live Graph/Arc data and local persistent
storage, with no settlement broadcasts. Hosted Redis and a laptop-off public deployment
are explicitly marked unverified in that report.

## Public-read troubleshooting

A connected wallet does not configure the hosted server. On September 13, the public
`online2026.vercel.app` Graph proxy returned `SUBGRAPH_URL is not set`, while its RPC
proxy failed to use the RPC URL already present in the deployment record. Local Graph
requests also received HTTP 429 from the Studio provider. These are separate failures.

The fix uses the selected public deployment record when `SUBGRAPH_URL` or `ARC_RPC` is
absent/blank. Arc Testnet discovery defaults to Graph even without environment overrides;
the browser RPC proxy uses the same resolved RPC URL as the server. Explicit overrides
remain supported. Public browsing needs no wallet private key. Agent admission, evidence
storage and judge controls retain their separate configuration requirements above.

To configure an existing Vercel deployment explicitly, add these **Production** variables
under Project Settings → Environment Variables, then redeploy:

```dotenv
READ_SOURCE=graph
ARC_RPC=https://rpc.testnet.arc.io
SUBGRAPH_URL=https://api.studio.thegraph.com/query/1760168/reshuffle/v0.1.1
```

Keep API keys in server-only variables. Deploy the updated repository to receive the
fallback and throttling fixes; editing local `.env` cannot update the public website.
[Vercel applies environment changes to new deployments](https://vercel.com/docs/environment-variables).

`SubgraphRateLimited` / HTTP 429 means The Graph refused further queries. The client and
proxy now preserve `Retry-After`, return readable JSON even if the provider returned HTML,
and pause repeat requests during the cooldown. A retry never substitutes an older snapshot
or discards the receipt-block floor. Other provider failures return `GraphProviderUnavailable`.
The cooldown is per browser/process and does not replace a suitable hosted query allowance.

Respect the provider's retry time. If limits persist, configure a working production query
endpoint for this subgraph and its matching server-side `SUBGRAPH_API_KEY`; Studio's
[development query endpoint has usage limits](https://thegraph.com/docs/en/subgraphs/developing/deploying-publishing/using-subgraph-studio/).
An API key does not automatically remove the Studio development endpoint's limit. The
[production query guide](https://thegraph.com/docs/en/subgraphs/querying/from-an-application/)
describes the separate production endpoint. Do not switch to static data to conceal a
provider failure.

Verification: 10 new public-read regressions and **287 total server/Graph checks pass**;
TypeScript, changed-file ESLint and production build pass. A real Arc read without any
RPC override returned chain ID 5042002; the real Graph market read remained throttled.
The [live handler report](checks/public-read-fix.json) records the provider retry time and
explicitly states that the hosted deployment was not updated. These local fixes still
need deploying to Vercel, and live market recovery requires the Graph provider to accept
queries again.
