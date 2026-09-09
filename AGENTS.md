# AGENTS.md

Conventions for RESHUFFLE. Read `docs/RESHUFFLE_PRD.md` and `docs/RESHUFFLE_TRD.md` before
writing contract code.

**A market for outcomes, not listings.** Participants sign the outcome they will accept.
Settlement executes only when a whole reshuffle exists that satisfies every participant's own
signed conditions.

---

## The governing rule

**No promise without a check.**

Every guarantee in the PRD is enforced in `Settlement` or removed from the PRD. A frontend
promising adjacent seats while the contract accepts any seats is the worst failure available
to this project — it makes every other guarantee suspect.

Adding a user-facing condition follows one order: `Intent` field, `Settlement` check,
rejection test, then UI. Never the reverse.

---

## Layout

```
src/
  TicketNFT.sol        ERC-721, packed metadata, redemption
  Escrow.sol           custody, unconditional withdrawal
  IntentRegistry.sol   EIP-712 commitment and revocation
  Settlement.sol       validation and atomic execution
test/
  Settlement.t.sol     the rejection table — the core suite
  helpers/Fixture.sol
script/
  Deploy.s.sol
solver/                TypeScript, off-chain
subgraph/
web/
docs/                  PRD, TRD
```

---

## Commands

```bash
forge build
forge test -vvvv
forge test --gas-report              # every published figure comes from here
forge script script/Deploy.s.sol --rpc-url $ARC_RPC --broadcast
cd solver && pnpm test
```

`.env` needs `ARC_RPC`, `ARC_CHAIN_ID`, `USDC_ADDRESS`, `PRIVATE_KEY`, `SUBGRAPH_URL`,
`SUBGRAPH_API_KEY`. Never commit it.

---

## Contract conventions

**Solidity 0.8.x, checked arithmetic.** No unchecked blocks in validation paths.

**Named errors everywhere, never `require` with a string.** Each rejection reason gets its own
error carrying the offending values:

```solidity
error SeatsNotAdjacent(bytes32 intentHash);
error BudgetExceeded(bytes32 intentHash, int256 limit, int256 actual);
```

The demo shows the contract refusing a bad proposal. A generic revert proves nothing.

**Validation runs in this order and every step is unconditional:**

```
V1 intent validity      state == live, deadline unpassed, signature recovers to owner
V2 escrow ownership     every offered ticket escrowed by that intent's owner
V3 ticket status        none redeemed
V4 conservation         exact bijection between offered and received
V5 per-participant      eventId, masks, exactCount, cohesion, adjacency
V6 per-participant      netPayment within maxNetPay
V7 payment balance      sum of netPayment == 0, exactly
V8 payment capacity     each payer's USDC balance and allowance cover their leg
```

Only then transfer. **Checks first, effects, then interactions** — no partial state on a
failed batch.

**Bitmaps over loops.** Session and section acceptance is a single `&`. Cohesion compares
against the first element. Adjacency sorts seats and verifies a consecutive run.

**Packed metadata.** One storage slot per ticket, one `SLOAD` per validation read.

---

## Fields that are easy to get wrong

| Field | Rule |
|---|---|
| `exactCount` | Exactly, never a minimum. Asking for two must not yield three |
| `mustShareSection` | Distinct from `sectionMask`. Two acceptable sections is not "both in the same one" |
| `mustShareSession` | Same distinction |
| `mustBeAdjacent` | Same section, same row, consecutive seats. Only checkable because we issue the tickets |
| `maxNetPay` | Signed. Positive is a debit ceiling, negative is a credit floor |
| `deadline` | Checked in V1. Expiry is a rejection, not a filter |

---

## EIP-712

The domain contains `chainId` and `verifyingContract`. **Redeploying or changing networks
invalidates every committed intent** and requires reconfiguring the frontend domain.

This is a correctness requirement, not configuration. Never describe a chain migration as
changing an RPC URL.

Nonces are per-owner and single-use. Revocation is explicit and separate from ticket
withdrawal — withdrawing tickets does not revoke intents referencing them; V2 catches that at
settlement.

---

## Tests

**Assert specific named errors. Never a bare `vm.expectRevert()`** — a rejection test that
passes for the wrong reason is indistinguishable from one that passes correctly, and the
rejection tests are the product.

Required, and none may be removed:

```
three_way_reshuffle_succeeds
buyer_seller_chain_completes
settles_without_participant_online
redeemed_by_new_holder_only

rejects_non_adjacent_when_required     ← load-bearing
rejects_split_section_bundle
rejects_split_session_bundle
rejects_over_budget
rejects_wrong_count
rejects_unbalanced_payment
rejects_expired_intent
rejects_revoked_intent
rejects_withdrawn_ticket
rejects_redeemed_ticket
rejects_conservation_violation
rejects_insufficient_payment_capacity
```

`rejects_non_adjacent_when_required` is the difference between a product that guarantees
adjacency and a UI that mentions it.

---

## Solver

Off-chain, TypeScript, deterministic given the same inputs.

**Publish the ranking rule and never call the result optimal:**

> Among valid reshuffles found within the search budget, minimise total net payment. Ties
> break toward fewer participants, then lowest gas.

The search is bounded. *No solution found* is not *no solution exists*.

**Every proposal emits an inspectable evidence chain** — this doubles as The Graph evidence:

```
subgraph endpoint and block number
intents considered
candidates found
candidates excluded, each with its failing condition
chosen candidate and why
simulation result
transaction hash
```

Verify freshness against chain state before submitting; the indexer lags. Simulate with
`eth_call`, then submit propose-and-execute in one transaction so no window exists between
them.

---

## Language that must not appear in code, comments, README or UI

| Never | Instead |
|---|---|
| "optimal", "best price" | "lowest total net payment among candidates found" |
| "eliminates the failure mode" | "the user need not be online; settlement still requires intents, tickets and payment capacity to remain valid" |
| "no grief risk" | "simulation reduces known failures; a failed proposal costs the proposer gas" |
| "mathematically impossible to be strategy-proof" | "this implementation makes no incentive-compatibility claim" |
| "the only possible discovery mechanism" | "this implementation relies on The Graph" |
| "no solution exists" | "no solution found within the search bound" |
| atomicity as the contribution | the contribution is verifying every signed condition before execution |

Approval is a spending allowance, not a reservation. Simulation evaluates one state; it does
not lock it.

---

## Measurement

No performance figure appears anywhere unless it came from `forge test --gas-report` or a timed
solver run. Publish gas by participant count, ticket count and constraint count; publish solver
runtime with the caps that produced it.

---

## Demo integrity

Preloaded initial data is fine. **Preloaded outcomes are not.** A judge must be able to change
a budget or revoke an intent and watch the system respond correctly.

Every displayed number traces to chain state or is deterministically derived from it. Derived
values are fine. A hardcoded one invalidates the demo the moment someone asks what happened
on-chain.

---

## Commits

Messages describe the work, not the schedule:

```
feat: add adjacency check to settlement validation
test: reject non-adjacent bundle when mustBeAdjacent set
fix: check payment capacity before any transfer
```

The history should read as a development narrative. Do not manufacture empty commits.

---

## Scope

**Not building:** cross-chain, external ticketing integrations, platform buy-back, insurance,
solver fees, fiat rails, ordinal preferences, unbounded reshuffle size, additional sponsor
integrations.

Test for any addition: does it make *"you never give up your tickets unless the whole
replacement arrives"* more visibly true? If not, it goes in `IDEAS.md`.
