# RESHUFFLE — UI flow and control specification

This supersedes any earlier page-structure notes. Build from this file.

Governing rule: **no promise without a check.** Every control here maps to a contract call or a
chain read. Nothing on screen is computed in the frontend and presented as a guarantee.

---

## 1. Shape

**One page. One route.** `/`

Everything is scroll sections on a single page. No router, no navigation, no page transitions.
Clicking a concert poster expands the workspace *in place* below it and smooth-scrolls to it —
it does not navigate. A demo that never changes URL never risks a blank frame on load.

One secondary surface: the settlement receipt, which opens as an in-page panel, not a route.

Sections top to bottom:

```
A  Hero — the thesis
B  Concert posters — event picker
C  Workspace — expands under the chosen poster   ← the product
D  Receipt — appears after settlement
```

---

## 2. Section A — Hero

One screen height. Carries the argument so the poster grid below cannot be misread.

Headline states the mechanism, not a slogan: *You sign the outcome you'll accept, not the trade
you're offered.*

Two lines under it: what breaks today (sell first, then hope you can rebuy), and what replaces it
(everyone's conditions checked in one transaction, or nothing moves).

**Controls: 2**

| Control | Function |
|---|---|
| See it settle | smooth-scroll to section B |
| Contracts on Arc | opens Arc explorer at the deployed `Settlement` address |

The second button matters more than it looks. A live explorer link above the fold, before any
demo, tells a judge this is deployed before they've watched anything.

---

## 3. Section B — Concert posters

Three poster cards in a row. This is an **event picker**, not a marketplace.

Each card shows: artist, venue, three night dates, and one status line.

That status line is load-bearing. It reads **`7 live intents`** — never "7 tickets for sale",
never "12 listings", never a price. Nothing here is browsable or acceptable. The moment a card
shows a price or a "Buy" affordance the whole thesis is misread.

Card 1 is the demo event and has live intents. Cards 2 and 3 show `no live intents` and are
visibly inert — not clickable, reduced contrast. Do not fake depth; two dead cards are honest
scenery, three fake-live ones invite a click that goes nowhere.

**Controls: 1**

| Control | Function |
|---|---|
| Poster card (card 1 only) | expands section C in place, scrolls to it |

---

## 4. Section C — Workspace

The product. Four panels in a two-column layout.

### C1 · Your position (top-left)

Lists tickets held by the connected wallet, each with session, row, seat, tier price, and state
badge: `wallet`, `escrowed`, or `committed`.

With no wallet connected this panel shows the demo participants' positions read from chain, with
a quiet line: *connect to act as yourself*. It is never an empty gate.

| Control | Function | Tx |
|---|---|---|
| Deposit | `Escrow.deposit(tokenId)` — requires prior `approve` on `TicketNFT` | yes |
| Withdraw | `Escrow.withdraw(tokenId)` — unconditional while unsettled | yes |
| Approve tickets | `TicketNFT.setApprovalForAll(escrow, true)` — appears only when not yet approved | yes |

Keep `Withdraw` visible and enabled at all times before settlement. It is the proof that escrow
is not a lock-up, and a judge clicking it and watching a ticket come back is worth more than a
sentence claiming the same.

### C2 · Seat grid (bottom-left)

One section, three rows, twelve seats each. Rows carry tier prices: row 3 = 600, row 7 = 400,
row 11 = 200 USDC.

Not a venue map. Twelve seats per row is enough to make adjacency visible and small enough to
read at video resolution.

Seat states by fill: `available`, `held by you`, `held by another wallet`, `selected`.

**Selection drives the intent.** When two selected seats are not consecutive within a row, show
an inline note under the grid — *these seats are not adjacent; a proposal giving you these will
revert* — and keep the sign button enabled. Do not block the signature. Signing an intent for
non-adjacent seats is legal; what fails is a *proposal* that violates a signed adjacency
requirement. Blocking it in the UI teaches the wrong model and destroys your best judge
interaction.

| Control | Function | Tx |
|---|---|---|
| Seat cell | toggles selection, writes `sectionMask` / row target | no |
| Clear selection | resets to none | no |

### C3 · Intent builder (top-right)

| Control | Function | Tx |
|---|---|---|
| − / + count | sets `exactCount`, stepped integer, min 1 | no |
| Session chips (FRI / SAT / SUN) | sets `sessionMask` bits, multi-select | no |
| Tier toggles (600 / 400 / 200) | sets acceptable tiers | no |
| Same section | sets `mustShareSection` | no |
| Adjacent seats | sets `mustBeAdjacent` | no |
| Net payment slider | sets `maxNetPay`, integer USDC, **signed** — negative means you require payment | no |
| View signed struct | opens raw EIP-712 typed data and domain | no |
| **Sign and commit** | wallet signs, then `IntentRegistry.commit(intent, sig)` | yes |
| Revoke my intent | `IntentRegistry.revoke(hash)`, owner-only | yes |

The slider crossing zero is the upgrade/downgrade mechanic. Above zero the label reads *I pay up
to N*; below zero *I must receive at least N*. Same field, same signed integer.

**The sentence block sits directly under these controls** and regenerates on every change:

> Take my 2 seats in row 7 only if I simultaneously receive exactly 2 adjacent seats in row 3,
> and I pay no more than 250 USDC net.

Rendered from the struct, not a summary. A field with no clause in the sentence is a field the
user did not knowingly sign.

### C4 · Intent pool and solver (bottom-right)

Live list of committed intents read from chain. Each row: participant, one-line condition, net
USDC position, and a link to the `commit` transaction.

Every row is a chain read with a clickable tx. That is what makes this pool different from a
listings feed — a judge can verify any row.

| Control | Function | Tx |
|---|---|---|
| Run solver | POST to solver; returns candidates, chosen allocation, ranking evidence | no |
| Include / exclude participant | checkbox per row; re-run to see the result change | no |
| **Propose and settle** | `Settlement.settle(proposal)` — simulate and execute in one call | yes |
| Submit dishonest proposal ▾ | 3 items: `Siphon 20 USDC`, `Non-adjacent seats`, `Wrong count` | yes |
| Reset demo | re-seeds fixtures via script endpoint | yes |
| Explorer link per intent | opens the `commit` tx | no |

`Propose and settle` is one button. Never split into simulate-then-execute: that opens a window
in which a participant can withdraw, and puts a claim on screen the architecture does not make.

After a solver run, show three things and no more: the shape (`3-party cycle` or `open chain — no
cycle`), the candidate count within the search budget, and the net USDC column with its sum.

---

## 5. Settlement — the sequence on screen

When `Propose and settle` is pressed:

1. Button enters pending, showing the tx hash immediately. **No spinner without a hash.**
2. The check list renders and resolves top to bottom, roughly 120 ms per row: struct hash,
   signatures, intents live, tickets escrowed, conservation, counts and masks, cohesion,
   adjacency, budgets and payment capacity. This is the only animation in the product — it is
   validation order made visible.
3. On success the row set completes and section D appears.
4. On revert, the check list halts at the failing row and the named error renders below it.

**The named error is the largest text on screen when it appears.** Display size, mono,
unabbreviated, with arguments: `SeatsNotAdjacent(7, 9)`, `PaymentNotConserved(20)`. Not a toast,
not red body copy, not truncated. Beside it, a link to the reverted transaction on Arc explorer.

Each of the three dishonest proposals must produce a *different* named error. Three distinct
errors is three times the evidence.

---

## 6. Section D — Receipt

Appears in place below the workspace after any successful settlement. One panel.

Contents: transaction hash with explorer link; a line reading `6 ticket transfers · 3 USDC
payments · 1 transaction`; a before/after row per participant; the net USDC column with `Σ = 0`
shown explicitly; and the settling address labelled *submitted by an independent solver — no
participant sent this transaction*.

That last label is the offline proof compressed to one line, free, using data already in the tx.

| Control | Function | Tx |
|---|---|---|
| View on Arc explorer | opens the settlement tx | no |
| Copy hash | clipboard | no |
| Redeem | `TicketNFT.redeem(tokenId)` → `USED` badge | yes |

`Redeem` is what makes this a ticketing application rather than an NFT swap. One button, one
state change, worth the twenty minutes.

---

## 7. Wallet connection

Deferred, never upfront. Paste this rule into the build task verbatim:

```
The page is fully readable with no wallet. Seat grid, intent pool, past settlements and solver
candidates all render from public chain reads. There is no connect gate, no modal on load, no
"connect to continue" empty state.

The connect prompt fires only on an action needing a signature. Exactly four: Sign and commit,
Deposit, Withdraw, Propose and settle. Clicking any of these with no wallet connected opens the
connection inline and then continues into the original action without a second click — connect
and act are one gesture.

If the chain is not Arc testnet, prompt the switch inside that same flow. Never block beforehand.

Header shows address and USDC balance once connected, and nothing before.
```

---

## 8. States that must exist

Half-built demos die on these, so specify them now:

- **No wallet** — everything readable, action buttons show connect on click.
- **Wrong network** — header badge turns to a warning with a switch action; reads still work.
- **Empty solver result** — `No solution found within the search bound`. Exact string, always.
  Never "no solution exists".
- **Solver unreachable** — say the solver is unreachable and leave chain reads working. Do not
  fall back to a cached allocation and present it as fresh.
- **Insufficient USDC allowance** — surface it before the settle attempt, since the contract
  checks payment capacity before any transfer.
- **Tx rejected in wallet** — return to idle cleanly, no stuck pending state.

---

## 9. Copy constants

One module, imported everywhere. A paraphrase in a component is how an overclaim ships.

```
EMPTY_RESULT   "No solution found within the search bound"
RANKING_RULE   "Lowest total net payment among candidates found within the search budget"
POOL_LABEL     "live intents"
ESCROW_NOTE    "Withdrawal is unconditional until settlement"
SOLVER_NOTE    "Submitted by an independent solver — no participant sent this transaction"
ADJACENCY_NOTE "Seat numbers are consecutive integers within a row because we issue the tickets.
                This does not generalise to arbitrary venues."
```

Banned from every string, label, tooltip and alt text: *optimal*, *best price*, *guaranteed*,
*no risk*, *impossible*, *locked*, *no solution exists*, *listings*, *for sale*, *buy now*.

---

## 10. Visual rules

Colour carries exactly two meanings and is used nowhere else: one for a check that passed
on-chain, one for a named revert. Everything else is neutral. Participants are told apart by name
and position, not by six hues.

Mono for every number, hash, seat, ticket id and error name. Sans for prose. The split means
*this came from the chain* versus *this is a human explaining* — hold it consistently and a judge
can tell verifiable from narrative without being told.

One animation: the check list resolving. No hover lifts, no scroll fades, no number count-ups. A
count-up on a settlement figure implies the number was computed in the frontend.

---

## 11. Build order

Dependencies, not preferences. If time runs out at step 6 you still have an honest demo.

1. Chain reads — escrow contents, intent pool, receipts. Nothing demos before this.
2. Seat grid rendering from chain state.
3. Intent builder through `Sign and commit`.
4. Intent pool with per-row explorer links.
5. Check list with named-error display. **Build this before the cycle visualisation.**
6. `Propose and settle`, single transaction.
7. Dishonest proposal dropdown, all three variants.
8. Receipt panel and `Redeem`.
9. Hero and poster section.
10. Deposit / withdraw controls.

Hero and posters are step 9 deliberately. They are the first thing a judge sees and the last
thing you should build — they carry no risk and can be finished in an hour.