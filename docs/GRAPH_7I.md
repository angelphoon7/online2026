# Step 7-I: Agent admission and request deadlines

Updated on 13 September 2026. Both Agent APIs enforce a request quota before reading the
body, route parameters, Graph, RPC or model. Production uses shared Redis admission and
trusted per-IP identity. A single monotonic deadline includes admission and response work.
Code checks and real two-process Redis acceptance pass; public ingress acceptance remains separate.

| Route | Sliding window per IP across production instances | Default overall deadline | Next `maxDuration` |
| --- | --- | --- | --- |
| `POST /api/agent/ask` | 12 requests / 60 seconds | 60,000 ms | 65 seconds |
| `GET /api/agent/diagnose/:hash` | 30 requests / 60 seconds | 30,000 ms | 35 seconds |

These are configured limits, not measured throughput or latency claims. The route quotas
are separate so asking a question does not consume the diagnosis allowance. Rejections do
not append timestamps or extend the sliding window. Redis keys expire after 60 seconds
without an admission. Each key holds at most the route's allowance of accepted timestamps.
Requests from people behind the same public NAT IP necessarily share that IP's allowance.

## Client identity and deployment

Node's Web `Request` does not expose a verified socket peer address. `AGENT_IP_SOURCE=auto`
selects `x-vercel-forwarded-for` when the **runtime environment** has `VERCEL=1`. HTTP
headers such as `x-vercel-id` cannot enable that trust. The choice follows
[Vercel's documented platform IP headers](https://vercel.com/docs/headers/request-headers).
On Vercel, the legacy `AGENT_TRUST_PROXY=false` setting does not disable automatic IP selection.

Other production hosts must use `AGENT_IP_SOURCE=trusted-proxy`, or the legacy combination
`auto` and `AGENT_TRUST_PROXY=true`. The controlled ingress must **overwrite** incoming
`X-Forwarded-For` with exactly one verified client IP and block direct access to the app.
For a single public Nginx ingress this means `proxy_set_header X-Forwarded-For $remote_addr;`,
with the Node listener reachable only by that ingress. A proxy that preserves or appends
client-supplied headers does not satisfy this configuration. With another upstream proxy,
establish its trusted address handling before forwarding an IP to the app.

The app validates one IPv4/IPv6 address and normalizes IPv6 and IPv4-mapped forms. Lists,
missing headers, zone identifiers and malformed addresses fail with 503 in production;
they never create arbitrary buckets or silently combine all visitors. Generic forwarding
headers are ignored when Vercel's source is selected. Production refuses `unidentified`.

`AGENT_RATE_LIMIT_STORE=auto` selects Redis in production or when `REDIS_REST_URL` is set.
Production always requires `REDIS_REST_URL` and `REDIS_REST_TOKEN`, including hosts using
persistent files for evidence. All workers must share the same database and stable
`STORAGE_NAMESPACE`; previews should use a different namespace. Tokens stay server-side.
See the [REST command format](https://upstash.com/docs/redis/features/restapi).

One Redis `EVAL` removes expired timestamps, counts the current window, then admits or
rejects the request atomically. It uses [Redis server time](https://redis.io/docs/latest/commands/time/),
so worker clock differences do not shift the window. A unique member prevents simultaneous
requests collapsing into one timestamp. Keys contain a hash of the canonical IP and the
route; no raw IP is returned in API metadata. [Redis script atomicity](https://redis.io/docs/latest/develop/programmability/eval-intro/)
protects the decision from concurrent workers. Restarting workers does not clear Redis keys.

The Redis token must permit `EVAL`, `TIME`, `ZREMRANGEBYSCORE`, `ZCARD`, `ZRANGE`, `ZADD`
and `PEXPIRE`. Preserve active keys through the database's eviction/persistence policy;
flushing or losing Redis state also loses the quota history. Errors fail with 503 rather
than reverting to memory. Redis's transport timeout is at most 10 seconds and is also
cancelled by the request's remaining overall budget.

Development without Redis keeps the bounded in-memory table: at most 2,048 route/client
entries, with expired entries removed and no eviction of active quotas. Without a trusted
proxy, development callers share `unidentified`. This mode is rejected in production.

Optional environment overrides can shorten the overall deadlines:

```dotenv
# Defaults; these may be omitted.
AGENT_ASK_TIMEOUT_MS=60000
AGENT_DIAGNOSE_TIMEOUT_MS=30000
AGENT_RATE_LIMIT_STORE=auto
AGENT_IP_SOURCE=auto

# Required in production; use the existing shared storage credentials.
REDIS_REST_URL=<HTTPS Redis REST endpoint>
REDIS_REST_TOKEN=<private token>
STORAGE_NAMESPACE=reshuffle-arc-testnet

# Non-Vercel production only, with the controlled ingress described above:
# AGENT_IP_SOURCE=trusted-proxy
```

Timeout overrides must be positive integers no larger than the defaults. Invalid, zero,
negative, fractional or excessive values use the default. The hosting platform's execution
limit must allow the chosen application deadline plus response overhead; Next's
`maxDuration` exports do not override a provider's account limits.

## Deadline propagation

`server/agent/request-budget.ts` owns the timer, monotonic deadline and AbortSignal.
`request-control.ts` admits requests and maps the named failures. The same budget passes to:

- Redis admission, including the REST response body. A late result cannot start route work.
- Request body streaming and promised route parameters. Ask stops after 4,096 bytes,
  including chunked input, and cancels a stalled body reader.
- The initial Graph snapshot and exact-block closed-intent lookup, including response bodies.
- USDC balance and allowance reads at the snapshot block. Agent RPC transports use the
  shared signal with no automatic retry; other chain callers retain their previous settings.
- Every model turn, model tool call and deterministic fallback. An individual model request
  uses the smaller of 45 seconds and the remaining overall budget, with no automatic retry.
- Every hypothetical solver run, capped by the remaining time as well as the existing
  search bound. Search results are checked again before use.
- The seat-combination search, with a time check for each combination and an event-loop yield
  every 256 combinations. The event loop is also yielded before hypothetical solver runs.

Timer cancellation alone cannot interrupt synchronous JavaScript. Clock checks in the
combination loop and existing bounded solver searches provide cooperative stopping; a
response is checked against the deadline before it can be returned successfully. This is
not a hard real-time scheduling claim. If cancellation arrives during one synchronous solver
slice, it is observed when execution yields or reaches a deadline check.

The outer request races cancellation so an unresponsive upstream cannot hold the response
open. The downstream signal is also aborted, and checks after awaits prevent a late result
from starting another query, owner read, tool call or fallback. Completion removes timers
and caller listeners and cancels outstanding sibling I/O. Aborting a provider request does
not undo work the provider may already have accepted.

## API outcomes

| HTTP | JSON `code` | Meaning |
| --- | --- | --- |
| 429 | `AgentRateLimited` | Quota exceeded; `Retry-After` header and `retryAfterSeconds` give the wait |
| 503 | `AgentRateLimitUnavailable` | Missing/invalid trusted IP, production configuration or Redis availability; no Graph/model work |
| 504 | `AgentRequestTimeout` | Overall deadline reached; response includes the applied `timeoutMs` |
| 499 | `AgentRequestCancelled` | Caller cancelled; disconnected browsers may not receive a response |
| 413 | — | Ask request body exceeds the byte cap |
| 409 | Existing indexing response | Requested block floor has not been reached |
| 503 | Existing historical-state errors | Graph/RPC cannot provide the required snapshot |

Admission responses include `X-Agent-RateLimit-Store` (`redis` or development `memory`)
and `X-Agent-IP-Source`. A 429 uses `Retry-After` from Redis; an admission 503 uses 5 seconds.
The health endpoint checks trusted identity and the actual Lua path in one separate,
expiring probe bucket; it cannot consume a visitor's quota. Missing admission capability
sets `checks.agentRateLimit=false` and prevents a ready health response.

429, 503, 504 and 499 responses use `Cache-Control: no-store`. Timeout does not return a partial
diagnosis, an answer at an older block, or an empty result disguised as no match. SDK/RPC
abort wrappers are translated back to the request's named timeout or cancellation instead
of being reported as an unrelated snapshot failure. Existing freshness checks and the
409/503 distinction are preserved.

## Verification

`server/__tests__/agent-requests.mts` adds **22 tests** for route admission, sliding-window
recovery, bounded table capacity, trusted/untrusted IP headers, Graph headers/body stalls,
closed-intent lookup, RPC cancellation without retries, model cancellation without a late
fallback, caller disconnect, body/params deadlines, byte limits, late upstream responses,
cumulative time across model turns, expired budgets and an active combinatorial seat search.

```powershell
npx.cmd --yes tsx --conditions=react-server --test server/__tests__/agent-requests.mts
npm.cmd test
npm.cmd run build
```

The original deadline follow-up passed 22 new tests and a 128-test suite.
[Historical captured output](checks/graph-agent-requests-tests.txt).

The shared-limiter follow-up adds **15 tests** in `server/__tests__/agent-shared-rate.mts`:
Vercel and controlled-proxy identity, forwarded-header spoofing, normalization, invalid
production configuration, actual-route Redis denial before body/params, metadata on
admission, redacted provider failures, stalled Redis headers/body, caller cancellation,
unique concurrent members, and health-probe isolation/failure. **277 server/Graph checks
pass**, including all original 22 request-control tests. TypeScript, production build and
changed-file ESLint pass. These fixture tests do not execute Redis Lua on a real server.

All upstream responses in the new tests are explicit fixtures. They exercise the actual
route handlers, Graph client, viem transport, Anthropic SDK and solver. This step did not
send a transaction or run paid Anthropic acceptance; the separate [Step 7-G / H provider
acceptance](GRAPH_7G_7H.md) remains distinct.

## Deployment acceptance

Use a real persistent Redis REST database for these checks. No test result should be
inferred from fixtures, a successful build, or the script merely starting. Scripts assert
their outcomes and exit nonzero on failure; generated reports contain no Redis token.

```sh
# Uses a complete REDIS_REST_*, UPSTASH_REDIS_REST_* or KV_REST_API_* pair.
# Reads the shell, .env.local or .env; never combine a URL and token from different pairs.
npm run agent:check:rate -- --output .data/agent-rate-redis.json

# Alternatively, a PRIVATE ignored JSON file containing {"url":"...","token":"..."}:
npm run agent:check:rate -- --credentials .data/private-redis.json
```

This launches two independent Node processes using the real Agent route handlers and
a local proxy that overwrites client headers from the socket address. Two actual loopback
source addresses have separate allowances. Both trusted-proxy and simulated Vercel runtime
modes are checked: concurrent calls across workers must admit exactly 12 ask / 30 diagnose
requests, another IP must remain usable, changing forwarding headers must not reset quotas,
restarting both processes must preserve the counters, and the real 60-second window must
recover. It uses an isolated expiring namespace and invalid route inputs, so it does not
query Graph, call a model or send transactions. Allow about two window expiries; this is
a configured wait, not a performance measurement. A local proxy cannot certify Vercel's
actual ingress behavior.

After deploying, verify the public ingress using two machines/networks whose public IPs
are different. Keep other Agent traffic idle for 60 seconds on the first network. Prepare
the second machine beforehand so the second check can finish within 50 seconds of the
first check starting. Transfer only the quota report between them; it contains no keys.

```sh
# Network A: fills both quotas, varies forged headers, asserts 429 and Retry-After.
npm run agent:check:rate:deployed -- --url https://YOUR-APP --phase quota --output .data/quota.json

# Network B, while A's window is still active; copy A's quota.json here first.
npm run agent:check:rate:deployed -- --url https://YOUR-APP --phase independent --baseline .data/quota.json

# Network A again, at least 60 seconds after the quota check completed.
npm run agent:check:rate:deployed -- --url https://YOUR-APP --phase recovery --baseline .data/quota.json
```

These checks require the public Agent routes to be reachable, not a deployment protection
login page. A 400 means the synthetic invalid input reached validation after admission;
it is the expected allowed outcome. A 429 must have the Agent error code and bounded retry
headers. Both routes must report Redis and a trusted source. The script refuses a stale
baseline for the independent-IP check. Two tabs or forged headers on one network are not
two real public IPs. Public reports do not establish how many platform instances served
them; retain the separate multi-process Redis report as well.

**Recorded status:** the [actual run report](checks/graph-agent-rate-redis.json) now records
`passed: true` using the team's persistent free Upstash Redis database. Both the controlled
proxy and simulated Vercel modes passed: ask/diagnose quotas shared across two independent
processes, separate socket IPs, spoofed-header resistance, persistence after restarting both
workers, and recovery after the actual 60-second window. The test used isolated expiring
keys, with zero Graph/model calls or transactions. The earlier temporary endpoint failed
connectivity; that earlier failure is superseded by this new run, not relabelled as a PASS.

The database is connected only to `online2026` Production. Its injected REST credentials
also passed the [actual write/Lua/TIME probe](checks/redis-connection.json). No local wallet
or model credentials have been uploaded, and no business journals have been migrated.
Actual public Vercel ingress/two-network checks and full hosted acceptance remain pending.
The loopback test's `actualVercelIngressVerified` field correctly remains `false`.

The 13 September hosting follow-up shares provider-variable resolution between storage,
Agent admission and this acceptance script. Vercel builds now stop when the actual Redis
write/Lua probe fails, with setting names rather than secret/provider payloads in errors.
The combinatorial-search timeout regression uses an injected monotonic clock after the
search has started; separate stalled-I/O tests still exercise actual deadline timers.
The successful Redis record above comes from the subsequent persistent-database run.
