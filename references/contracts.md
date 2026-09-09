# Contracts

Data structures, validation order, errors. Authoritative source is `docs/RESHUFFLE_TRD.md`.

## TicketNFT

```solidity
struct TicketMeta {
    uint32 eventId;
    uint16 sessionId;
    uint16 sectionId;
    uint16 row;
    uint16 seat;      // consecutive integers within a row, by construction
    uint8  status;    // 0 active, 1 redeemed
}
mapping(uint256 => TicketMeta) public meta;
```

One slot per ticket, one `SLOAD` per validation read.

`seat` being consecutive within a row is what makes adjacency checkable. It holds only because
we issue the tickets. Document that; it does not generalise.

Only contracts in `registeredIssuers` may mint — centralised, and stated as such in the README.
`redeem(tokenId)` is caller-must-hold, sets status permanently, and a redeemed ticket can never
re-enter escrow.

## Escrow

```solidity
function deposit(uint256[] calldata ids) external;
function withdraw(uint256[] calldata ids) external;   // unconditional
mapping(uint256 => address) public depositor;
```

No lock-up, no delay. This bounds the grief surface: the worst a participant can do is
invalidate a proposal, and the proposer should have simulated first.

Withdrawal does not revoke intents referencing the ticket. V2 catches it at settlement.
Revocation is separate and explicit.

## Intent

```solidity
struct Intent {
    address   owner;
    uint256[] offered;
    uint32    eventId;
    uint16    sessionMask;
    uint16    sectionMask;
    uint8     exactCount;
    bool      mustShareSession;
    bool      mustShareSection;
    bool      mustBeAdjacent;
    int256    maxNetPay;        // >0 pay at most, <0 receive at least
    uint64    deadline;
    uint256   nonce;
}
```

`exactCount` — exactly, never a minimum. Asking for two seats must not yield three.

`mustShareSection` is not implied by `sectionMask`. "Floor or Tier 1 are both acceptable" and
"both my tickets must be in the same one" are different statements. Same for sessions.

`maxNetPay` signed — one field, both directions.

## IntentRegistry

```solidity
function commit(Intent calldata i, bytes calldata sig) external;
function revoke(bytes32 intentHash) external;         // owner only
mapping(bytes32 => uint8) public state;               // 0 none, 1 live, 2 revoked, 3 settled
```

EIP-712 domain includes `chainId` and `verifyingContract`. Redeploying or changing networks
invalidates every committed intent and requires reconfiguring the frontend domain. Correctness,
not configuration.

Nonces are per-owner, single-use.

## Settlement

```solidity
struct Leg {
    bytes32   intentHash;
    address   participant;
    uint256[] receives;
    int256    netPayment;      // >0 pays, <0 receives
}

function settle(Intent[] calldata intents, Leg[] calldata legs) external;
```

### Validation order

Every step unconditional. Checks, then effects, then interactions.

**V1 — intent validity.** `state == live`, `block.timestamp <= deadline`, signature recovers to
`owner`.

**V2 — escrow ownership.** Every ticket in `offered` is escrowed by that intent's owner *now*.
Catches withdrawal after commitment.

**V3 — status.** No ticket redeemed.

**V4 — conservation.** Exact bijection: every offered ticket appears in exactly one leg's
`receives`; every received ticket appears in exactly one intent's `offered`. A scratch mapping
or a sorted pass. Unbalanced sets revert — never silently create or destroy entitlement.

**V5 — per-participant constraints.** For each leg, the received bundle satisfies that
participant's:

```
eventId          every ticket
sessionMask      sessionId bit set
sectionMask      sectionId bit set
exactCount       receives.length == exactCount
mustShareSession all share sessionId
mustShareSection all share sectionId
mustBeAdjacent   same section, same row, seats form a consecutive run
```

This check carries the product. Bitmaps, not loops.

**V6 — budget.** `netPayment <= maxNetPay` for positive, `netPayment >= maxNetPay` for
negative.

**V7 — payment balance.** Sum of all `netPayment` is exactly zero. Integer USDC, no tolerance.

**V8 — capacity.** Each payer's USDC balance and allowance cover their leg, checked before any
transfer. Approval is a spending allowance, not a reservation.

### Effects

Transfer tickets from escrow to recipients. Transfer USDC between legs. Mark intents settled.
Emit `Settled` with enough detail for the subgraph.

### Errors

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

Each rejection in the demo names its condition. `SeatsNotAdjacent` on screen proves adjacency
is enforced on-chain.

## Gas

Publish a table from `forge test --gas-report`: gas by participant count, ticket count,
constraint count. No figure appears in any document unless it came from that table.
