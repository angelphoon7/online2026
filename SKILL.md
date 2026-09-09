---
name: reshuffle-build
description: Build RESHUFFLE — a multi-party conditional exchange for event tickets on Arc, where participants sign the outcome they will accept and settlement executes only when every signed condition holds. Use this skill for any work on the RESHUFFLE contracts, solver, subgraph, agent, frontend, or tests, including TicketNFT, Escrow, IntentRegistry, Settlement, intent encoding, seat adjacency checks, net USDC settlement, and the demo scenes. Read it before writing any contract code, since the constraint language decides what the product may promise.
---

# RESHUFFLE

**A market for outcomes, not listings.**

Official exchange exists but is narrowly bounded — typically same event, venue and date. When
the replacement falls outside those bounds, resale reduces it to two independent actions: sell
what you have, then buy what you want, and the risk in between is yours. RESHUFFLE lets a user sign the outcome they would accept — *take my two
Friday tickets, but only if I simultaneously receive exactly two adjacent Saturday seats in one
section, and I pay no more than 30 USDC net* — and nothing moves until a whole outcome exists
that satisfies every participant's own signed conditions.

`docs/RESHUFFLE_PRD.md` states what the product promises. `docs/RESHUFFLE_TRD.md` states how
each promise is checked. Read both before writing contract code.

## The premise everything follows from

**Outcome authorisation, not proposal authorisation.**

NeoSwap's documented 2022 flow asks *"here is the trade, do you approve it?"* — participants
bring NFTs to a room, bid on what they see, the algorithm proposes a concrete trade, and a
contract is then created for every participant to sign. Its AI-recommended trades follow the
same shape: proposed, then accepted by all parties.

Scope the claim to that documented flow. Their litepaper describes an always-on rebalancing
system as future work, and there is no evidence either way about what later products do. RESHUFFLE
says *"here are the boundaries; any future trade inside them is already approved."*

State it precisely, because both halves are easy to overclaim:

- **One signature per intent**, not one ever. A user signs again when an intent expires, is
  revoked, or is changed.
- **What is removed is the post-match round trip**, not the need for people to be awake. Prior
  systems can notify participants and collect approvals over time; the cost is that a
  discovered proposal is dead until everyone returns to approve *that specific proposal*.

> You don't sign the asset you want. You sign the post-settlement state you're willing to
> accept.

That is the whole reason the contract validates so much. The user is not present when their
tickets move, so every condition they care about has to be enforceable without them, against a
solver nobody trusts.

When a design question comes up, resolve it against this sentence. *Would this still work if
the user never came back?* If not, it is the wrong design.

Related distinctions worth keeping straight, because a judge will raise them:

| Prior work | What it does | What is different here |
|---|---|---|
| Seaport | criteria items, multi-order `matchOrders`, extensible validation via zones | a general settlement engine, not an application. Relational bundle constraints and per-user cash bounds are not first-class there |
| NeoSwap | multi-party barter, budgets, combinatorial search | requires final approval from every participant |
| CoW Protocol | signed intents cleared in batches | fungible tokens at a uniform price; no bundle constraints |
| Top Trading Cycles, kidney exchange | the matching theory itself | one-shot mechanism, no persistence, no cash settlement |

Cite these. Do not claim novelty the project does not have — the contribution is the
combination and its execution model, not the mechanism.

**Never claim a centralised platform could not do this.** A sufficiently motivated ticketing
platform absolutely could: search its own inventory, reserve a replacement, return the old
tickets, net the cash, commit. No blockchain required. The honest proposition is about who is
allowed to propose and who decides whether a proposal may execute:

> Discovery can be permissionless; authorisation does not have to trust the solver.

The platform version requires trusting the platform's search, its rules and its settlement.
Here anyone may propose, and a signed predicate plus the contract decide whether it executes.

## The rule that governs everything

**No promise without a check.**

Every guarantee in the PRD must appear in `Settlement` as a validated condition. If a
constraint cannot be verified on-chain, it is removed from the UI and from the pitch — not
softened, not moved to a tooltip. A frontend that promises adjacent seats while the contract
accepts any seats is the single most damaging thing this project can ship, because it makes
every other guarantee suspect.

When adding a user-facing condition, work in this order: add the field to `Intent`, add the
check to `Settlement`, add the rejection test, and only then surface it in the UI.

## Order of work

Dependencies, not preferences. Nothing downstream is meaningful until the item above it holds.

1. **TicketNFT, Escrow, IntentRegistry** — packed metadata, unconditional withdrawal, EIP-712
   commitment.
2. **Settlement V1–V8 with the full rejection test table.** This is the product. Everything
   else displays or discovers what this enforces.
3. **Solver** with its ranking rule published.
4. **Arc Testnet deploy**, at least ten real settlements. Everything downstream needs real
   transactions to exist.
5. **Frontend** — three scenes plus the two embedded proofs.
6. **Minimal redemption.** Without it a judge sees an NFT swap rather than a ticketing
   application.
7. **Subgraph** — dropping it drops The Graph.
8. **Agent** — dropping it drops The Graph's AI track.

Items 1–5 are a complete submission targeting Arc alone. If time runs short, cut 8, then 7,
then 6 — a finished single-sponsor project beats a fragmented two-sponsor one.

**Checkpoint:** if the constraint validation in item 2 is not green by the end of day three,
the four load-bearing guarantees will not all land. Reassess then. It is observable rather
than a feeling.

## The four guarantees that must survive every cut

Cutting any of these turns the project into six NFTs moving in a circle, which is an
undergraduate algorithms exercise with a wallet connector.

1. **Full constraint validation on-chain**, adjacency included.
2. **Multi-party USDC net settlement** — without money, "you don't have to sell first" is not
   true.
3. **Pre-commitment: sign once, settle while offline.**
4. **The contract rejects malicious proposals** — this is what makes trusting the solver
   unnecessary.

## Traps

**Signatures do not survive a network change.** The EIP-712 domain contains `chainId` and
`verifyingContract`, so redeploying or moving chains invalidates every committed intent and
requires reconfiguring the frontend domain. This is a correctness requirement, not a
configuration detail. Never describe a migration as "just changing the RPC".

**The issuer is a participant, not a special case.** Unsold inventory is deposited into the
same escrow and committed as an ordinary intent — negative `maxNetPay`, wide masks, cohesion
flags off. There must be no separate code path and no privileged settlement branch. The value
of doing it this way is that a returned ticket satisfies the next participant inside the same
transaction rather than going back on a shelf, which is what makes a chain possible where no
closed user-to-user cycle exists. If you find yourself writing `if (isIssuer)` in
`Settlement`, stop — the design is wrong.

**`exactCount`, never `minCount`.** A user asking for two seats must not receive three. A
minimum cannot express "exactly".

**`mustShareSection` is not `sectionMask`.** "Floor or Tier 1 are both acceptable" is a
different statement from "both my tickets must be in the same one". Two mask bits set does not
imply cohesion. The same distinction applies to sessions.

**Adjacency is only checkable because we issue the tickets.** Seat numbers are consecutive
integers within a row by construction. Say so in the README; it does not generalise to
arbitrary venues.

**Approval is not reservation.** ERC-20 `approve` is a spending allowance. A user can spend
the balance elsewhere after signing. Check payment capacity in V8 before transferring
anything, and never claim funds are locked.

**Simulation does not lock state.** `eth_call` evaluates against one state. A participant can
withdraw afterwards and the real transaction still fails. Simulation reduces known failures; it
does not guarantee success, and `eth_call` plus the submitted transaction are two separate
calls with a real window between them. Safety comes from revalidation at execution, not from
pretending the window is absent.

**Check payment capacity before any transfer.** Failing partway through a batch of ERC-20
transfers wastes gas and produces a confusing revert.

**Conservation must be exact.** Every offered ticket appears in exactly one leg's receives, and
every received ticket in exactly one intent's offered. An unbalanced set reverts — it must
never silently create or destroy entitlement.

**Payment sums to exactly zero.** Integer USDC, no rounding tolerance.

**Bitmaps, not array loops.** Session and section acceptance is a single `&`. Cohesion is a
first-element comparison. Adjacency sorts and checks for a consecutive run.

**Every rejection needs a named error.** `SeatsNotAdjacent` on screen proves adjacency is
enforced on-chain. A generic revert proves nothing, and this project's credibility rests on
demonstrating refusal.

## Language that must not appear

These claims will be broken by one follow-up question.

| Do not write | Write instead |
|---|---|
| "Optimal" or "best price" | "Least cash moved among the candidates found within the search budget" |
| "Eliminates the failure mode" | "The user need not be online; settlement still requires intents, tickets and payment capacity to remain valid" |
| "No grief risk" | "Simulation reduces known failures; a failed proposal costs the proposer gas" |
| "Mathematically impossible to be strategy-proof" | "This implementation makes no incentive-compatibility claim" |
| "The only possible discovery mechanism" | "This implementation relies on The Graph to reconstruct the live intent pool" |
| "No solution exists" | "No solution found within the search bound" |
| Atomicity as the contribution | The contribution is verifying every participant's signed conditions before execution — a single transaction reverting wholesale is EVM default behaviour |

## Measure, never estimate

No performance figure appears in any document unless it came from `forge test --gas-report` or
a timed solver run. Publish gas by participant count, ticket count and constraint count.
Publish solver runtime with the participant cap, candidate cap and timeout that produced it.

## Demo integrity

Preloaded initial data is acceptable — ArcBook's winning demo used preloaded maker positions.
**Preloaded outcomes are not.** A judge must be able to change a budget or revoke an intent and
watch the system respond correctly.

Every displayed number traces to chain state or is deterministically derived from it. A
hardcoded value invalidates the demo the moment someone asks what happened on-chain.

## Reference files

- `references/contracts.md` — data structures, validation order, named errors
- `references/solver.md` — search bounds, the published ranking rule, output evidence chain
- `references/demo.md` — three scenes, two embedded proofs, the agent scene
- `docs/RESHUFFLE_PRD.md`, `docs/RESHUFFLE_TRD.md` — the authoritative specifications

## Reporting

Report `forge test -vvvv` output rather than summaries. A bare PASS is not evidence — a
rejection test that passes for the wrong reason looks identical to one that passes correctly,
so assert the specific named error, never a bare `vm.expectRevert()`.

If something fails, report the failure rather than working around it.
