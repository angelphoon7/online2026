# AGENTS.md

Conventions for RESHUFFLE. Read `docs/RESHUFFLE_PRD.md` and `docs/RESHUFFLE_TRD.md` before
writing contract code.

**A market for outcomes, not listings.** Participants sign the outcome they will accept.
Settlement executes only when a whole reshuffle exists that satisfies every participant's own
signed conditions.

---

## The premise

**Outcome authorisation, not proposal authorisation.**

The user signs once and leaves. They never see the trade that executes. Every condition they
care about must be enforceable by the contract in their absence, against a solver nobody
trusts.

Resolve design questions against this: *would this still work if the user never came back?*

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
V0 settlement shape     intents.length == legs.length; each intentHash appears exactly once;
                        each Intent hashes to the key it is presented under. Leg has no
                        participant field — the recipient is intent.owner
V1 intent validity      state[intentHash] == LIVE, deadline unpassed. No ecrecover here —
                        settle() has no signatures. commit() authenticated once; V0 binds
                        the supplied struct to the live hash
V2 escrow ownership     every offered ticket escrowed by that intent's owner NOW, and every
   and event binding    offered ticket's eventId == intent.eventId — clearing is within one
                        event, so eventId is the market, not just the desired outcome
V3 ticket status        none redeemed
V4 conservation         exact bijection between offered and received
V5 per-participant      eventId, masks, exactCount, cohesion, adjacency
V6 per-participant      netPayment within maxNetPay
V7 payment balance      sum of netPayment == 0, exactly
V8 payment capacity     ownerNet = SIGNED sum of that owner's legs; check only net debtors
                        against ownerNet. +80 and -30 nets to 50, not 80. Routing: pull all
                        debits into the contract, then push all credits — two deterministic
                        passes in owner order, never pairwise matching
```

Only then transfer, **in this order**:

```
1  mark every intent LIVE -> SETTLED          ← effects
2  USDC transfers                              ← interactions
3  Escrow.releaseBatch                         ← interactions
4  emit
```

Effects before interactions, always. `safeTransferFrom` calls into the recipient; moving a
ticket while its intent is still `LIVE` opens a reentrant window against stale state. Marking
first is safe because any later revert rolls the marking back with it.

`Escrow.deposit` rejects redeemed tickets, and `Escrow.withdraw` is depositor-only —
*unconditional* means no time lock and no settlement approval, never that anyone may call it.
Both clear `depositor[id]` before transferring.

Tickets leave escrow through `Escrow.releaseBatch(ids, to)` marked `onlySettlement`. The escrow
owns the NFT once deposited, so `Settlement` cannot transfer it directly and must not hold
blanket operator approval. Inside `releaseBatch`, clear `depositor[tokenId]` **before**
`safeTransferFrom` — the transfer calls into the recipient.

`sessionId` and `sectionId` are normalised class ids and **must be < 256**, enforced in
`mint` — they index bit positions in a `uint256` mask, so id 300 mints a ticket no predicate
can ever accept. `row` and `seat` keep the full `uint16` range; they are compared numerically.

Masks are `uint256`, not `uint16`. Sixteen session or section classes is not enough for a real
venue, and the storage saved is not worth capping the product.

**Bitmaps over loops.** Session and section acceptance is a single `&`. Cohesion compares
against the first element. Adjacency sorts seats and verifies a consecutive run.

**Packed metadata.** One storage slot per ticket, one `SLOAD` per validation read.

---

## Fields that are easy to get wrong

| Field | Rule |
|---|---|
| `exactCount` | Exactly, never a minimum. Asking for two must not yield three. **`0` is valid** — that is a pure seller, and V5 must handle an empty `receives` without touching `receives[0]` |
| `mustShareSection` | Distinct from `sectionMask`. Two acceptable sections is not "both in the same one" |
| `mustShareSession` | Same distinction |
| `mustBeAdjacent` | **Same session AND same section AND same row AND consecutive seats**, independently of the cohesion flags — seat numbers are only comparable within one session, section and row. Requires `exactCount >= 2`, enforced at commit. Only checkable because we issue the tickets |
| `maxNetPay` | Signed. Positive is a debit ceiling, negative is a credit floor. **V6 is one comparison — `netPayment <= maxNetPay` — never two branches.** Splitting it inverts the receiver case, accepting anyone who gets less than their floor |

**Never compute or store a platform price for a ticket.** Valuation is subjective — the same seat is worth different amounts to different people. Participants state reservation constraints (`maxNetPay`), and validity means every participant's own constraint holds. There is no oracle, no price feed and no assessed value anywhere in this system, and adding one would change what the product is.

**Issuer intents use the same struct.** Unsold inventory is deposited into the same escrow and
committed as an ordinary intent with negative `maxNetPay` and wide masks. No `if (isIssuer)`
anywhere in `Settlement` — a returned ticket must be able to satisfy the next participant
inside the same transaction, which only works if the issuer flows through the identical path.
| `deadline` | Checked in V1. Expiry is a rejection, not a filter |

---

## EIP-712

The domain contains `chainId` and `verifyingContract`. **Redeploying or changing networks
invalidates every committed intent** and requires reconfiguring the frontend domain.

This is a correctness requirement, not configuration. Never describe a chain migration as
changing an RPC URL.

`commit()` is **permissionless** — anyone may relay it, because the EIP-712 signature is what
authenticates `intent.owner`. Requiring `msg.sender == owner` would make the typed-data
signature redundant. `revoke()` is **owner-only**.

`settle()` carries `nonReentrant`. Effects already precede interactions, but `safeTransferFrom`
reaches `onERC721Received` and there is no reason to permit a nested settlement from inside a
callback.

Tickets enter escrow by **pull**: `deposit()` calls `transferFrom` after the caller approves.
If `IERC721Receiver` is implemented at all, it must revert for transfers not originating in
`deposit()` — a direct `safeTransferFrom` would leave `depositor[id] == address(0)` and strand
the ticket permanently.

`hashIntent` has **one** definition, shared by frontend and contract. EIP-712 hashes
positionally, so typehash string, struct order and `abi.encode` order must match exactly, and
`offered` hashes as `keccak256(abi.encodePacked(...))`. Keep a JSON fixture whose digest is
asserted equal in TypeScript and Solidity — without it, drift surfaces at commit as *signature
does not recover to owner*, which reads like a wallet bug.

**Nonces are reserved in `commit`, not at settlement.** `usedNonce[owner][nonce]` is set when
the intent is committed and never cleared — revoking does not return a nonce. Two different
intents from the same owner hash differently, so without this check both could be `LIVE` under
the same nonce. Settlement's only state effect is `LIVE -> SETTLED`.

Revocation is explicit and separate from ticket
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
rejects_id_at_or_above_mask_width
pure_seller_with_exact_count_zero_settles
rejects_adjacency_flag_with_exact_count_below_two
rejects_deposit_of_redeemed_ticket
rejects_withdraw_by_non_depositor
rejects_duplicate_nonce_at_commit
commit_by_third_party_relay_succeeds
rejects_revoke_by_non_owner
owner_net_uses_signed_sum_not_positive_sum
hash_intent_matches_typescript_vector
rejects_insufficient_payment_capacity
```

`rejects_non_adjacent_when_required` is the difference between a product that guarantees
adjacency and a UI that mentions it.

---

## Solver

Off-chain, TypeScript, deterministic given the same inputs.

**Publish the ranking rule and never call the result optimal:**

> Among valid reshuffles found within the search budget, minimise **gross cash moved** —
> `sum of max(netPayment, 0)` over all legs. Ties break toward fewer participants, then lowest
> the lexicographically smallest ordered set of intent hashes.

The last tie-break is a hash comparison, not gas: the solver must be deterministic from its
inputs, and gas estimation is unreliable on Arc. Measure gas, report it, never rank on it.

Gross, not net: V7 forces `sum(netPayment) == 0` on every valid settlement, so a net-total
objective is constant and ranks nothing.

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
`eth_call`, then submit immediately. The two are separate RPC calls and a window exists
between them — simulation does not lock state. Safety comes from revalidation at execution,
not from the absence of a window.

---

## Language that must not appear in code, comments, README or UI

| Never | Instead |
|---|---|
| "optimal", "best price" | "least cash moved among candidates found within the search budget" |
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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
