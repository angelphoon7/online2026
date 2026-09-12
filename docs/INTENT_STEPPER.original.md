# Task: restructure the intent-creation flow into a single-column stepper

## Context

The event page currently renders three panels at once in a two-column layout: `Your position`
(01 / CUSTODY) and `Find your space` (02 / SEAT GRID) on the left, `Your conditions`
(03 / AUTHORISE) on the right. The panels are numbered as a sequence but laid out so the eye has
to go down the left column, jump right, and go down again. Everything is visible at once, so a
first-time viewer does not know where to start.

Keep the existing visual language exactly as it is — the paper background, the mono numerals, the
hairline borders, the heading treatment. This is a restructure of flow and hierarchy, not a
restyle. Do not introduce new colours, fonts, shadows, or animation.

Do not change any contract, ABI, or the `Intent` struct. This task only touches the frontend.

---

## Fix these three bugs first

They are independent of the restructure and each is small.

1. **The signed sentence does not match the controls.** With `Section 0` and `Section 1`
   selected, the sentence renders `sections 0, 1, 2`. The sentence must be generated from the
   exact struct that will be signed, with no separate source of truth. Find where the sentence
   string is built and derive every clause from the same object passed to the EIP-712 signer.
   Add a test that mutates each field and asserts the sentence changes.

2. **Session and section controls are duplicated.** They appear once in `Your conditions` as
   constraints and again in `Find your space` as a browse filter. They look identical and mean
   different things. Remove them from the seat grid entirely. The seat grid renders whatever
   session and section the conditions step currently has selected.

3. **The ticket list has its own inner scrollbar.** Remove it. Render all tickets in flow. If the
   count exceeds eight, render the first eight and a `+N more` disclosure — never a nested scroll
   region.

---

## The restructure

Replace the two-column layout with **one column, one step at a time**.

Exactly three steps. Only one is expanded. A completed step collapses to a single summary row. A
step that has not been reached yet renders as a dimmed title row and is not interactive.

### Collapsed step row

A check icon, the step title, and a mono summary of what was chosen, with a `Change` button on
the right that re-expands it and collapses the others.

Example summary for step 1: `R1 S1, R1 S2 · session 0`

### Step 1 — "Tickets you're offering"

Was `Your position` / 01 / CUSTODY.

Content: the ticket list with checkboxes, custody badge, and `Withdraw` per ticket. Keep the
existing explanatory line about withdrawal being unconditional.

`Continue` is enabled once at least one ticket is ticked.

### Step 2 — "What you'll accept in return"

Was `Your conditions` / 03 / AUTHORISE.

Subtitle, verbatim:

> These are the only conditions the contract can enforce. A specific row or ticket cannot be
> required.

Controls, in this order, each on its own row with a left-aligned label of fixed width:

- **How many tickets** — stepper with `−` and `+`, mono value, hint text `exactly — not a
  minimum`. Never a range input.
- **Which nights** — session pills, multi-select.
- **Which sections** — section pills, multi-select.
- **Cohesion** — the `Same section` and `Same session` checkboxes.
- **Seats must be next to each other** — the adjacency checkbox, followed by the illustration
  below.
- **Money** — the net payment slider.
- **Valid until** — the existing datetime field.

**Adjacency illustration.** Rendered directly under the adjacency checkbox, only when it is
ticked. Two rows of six small squares each, roughly 17px, in the existing fill colours:

- Row one: squares 3 and 4 filled, consecutive. Label to the right: `accepted`.
- Row two: squares 3 and 5 filled, with a gap. Label to the right, in mono, in the error colour:
  `SeatsNotAdjacent`.

This is a static illustration, not a control. Nothing in it is clickable. Its only job is to make
the word "adjacent" legible and to teach the error name before the judge sees a real revert.

**Money slider.** Signed integer, spanning negative to positive. The readout above it reads
`I pay up to N` when positive, `I must receive at least N` when negative, and `No net payment`
at zero. Label the track at three points: the negative end, `even` at centre, the positive end.

### Step 3 — "Review and sign"

Content: the generated sentence at prose size, the metadata line beneath it, `View signed
struct`, and the `Sign and commit` button. Keep the existing note about the USDC allowance.

---

## The seat grid

It stops being a step. It was 02 / SEAT GRID; it is now a collapsed disclosure titled
`Seat map` placed **after** step 3, closed by default.

Reason: the contract cannot enforce a specific row or ticket ID, so seat selection was never a
real input. Keeping it inline implied the user was choosing seats they would receive, which is
not what gets signed.

When expanded it shows custody state across the grid — escrowed, held by you, other wallet,
unissued — for the session and section selected in step 2. Keep the existing legend and keep the
existing caption about seat numbers being consecutive because we issue the tickets.

Remove seat clicking. No selection state, no `Clear selection`.

---

## Below the stepper

Unchanged in content, but add one line under the `The intent pool` heading, verbatim:

> Nothing here can be accepted. A solver looks for a combination that satisfies every condition
> at once.

This line does real work. Without it a viewer reads the pool as a list of offers to accept, which
is the opposite of how the protocol works.

---

## Copy rules

Replace the step labels `01 / CUSTODY`, `02 / SEAT GRID`, `03 / AUTHORISE` with the plain titles
above. Keep a small mono `step N of 3` marker on the expanded step.

Put every user-facing string that makes a claim about behaviour into a single constants module
and import it. Do not inline or paraphrase these anywhere:

```
EMPTY_RESULT   "No solution found within the search bound"
POOL_NOTE      "Nothing here can be accepted. A solver looks for a combination that satisfies
                every condition at once."
ESCROW_NOTE    "Withdrawal is unconditional until settlement."
ENFORCEABLE    "These are the only conditions the contract can enforce. A specific row or ticket
                cannot be required."
ADJACENCY_NOTE "Seat numbers are consecutive integers within one session, section and row because
                we issue the tickets. This does not generalise to arbitrary venues."
```

These words must not appear in any string, label, tooltip or alt text: *optimal*, *best price*,
*guaranteed*, *no risk*, *impossible*, *locked*, *no solution exists*, *listings*, *for sale*,
*buy now*.

---

## Wallet connection

Unchanged if already implemented this way; make it so if not.

The page is fully readable with no wallet — ticket list, intent pool, seat map and past
settlements all render from chain reads. No connect gate, no modal on load.

The connect prompt fires only on an action needing a signature: `Sign and commit`, `Deposit`,
`Withdraw`, `Propose and settle`. Clicking any of these with no wallet connected opens the
connection inline and then continues into the original action without a second click. If the
chain is not Arc testnet, prompt the switch inside that same flow.

---

## Read layer

While you are in here: move every chain read behind a single module exposing `getIntentPool()`,
`getTicketsFor(address)`, `getSettlements()` and `getSeatCustody(session, section)`. Components
call that module, never viem directly.

A subgraph will replace the implementation later. Do not build it now — just make the seam exist.

---

## Acceptance

- Landing on the page, exactly one step is expanded and the other two are collapsed.
- Completing a step collapses it to a summary row and expands the next.
- Every clause in the signed sentence changes when its corresponding control changes, verified by
  a test.
- Session and section controls exist in exactly one place in the codebase.
- No nested scroll regions anywhere on the page.
- The seat map is closed on load and contains no interactive elements.
- The adjacency illustration appears only when the adjacency checkbox is ticked.
- No file outside the constants module contains any of the five claim strings.