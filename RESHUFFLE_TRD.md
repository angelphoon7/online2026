# RESHUFFLE — Technical Requirements

Companion to `RESHUFFLE_PRD.md`. Every guarantee in the PRD must appear here as a checked
condition, or the guarantee is removed from the PRD. **No promise without a check.**

| | |
|---|---|
| Version | 1.1 |
| Chain | Arc Testnet — EVM, USDC as native gas |
| Language | Solidity, Foundry |
| Backend | TypeScript solver — Arc explicitly requires a working backend |

---

## 0. The premise

**Outcome authorisation, not proposal authorisation.**

A user signs once and leaves. They never see the trade that eventually executes, and they are
asked for nothing at settlement time.

Every condition they care about must therefore be enforceable by the contract in their
absence. That single sentence generates the whole validation surface below — session, section,
count, cohesion, adjacency, budget, expiry, redemption status. None of it is thoroughness for
its own sake; it exists because nobody is there to click *confirm*.

It also fixes the trust boundary: the solver is untrusted by construction, since a different
solver could submit anything and the contract must still refuse it.

---

## 1. System

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend — swapper / buyer / seller, single-operator mode    │
└────────────────────────┬────────────────────────────────────┘
                         │ one EIP-712 signature per intent
┌────────────────────────▼────────────────────────────────────┐
│ Arc Testnet                                                 │
│   TicketNFT        packed metadata, redemption               │
│   Escrow           custody, unconditional withdrawal         │
│   IntentRegistry   signed conditions                         │
│   Settlement       validate + atomic execute                 │
└────────────────────────┬────────────────────────────────────┘
                         │ events
┌────────────────────────▼────────────────────────────────────┐
│ Subgraph — reconstructs the live intent pool                 │
└────────────────────────┬────────────────────────────────────┘
                         │ GraphQL
┌────────────────────────▼────────────────────────────────────┐
│ Solver + Agent — search, simulate, propose, explain          │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. TicketNFT

ERC-721. Metadata packed into one slot so validation reads one word per ticket.

```solidity
struct TicketMeta {
    uint32 eventId;
    uint16 sessionId;
    uint16 sectionId;
    uint16 row;
    uint16 seat;      // consecutive integers within a row — this is what makes
                      // adjacency checkable, and only holds because we issue
    uint8  status;    // 0 active, 1 redeemed
}
mapping(uint256 => TicketMeta) public meta;
```

- Only issuer contracts in `registeredIssuers` may mint. Centralised and documented as such.
- `redeem(tokenId)` sets status permanently and is callable only by the current holder.
- A redeemed ticket can never re-enter escrow.

---

## 3. Escrow

```solidity
// rejects any ticket whose status is REDEEMED — the guarantee is "can never
// re-enter escrow", which has to hold at the door, not only at V3
function deposit(uint256[] calldata ids) external;

// Tickets enter by PULL: deposit() calls transferFrom(msg.sender, this, id)
// after the caller approves the escrow. TicketNFT is our own contract, so no
// IERC721Receiver is required for this path. If the hook is implemented anyway
// it must revert for transfers not originating in deposit() — otherwise a direct
// safeTransferFrom leaves depositor[id] == address(0) and the ticket is stuck.

// depositor-only, immediate, no lock period, no settlement approval required.
// "Unconditional" means no time lock — it does not mean anyone may call it.
function withdraw(uint256[] calldata ids) external;

function releaseBatch(uint256[] calldata ids, address[] calldata to)
    external onlySettlement;                                  // the only settlement exit

mapping(uint256 => address) public depositor;
```

No lock-up. Withdrawal never blocks. This bounds the grief surface: the worst a participant
can do is invalidate a proposal, and the proposer should have simulated first.

Withdrawing does not automatically revoke intents that reference the ticket — the freshness
check in §5 catches it. Revocation is separate and explicit.

---

## 4. IntentRegistry

```solidity
struct Intent {
    address  owner;
    uint256[] offered;          // must be escrowed by owner at settlement
    uint32   eventId;
    uint256  sessionMask;       // acceptable sessions, bit per session
    uint256  sectionMask;       // acceptable sections, bit per section
    uint8    exactCount;        // exactly this many received — not a minimum
    bool     mustShareSession;  // all received share one session
    bool     mustShareSection;  // all received share one section
    bool     mustBeAdjacent;    // consecutive seats, one row
    int256   maxNetPay;         // > 0 pay at most; < 0 receive at least
    uint64   deadline;
    uint256  nonce;
}
```

**Field-by-field rationale.**

**`sessionId` and `sectionId` must be < 256, enforced at mint.** They are stored as `uint16`
but consumed as bit positions in a `uint256` mask, so an id of 300 cannot be expressed by any
predicate and would mint a ticket nothing can ever match. `require(sessionId < 256 &&
sectionId < 256)` in `mint`. They are normalised class ids, not free-form venue codes. `row`
and `seat` are unaffected — they are compared numerically, never used as bit positions.

Masks are `uint256`, not `uint16`. Sixteen classes is not enough for a real venue — a large
arena has more than sixteen sections before you count sessions — and the storage saved is not
worth capping the product. Session and section ids are normalised to bit positions at issuance.

**`exactCount == 0` is how a pure seller is expressed** — offered tickets, nothing received,
negative `maxNetPay`. V5 must handle an empty `receives` array: require `receives.length == 0`
and skip every bundle check, since masks, cohesion and adjacency are vacuous over an empty set.
Seeding a cohesion comparison from `receives[0]` reverts on exactly the participant who lets a
chain terminate in cash.

`mustBeAdjacent` requires `exactCount >= 2`, enforced at `commit` — adjacency of one seat is
not a meaningful statement.

`exactCount`, not `minCount` — a user asking for two seats must not receive three. A minimum
cannot express "exactly".

`mustShareSection` is separate from `sectionMask` — "Floor or Tier 1 are both acceptable" is
not the same statement as "both my tickets must be in the same one". Two mask bits set does
not imply cohesion.

`mustBeAdjacent` — verified as: **same session AND same section AND same row AND consecutive
seats**, independently of `mustShareSession` and `mustShareSection`. A user who accepts Saturday
or Sunday and wants adjacent seats does not mean Saturday row A seat 10 beside Sunday row A seat
11; seat numbers are only comparable within one session, section and row. Only meaningful
because seat numbering is ours.

`maxNetPay` signed — one field covers both directions. Positive is a debit ceiling, negative is
a credit floor, and a single `netPayment <= maxNetPay` enforces both.

### The issuer intent

An issuer is a participant, not a privileged operator. It deposits unsold inventory into the
same escrow and commits an intent under the same struct — no separate code path, no separate
validation.

```
offered          unsold tickets for this event
eventId          this event
sessionMask      every session it will accept back
sectionMask      every section it will accept back
exactCount       set per shipped intent, matching what it offers
mustShareSession false
mustShareSection false
mustBeAdjacent   false
maxNetPay        negative — the floor it must receive for the difference
```

Because it flows through the identical `settle()` path, issuer inventory **injects an asset
into the clearing graph**: a ticket the venue offers can satisfy A, which frees A's ticket to
go **directly to C** in the same settlement. That is the structural difference from
customer-versus-inventory exchange, and it needs no new contract logic — only a
differently-parameterised intent.

Note what this does *not* mean. A ticket cannot route through the issuer and onward to another
participant in one settlement: V4 requires each ticket to be received exactly once, so
`A's ticket → Venue` and `A's ticket → C` in the same call is a double receive and reverts.
The issuer supplies an asset; it does not relay one.

An issuer may hold several such intents with different inventory. Nothing distinguishes them
from user intents at V1–V8.

**Commitment and revocation.**

```solidity
// PERMISSIONLESS relay: anyone may submit. The EIP-712 signature authenticates
// intent.owner, so msg.sender is irrelevant. Requiring msg.sender == owner would
// make the typed-data signature redundant, and a judge will ask why it exists.
// Also reserves usedNonce[owner][nonce] permanently.
function commit(Intent calldata i, bytes calldata sig) external;   // stores hash + owner

function revoke(bytes32 intentHash) external;                      // msg.sender == owner

// The registry stores only hash -> owner, state. Every matching condition therefore
// exists on-chain ONLY inside this event; omit a field and the subgraph cannot
// reconstruct it and the solver cannot match on it.
event IntentCommitted(
    bytes32 indexed intentHash, address indexed owner, uint32 indexed eventId,
    uint256[] offered, uint256 sessionMask, uint256 sectionMask, uint8 exactCount,
    bool mustShareSession, bool mustShareSection, bool mustBeAdjacent,
    int256 maxNetPay, uint64 deadline, uint256 nonce
);                      // owner only
mapping(bytes32 => uint8) public state;                            // 0 none, 1 live, 2 revoked, 3 settled
```

**One `hashIntent` definition, shared by frontend and contract.** The typehash string, the
struct field order and the `abi.encode` argument order must match exactly — EIP-712 hashes
positionally, so a reordering silently produces a different digest. `offered` is a dynamic
array and hashes as `keccak256(abi.encodePacked(i.offered))`, not as the raw array. See
`references/contracts.md` for the canonical form.

**Required test: a shared vector.** One fixed `Intent` in a JSON fixture, digest computed in
TypeScript and in Solidity, asserted equal. Without it the implementations drift and the
failure surfaces at commit as *signature does not recover to owner*, which reads like a wallet
bug and is not.

**Nonces are reserved at `commit`, not at settlement.** `usedNonce[owner][nonce]` is written
when the intent is committed and never cleared; revoking does not return it. Two different
intents from one owner hash differently, so without this check both could be `LIVE` under the
same nonce. Settlement's only state effect is `LIVE -> SETTLED` — there is nothing left to
consume.

EIP-712 domain includes `chainId` and `verifyingContract`. **Signatures do not survive a
network change or a redeploy.** If the contracts move to another network, every intent must be
re-signed and the frontend domain reconfigured. This is not a config detail; it is a
correctness requirement and it is the reason a mainnet migration is not a matter of switching
an RPC URL.

---

## 5. Settlement

The core. Everything the PRD promises is enforced here or not at all.

```solidity
struct Leg {
    bytes32   intentHash;
    uint256[] receives;      // ticket ids the intent owner receives
    int256    netPayment;    // > 0 pays, < 0 receives
}

// No participant field: the recipient is intent.owner, resolved from intentHash.
// Supplying it separately gives a solver a field to lie in.

function settle(Intent[] calldata intents, Leg[] calldata legs) external nonReentrant;
```

### Validation, in order

```
V0  settlement shape    intents.length == legs.length; every intentHash appears exactly once;
                        each leg resolves to exactly one supplied Intent; each Intent hashes
                        to the key it is presented under
V1  intent validity     state[intentHash] == LIVE and deadline not passed. NO signature
                        recovery — settle() receives no signatures. Authentication happened
                        once at commit(); V0 binds the supplied struct to the live hash
V2  escrow ownership    every offered ticket escrowed by that intent's owner NOW, AND every
    and event binding   offered ticket's eventId == intent.eventId. Clearing happens within
                        one event; eventId means "this reshuffle market", not "what I want"
V3  ticket status       no ticket redeemed
V4  conservation        every offered ticket appears in exactly one leg's receives;
                        every received ticket appears in exactly one intent's offered
V5  per-participant     for each leg, the received bundle satisfies that participant's
                        eventId, sessionMask, sectionMask, exactCount,
                        mustShareSession, mustShareSection, mustBeAdjacent
V6  per-participant     netPayment within that participant's maxNetPay
V7  payment balance     sum of all netPayment == 0
V8  transfer capacity   ownerNet = SIGNED sum of that owner's legs. Only net debtors are
                        checked, against ownerNet — an owner with +80 and -30 needs 50, not
                        80. Per-leg checks would pass two +80 debits against a 100 balance.
                        Routing: pull every debit to the contract, then push every credit
```

Then and only then, and **in this order**:

```
1  mark every intent LIVE -> SETTLED             ← effects
2  execute USDC transfers                         ← interactions
3  Escrow.releaseBatch — clear depositor, then     ← interactions
   safeTransferFrom
4  emit Settled
```

Effects before interactions. `safeTransferFrom` calls into the recipient, so transferring a
ticket while its intent is still `LIVE` opens a reentrant window against stale state. Marking
first is safe because a revert anywhere in steps 2–3 rolls the `SETTLED` writes back with it —
there is no state where an intent is marked settled but the transfers did not occur.

### Notes on individual checks

**V4 — conservation.** Sort both id arrays in memory and compare, or do a bounded O(n²) duplicate check at demo scale. Solidity has no memory mapping, so *scratch map* is not an implementable instruction. An unbalanced set must
revert, never silently mint or burn entitlement.

**V5 — the check that carries the product.** Masks make session and section a single `&`.
Cohesion is a first-element comparison across the bundle. Adjacency sorts seats and verifies a
consecutive run. Do not loop over arrays where a bitmap works.

**V7 — exact zero.** Not "approximately". Integer USDC, no rounding tolerance.

**V8 — check before transferring anything.** Failing halfway through a batch of ERC-20
transfers wastes gas and produces a confusing revert.

### Named errors

```solidity
error IntentNotLive(bytes32 intentHash);
error IntentExpired(bytes32 intentHash, uint64 deadline);
error TicketNotEscrowed(uint256 tokenId, address expectedOwner);
error TicketRedeemed(uint256 tokenId);
error ConservationViolated();
error SessionNotAccepted(bytes32 intentHash, uint16 sessionId);
error SectionNotAccepted(bytes32 intentHash, uint16 sectionId);
error CountMismatch(bytes32 intentHash, uint8 expected, uint8 actual);
error NotSameSession(bytes32 intentHash);
error NotSameSection(bytes32 intentHash);
error SeatsNotAdjacent(bytes32 intentHash);
error BudgetExceeded(bytes32 intentHash, int256 limit, int256 actual);
error PaymentImbalance(int256 total);
error InsufficientPaymentCapacity(address payer, uint256 required);
```

Every rejection in the demo must name the failing condition. `SeatsNotAdjacent` on screen is
proof that adjacency is enforced on-chain; a generic revert proves nothing.

---

## 6. Solver

Off-chain, TypeScript. Reads the intent pool, searches, simulates, submits.

```
1  fetch live intents from the subgraph
2  verify freshness against chain state — the indexer lags
3  search for a valid reshuffle within budget
4  rank by the published rule
5  eth_call simulate
6  submit propose+execute in one transaction
```

**Search.** Combinatorial exchange. Bounded exhaustive search at demo scale. Publish the
bound: participant cap, candidate cap, timeout. Measure actual runtime and candidate counts
and report those numbers, not estimates.

**Ranking (published, deterministic, reproducible).** Minimise gross cash moved — `sum of max(netPayment, 0)` across all legs, since V7 forces net total to zero for every valid candidate; ties break
toward fewer participants, then toward the lexicographically smallest ordered set of intent
hashes. This rule is a choice, not an optimality proof.

The last tie-break is deliberately a hash comparison and not gas. The solver must be
deterministic given the same inputs, and gas estimation is neither stable nor reliable on Arc.
Measure gas and report it; do not rank on it.

**The output must be inspectable** — this doubles as The Graph evidence:

```
subgraph endpoint, block number
intents considered
candidates found
candidates excluded, each with the failing condition
chosen candidate and why
simulation result
transaction hash
```

---

## 7. Subgraph

Entities: `Ticket`, `Intent`, `EscrowPosition`, `Settlement`.

Events: `TicketMinted`, `TicketEscrowed`, `TicketWithdrawn`, `TicketRedeemed`,
`IntentCommitted`, `IntentRevoked`, `Settled`.

Deployed to Subgraph Studio, queried with an API key. **Mocked, local-only or static data is
disqualified**, which means contracts must be deployed and real transactions executed before
the subgraph has anything to index.

**Boundary, stated in the README:** the subgraph is discovery. Chain state at execution is
authoritative, and the contract re-validates everything, so a stale recommendation cannot
cause a bad settlement. The Graph is not the only technically possible discovery mechanism —
RPC logs could be indexed otherwise. This implementation relies on it.

---

## 8. Agent

Only if The Graph is targeted.

Natural language → structured conditions the user confirms → live query → solver → explanation.

```
User    "we need to sit together, Saturday or Sunday, at most 50"
Agent   eventId 1, sessions {Sat, Sun}, exactCount 2,
        mustShareSection, mustBeAdjacent, maxNetPay 50
        ← user confirms before signing
Agent   "Two candidates. Saturday at 45 — excluded, seats not adjacent.
         Sunday at 20 — valid. Proceeding with Sunday."
```

The agent interprets, queries, calls tools and explains. It does not decide validity and
cannot widen a budget. The solver proposes; the contract verifies.

**The scene that proves the integration:** change the budget from 50 to 15, the agent
re-queries live data, the previous candidate is excluded, and it reports a different answer or
none. This is the difference between using indexed data and narrating a fixture.

---

## 9. Tests

### Must exist — these are the product

| Test | Proves |
|---|---|
| `three_way_reshuffle_succeeds` | Base path |
| `rejects_non_adjacent_when_required` | **Adjacency is enforced on-chain, not just in the UI** |
| `rejects_split_section_bundle` | Cohesion is enforced |
| `rejects_over_budget` | Budget is enforced |
| `rejects_wrong_count` | Exactly, not at least |
| `rejects_unbalanced_payment` | V7 |
| `rejects_expired_intent` | V1 |
| `rejects_revoked_intent` | V1 |
| `rejects_withdrawn_ticket` | V2 |
| `rejects_redeemed_ticket` | V3 |
| `rejects_conservation_violation
rejects_id_at_or_above_mask_width
pure_seller_with_exact_count_zero_settles
rejects_adjacency_flag_with_exact_count_below_two
rejects_deposit_of_redeemed_ticket
rejects_withdraw_by_non_depositor
rejects_duplicate_nonce_at_commit
commit_by_third_party_relay_succeeds
rejects_revoke_by_non_owner
owner_net_uses_signed_sum_not_positive_sum
hash_intent_matches_typescript_vector` | V4 |
| `settles_without_participant_online` | G3 — the pre-commitment claim |
| `redeemed_by_new_holder_only` | G6 |
| `buyer_seller_chain_completes` | Scene 2 |

`rejects_non_adjacent_when_required` is the load-bearing one. It is the difference between a
product that guarantees adjacency and a UI that mentions it.

### Measure, do not estimate

Run `forge test --gas-report`. Record real numbers: gas by participant count, ticket count,
constraint count. Publish the table. Every performance figure in any document must come from
this table.

---

## 10. Build order

| # | Work | Depends on | Cut? |
|---|---|---|---|
| 1 | TicketNFT, Escrow, IntentRegistry | — | Never |
| 2 | Settlement V1–V8 + the test table | 1 | Never |
| 3 | Solver + published ranking rule | 2 | Never |
| 4 | Arc Testnet deploy, ≥10 real settlements | 2 | Never |
| 5 | Frontend, three scenes, two embedded proofs | 3, 4 | Never |
| 6 | Minimal redemption | 4 | Avoid cutting — without it, judges see an NFT swap |
| 7 | Subgraph | 4 | Cutting drops The Graph |
| 8 | Agent | 7 | Cutting drops The Graph's AI track |

**1–5 is the minimum viable submission**, targeting Arc alone. That version is complete.

**Cut order if time runs short: 8, then 7, then 6.** Cut The Graph before cutting redemption —
a complete single-sponsor project beats a fragmented two-sponsor one.

**Checkpoint.** If the constraint validation in item 2 is not green by the end of day three,
the four load-bearing guarantees will not all land. That is the point to reassess, and it is
observable rather than a feeling.

---

## 11. Open items — resolve before or during day one

1. ~~Submission deadline~~ — settled: **Sunday 13 September, 12:00 EDT**. The 16th is the event close and Arc's public mainnet launch.
2. Arc Testnet RPC, chainId, USDC address, faucet.
3. What Arc accepts as "deployment-ready" — ask in their Discord channel. It decides whether
   the Launch prize is a target.
4. Whether one project may receive multiple Arc bounties.
5. Gas cost of settlement at realistic participant counts — measure at item 2, not before.

Items 3 and 4 are a Discord message. Asking also puts the project in front of Arc before
judging, which the ETHGlobal judge writeup identifies as one of the few things that
demonstrably helps.
