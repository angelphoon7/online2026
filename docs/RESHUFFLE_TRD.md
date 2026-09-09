# RESHUFFLE — Technical Requirements

Companion to `RESHUFFLE_PRD.md`. Every guarantee in the PRD must appear here as a checked
condition, or the guarantee is removed from the PRD. **No promise without a check.**

| | |
|---|---|
| Version | 1.0 |
| Chain | Arc Testnet — EVM, USDC as native gas |
| Language | Solidity, Foundry |
| Backend | TypeScript solver — Arc explicitly requires a working backend |

---

## 1. System

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend — swapper / buyer / seller, single-operator mode    │
└────────────────────────┬────────────────────────────────────┘
                         │ one EIP-712 signature per intent
┌────────────────────────┼────────────────────────────────────┐
│ Arc Testnet                                                 │
│   TicketNFT        packed metadata, redemption               │
│   Escrow           custody, unconditional withdrawal         │
│   IntentRegistry   signed conditions                         │
│   Settlement       validate + atomic execute                 │
└────────────────────────┬────────────────────────────────────┘
                         │ events
┌────────────────────────┼────────────────────────────────────┐
│ Subgraph — reconstructs the live intent pool                 │
└────────────────────────┬────────────────────────────────────┘
                         │ GraphQL
┌────────────────────────┼────────────────────────────────────┐
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
function deposit(uint256[] calldata ids) external;
function withdraw(uint256[] calldata ids) external;   // unconditional, immediate
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
    uint16   sessionMask;       // acceptable sessions, bit per session
    uint16   sectionMask;       // acceptable sections, bit per section
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

`exactCount`, not `minCount` — a user asking for two seats must not receive three. A minimum
cannot express "exactly".

`mustShareSection` is separate from `sectionMask` — "Floor or Tier 1 are both acceptable" is
not the same statement as "both my tickets must be in the same one". Two mask bits set does
not imply cohesion.

`mustBeAdjacent` — verified as: same section, same row, seats form a consecutive run. Only
meaningful because seat numbering is ours.

`maxNetPay` signed — one field covers both directions. Positive is a debit ceiling, negative
is a credit floor.

**Commitment and revocation.**

```solidity
function commit(Intent calldata i, bytes calldata sig) external;   // stores hash + owner
function revoke(bytes32 intentHash) external;                      // owner only
mapping(bytes32 => uint8) public state;                            // 0 none, 1 live, 2 revoked, 3 settled
```

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
    address   participant;
    uint256[] receives;      // ticket ids this participant receives
    int256    netPayment;    // > 0 pays, < 0 receives
}

function settle(Intent[] calldata intents, Leg[] calldata legs) external;
```

### Validation, in order

```
V1  intent validity     state == live, deadline not passed, signature recovers to owner
V2  escrow ownership    every offered ticket escrowed by that intent's owner
V3  ticket status       no ticket redeemed
V4  conservation        every offered ticket appears in exactly one leg's receives;
                        every received ticket appears in exactly one intent's offered
V5  per-participant     for each leg, the received bundle satisfies that participant's
                        eventId, sessionMask, sectionMask, exactCount,
                        mustShareSession, mustShareSection, mustBeAdjacent
V6  per-participant     netPayment within that participant's maxNetPay
V7  payment balance     sum of all netPayment == 0
V8  transfer capacity   each payer's USDC balance and allowance cover their netPayment
```

Then and only then: transfer tickets, transfer USDC, mark intents settled, emit.

### Notes on individual checks

**V4 — conservation.** Use a scratch mapping or a sorted-array pass. An unbalanced set must
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

**Ranking (published, deterministic, reproducible).** Minimise total net payment; ties break
toward fewer participants, then lowest gas. This rule is a choice, not an optimality proof.

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

Natural language — structured conditions the user confirms — live query — solver — explanation.

```
User    "we need to sit together, Saturday or Sunday, at most 50"
Agent   eventId 1, sessions {Sat, Sun}, exactCount 2,
        mustShareSection, mustBeAdjacent, maxNetPay 50
        → user confirms before signing
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
| `rejects_conservation_violation` | V4 |
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

1. Submission deadline. Sources conflict between 13 and 16 September. Check the event page.
2. Arc Testnet RPC, chainId, USDC address, faucet.
3. What Arc accepts as "deployment-ready" — ask in their Discord channel. It decides whether
   the Launch prize is a target.
4. Whether one project may receive multiple Arc bounties.
5. Gas cost of settlement at realistic participant counts — measure at item 2, not before.

Items 3 and 4 are a Discord message. Asking also puts the project in front of Arc before
judging, which the ETHGlobal judge writeup identifies as one of the few things that
demonstrably helps.
