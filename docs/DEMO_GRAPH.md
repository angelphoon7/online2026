# The Graph beat: run of show

Step 10 of `docs/RESHUFFLE_GRAPH_PLAN.md`. The scene where a judge changes a signed condition
on-chain and watches the indexer, the solver and the agent all follow.

Every number below was measured against Arc Testnet, not chosen. Re-run the rehearsal after
any reseed: the threshold the beat turns on is a property of the pool, and reseeding moves it.

```bash
npx --yes tsx --conditions=react-server scripts/rehearse-graph-act.mts
```

---

## What the beat is

A participant who can settle now demands to be paid more than anyone else in the pool has
signed up to pay. Nothing else changes — same tickets, same seats, same sessions.

| | |
|---|---|
| Demo intent | `0xf7387010926792738ba5c0b1048ec46e5aa3197ba8ef81ca7976b8864d31baf0` |
| Owner | `0xa8dae73bde3a5c0e412884c9be2039a79dfb31fd` |
| Before | `SETTLEABLE` — 2 participants, no payment either way |
| Change | Apply budget to **−4 USDC** (a credit floor: *pay me at least 4*) |
| After | `NOT_FOUND_WITHIN_BOUND` |
| To restore on camera | Apply budget to **−3 USDC**, which still settles |

**Why −4 and not −15.** The deepest signed willingness to pay in this pool is **3.00 USDC**.
A floor of −3 is inside what someone will pay; −4 is outside it. That is the whole mechanism,
and it is a fact about the committed intents rather than a tuned constant. The rehearsal
prints it:

```
deepest signed willingness to pay in the pool: 3.00 USDC
  0xf7387010...  settles now (2 participants, pays 0.00 USDC)
                 deepest floor that still settles: -3 USDC  ·  breaks at: -4 USDC
```

Measured on five settleable intents; all five broke at exactly −4.

**Why a floor and not a ceiling.** Every seeded intent in this pool settles at zero payment,
so lowering a debit ceiling removes nothing — the participant was never paying anything. The
signed sense of `maxNetPay` is what makes the beat possible at all: a negative limit is a
credit floor, and the market has a finite depth to satisfy it.

---

## Order of operations

| Beat | Action | What must be on screen | What is behind it |
|---|---|---|---|
| 1 | Open the drawer on the demo intent | `Live · Arc Testnet block #N · via The Graph` | the snapshot's `_meta.block` |
| 2 | Ask **Why can't this intent settle?** | answer opens `At Arc Testnet block #N`, says a reshuffle **was** found, 2 participants, no payment | `/api/agent/ask` to `diagnose_intent` |
| 3 | Judge control: Apply budget to −4 USDC | receipt panel shows **two** transaction hashes: revoke and commit | 6-D, real on-chain `revoke()` + `commit()` |
| 4 | Wait for the indexer | `Indexing block #M…`, then the header block advances to at least M and the drawer follows the **new hash** | `waitForIndexed(commitBlock)` |
| 5 | Ask the same question again | answer now opens `At Arc Testnet block #M` and says no settlement was found within the search bound | same endpoint, later block |
| 6 | Expand **Evidence** | supply funnel non-zero at every stage, demand non-empty, `maxNetPay->cap` found, the three cohesion relaxations not found, Arcscan links | the evidence JSON |
| 7 | (optional) Apply budget to −3 USDC | after indexing, the answer returns to a settlement | the control works both ways |

Beats 4 and 5 each need a held second. The block number changing and the answer changing are
the two things the scene exists to show; rushing past them shows neither.

### The sentences, rehearsed

Before:

> At Arc Testnet block #61751928, a reshuffle including this intent was found, with 2
> participants (1 counterparty), with no payment either way. Use Propose and settle to submit
> it; the contract re-checks every signed condition before it executes.

After:

> At Arc Testnet block #61752025, no settlement was found within the search bound. The
> smallest change among those tried: raise the signed payment limit — that produced a
> 2-participant reshuffle. Signing a new intent is what would make it real; nothing moves
> until then.

The second sentence is the point of the whole track: the pool is unchanged, the tickets the
participant wants still exist (the funnel never reaches zero) and someone still wants theirs
(demand is non-empty). What changed is one signed number, and the system says so without being
told which one.

---

## Timing, measured

| Step | Measured | Source |
|---|---|---|
| Steady-state head/index distance, converted to seconds | median ~2s, max ~6s inferred; **not receipt-to-index timing** | `docs/graph-acceptance.md` 4-A, 12 samples |
| `diagnose` on a `NOT_FOUND_WITHIN_BOUND` intent | **~8.1s** | `runtimeMs` from the rehearsal above |
| `diagnose` on a `SETTLEABLE` intent | ~1.7s | step 9 fixture suite |

The 8-second figure is the one to plan around. It is four relaxations, three of which run to
the 2000 ms search timeout before reporting not-found. On camera that is a visible wait after
beat 5. Either let it sit with the spinner — it is doing real work, and the Evidence panel
then proves it — or shorten the published `timeoutMs`. If it is shortened, re-run the
rehearsal: the bound is part of every claim the agent makes.

---

## Preconditions

- [ ] `npm test` green (32 tests)
- [ ] `npm run subgraph:parity` PASS at a recent block
- [ ] Rehearsal exits 0 and names a demo intent
- [ ] `JUDGE_CONTROLS_ENABLED=true` (or dev mode) and `.env.seed` holds the owner's key
- [ ] `ANTHROPIC_API_KEY` set if the narrated answer is shown; without it, show
      `GET /api/agent/diagnose/:hash`, which is the same evidence with no model in the path

Reseeding invalidates both the intent hash and the −4/−3 threshold. Re-run the rehearsal and
update this file; do not read the old numbers onto a new pool.

---

## Editing rules

- Cutting the indexing wait is allowed. **Speeding up the video is not** — ETHGlobal forbids it.
- The frame where the header block number changes from N to M must survive the cut, and so must
  both answers. Without them the recording proves nothing a screenshot would not.
- The two transaction hashes in beat 3 stay legible long enough to pause on. They are what
  makes the control real rather than a frontend state change.

---

## Two defects this rehearsal found

Both were found by trying to record the beat, and both would have been visible to a judge.

**1. The search spent its bound on other people.** `search()` enumerated subsets in
combination order and stopped at `maxCandidates`, and `solveHypothetical` then reported
`found` only if the single globally top-ranked candidate happened to include the asker. In a
73-intent pool the bound was exhausted on reshuffles between strangers, so **every one of the
64 changeable intents diagnosed as `NOT_FOUND_WITHIN_BOUND`** — including ones that settle at
zero payment. `SearchConfig.mustInclude` now holds the asking intent fixed and combines the
rest, so the bound is spent on candidates that can answer the question actually asked. The
same 64 intents now diagnose as `SETTLEABLE`, and one diagnosis runs in ~40 ms instead of
~125 ms.

The global `/api/solve` path does not set `mustInclude` and is unchanged: when proposing a
settlement, any valid reshuffle will do.

**2. A budget relaxation could name a cause that was not one.** Because widening any condition
changed which candidates the bounded search reached first, `maxNetPay->cap` could report
`found` for a settlement the committed limit already permitted — observed at block 61751218
with `targetNetPay: 0` against a committed limit of `0`. The agent would have told a judge to
raise a limit that was never binding. `Relaxation.binding` now records whether the settlement
found actually costs more than the committed limit, and `smallestWorkingChange` will not
recommend a change that was not load-bearing.

Both are covered by tests in `server/__tests__/`.
