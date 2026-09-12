# Step 7-I: Agent admission and request deadlines

Implemented and checked on 12 September 2026. Both Agent APIs now enforce a request quota
before reading the body, route parameters, Graph, RPC or model. A single monotonic deadline
covers the admitted request through generation of the response.

| Route | Sliding window per client, per instance | Default overall deadline | Next `maxDuration` |
| --- | --- | --- | --- |
| `POST /api/agent/ask` | 12 requests / 60 seconds | 60,000 ms | 65 seconds |
| `GET /api/agent/diagnose/:hash` | 30 requests / 60 seconds | 30,000 ms | 35 seconds |

These are configured limits, not measured throughput or latency claims. The route quotas
are separate so asking a question does not consume the diagnosis allowance. Rejections do
not append timestamps or extend the sliding window. The in-memory table holds at most 2,048
route/client entries. Expired entries are removed; new entries are refused when the table
is full instead of evicting an active quota.

## Client identity and deployment

Node's Web `Request` does not expose a verified socket peer address. By default, the app
ignores `X-Forwarded-For` and uses a shared `unidentified` client bucket for each route.
Changing a request header therefore cannot reset the quota on a directly exposed server.

Set `AGENT_TRUST_PROXY=true` only behind a controlled ingress that **overwrites** incoming
`X-Forwarded-For` with the actual client IP, and prevent callers reaching the application
directly. The app then uses the first IP, validates it and normalizes IPv6 and IPv4-mapped
addresses. Missing or invalid values use the shared bucket. A proxy that simply preserves
or appends untrusted values does not meet this requirement.

Limits are local to a running Node instance. Restarting it clears the counters. Multiple
instances need a shared atomic rate-limit store or equivalent ingress enforcement before
claiming a deployment-wide quota. No external rate-limit API/key was added in this change.

Optional environment overrides can shorten the overall deadlines:

```dotenv
# Defaults; these may be omitted.
AGENT_ASK_TIMEOUT_MS=60000
AGENT_DIAGNOSE_TIMEOUT_MS=30000

# Enable only with the controlled ingress described above.
# AGENT_TRUST_PROXY=true
```

Timeout overrides must be positive integers no larger than the defaults. Invalid, zero,
negative, fractional or excessive values use the default. The hosting platform's execution
limit must allow the chosen application deadline plus response overhead; Next's
`maxDuration` exports do not override a provider's account limits.

## Deadline propagation

`server/agent/request-budget.ts` owns the timer, monotonic deadline and AbortSignal.
`request-control.ts` admits requests and maps the named failures. The same budget passes to:

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
| 504 | `AgentRequestTimeout` | Overall deadline reached; response includes the applied `timeoutMs` |
| 499 | `AgentRequestCancelled` | Caller cancelled; disconnected browsers may not receive a response |
| 413 | — | Ask request body exceeds the byte cap |
| 409 | Existing indexing response | Requested block floor has not been reached |
| 503 | Existing historical-state errors | Graph/RPC cannot provide the required snapshot |

429, 504 and 499 responses use `Cache-Control: no-store`. Timeout does not return a partial
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

Results: **22 new tests passed; 128 total Graph/agent tests passed; production build and
TypeScript passed; changed-file ESLint passed without warnings.** The total includes the
other Graph wait tests present in the shared workspace. [Captured suite output](checks/graph-agent-requests-tests.txt).

All upstream responses in the new tests are explicit fixtures. They exercise the actual
route handlers, Graph client, viem transport, Anthropic SDK and solver. This step did not
send a transaction or run paid Anthropic acceptance; the separate [Step 7-G / H provider
acceptance](GRAPH_7G_7H.md) remains distinct.
