# Single-page UI

The current product lives at `/`. The former demo and workspace URLs redirect there. Hero, event picker, workspace and receipts share the page; opening a poster or receipt does not change the URL. Historical proof APIs remain available.

Public positions and commitments for every deployed event preload as soon as the page mounts, while the visitor reads the hero. The active poster shows loading status until the snapshot is ready. Its workspace is prepared in advance and opening it reuses that snapshot; no additional read starts on poster click. Overlapping background refreshes share the same pending request. Undeployed placeholder events remain inactive.

The public seat grid, intent pool, past settlements and solver candidates are readable without a wallet. There is no page-wide connection gate or modal on load. The offering step asks the visitor to click **Connect wallet to see my tickets** before showing personal inventory. This read-only connection neither signs a transaction nor switches networks.

Signature actions such as Sign and commit, Deposit, Withdraw, Propose and settle, and Get free tickets connect inline if necessary and continue the requested action. If the connected chain is not Arc Testnet, they prompt the switch in the same flow.

Header shows address and USDC balance once connected, and nothing before.

Additional controls specified for connected users—ticket approval, revocation, redemption and the operator reset—are shown only for an applicable connected account. Dishonest submission follows the proposer connection flow.

## Mapping to deployed behavior

| Surface | Source or action |
| --- | --- |
| Positions and grid | Ticket metadata, `ownerOf`, and escrow `depositor`, read at one block |
| Poster count and pool | `IntentCommitted` logs, current registry state, and expiry at that block |
| Pool explorer links | Actual commit transaction hashes from those logs |
| Signed data | Shared `intentTypedData()` used by the raw preview and wallet signer |
| Deposit / withdraw | NFT approval if needed, then custody transaction; receipt awaited |
| Sign and commit | Fresh nonce read for the connected account, payment allowance if needed, EIP-712 signature, registry commit |
| Solver | Existing server solver, fresh chain snapshot and simulation; no saved allocation fallback |
| Propose and settle | Fresh solver call, final `eth_call`, wallet submission with explicit gas, receipt verification |
| Receipt | Decoded settlement calldata, transaction sender, receipt status, NFT recipients and USDC transfer logs |
| Redeem | Current-holder call to `TicketNFT.redeem`; confirmed receipt followed by refreshed status |

Copy constants live in `lib/ui-copy.ts`. The site uses neutral colors except for confirmed successful checks and named rejections. Validation rows animate only once receipt/rejection evidence exists. Reduced-motion preferences suppress smooth scrolling through browser styling; there are no decorative entrance animations.

## Corrections required by the deployed contracts

The pasted visual specification contains several details that cannot be represented as deployed guarantees:

- There is no signed row target or requested receiving ticket-ID field. The two-step builder sets session and section masks in one place. The closed, read-only seat map follows those masks; it does not promise a particular row. Count, masks, cohesion and adjacency remain independently editable signed conditions.
- Tickets have no price field and the protocol does not assign ticket valuations. The interface shows actual section IDs, with explicitly labelled demo reference prices used to suggest a signed payment limit. These are not on-chain valuations or an enforced clearing price. Rows and sessions come from issued metadata instead of inventing a three-night venue. Empty grid positions are marked unissued. The map has no seat selection. Event names are editorial demo labels, with undisclosed venue/date information left undisclosed.
- The objective is **gross USDC moved**, not total net payment. The latter is zero for every valid settlement. Shape labels are derived from actual ticket ownership edges; a generic reshuffle is not automatically called a cycle.
- Signature authentication happened in `commit`. `settle` does not accept signatures. Validation rows use the deployed V0–V8 order, including ticket status, conservation and payment balance; the per-participant V5 checks are grouped because the contract executes them per participant.
- Simulation and submission are separate RPC calls inside one UI action. They cannot eliminate the state-change window. A hash appears as soon as the wallet returns it; before that the UI describes wallet/preflight activity without inventing a hash or a check result.
- Receipts do not contain revert bytes. A reverted transaction is replayed at the preceding block to obtain a named error, and that limitation is displayed. Unknown errors are not assigned invented names. A validation animation is an explanation of order, not an EVM trace.
- Actual error signatures are `SeatsNotAdjacent(bytes32)`, `CountMismatch(bytes32,uint8,uint256)` and `PaymentImbalance(int256)`. USDC error arguments retain the contract's raw six-decimal units.
- Receipt transfer counts are counted, not fixed at six/three. The independent-proposer sentence is conditional on the transaction sender differing from every participant. It does not by itself prove browser closure.

## Dishonest proposals

All three mutations preserve the committed intent structs. An extra 20 USDC credit violates V7; moving one ticket to another leg preserves conservation but violates exact count; exchanging seats between two adjacent bundles violates adjacency. The adjacency control uses the separate rejection-demo intent hashes, reruns the solver and simulates the mutation against current state. If the intended error cannot be isolated, the app explains that and does not submit a different attack under the wrong label.

The dropdown explains that an intentionally reverted transaction spends proposer gas. Test runs during this implementation only used `eth_call`; no attack was broadcast.

## Operator reset

`/api/demo/reset` is available only on a loopback development server. It requires a short-lived, single-use signature by the configured deployment operator and an exact same-origin POST. It starts the existing fixed `scripts/prepare-demo.mjs` command, returns no keys or script logs, and prevents concurrent runs. The script reuses a ready round when possible; otherwise it prepares a new one. It cannot recover tickets that participants have redeemed or transferred away. Hosted production reset is disabled.

The reset button appears only for the connected operator. Its signature describes the potential test-USDC spending and intent changes. No reset was executed while implementing the UI.

## Public discovery and validation

`/api/market` reads mutable values at a single block, spaces RPC requests, and reuses previously discovered events only after checking the previous boundary block hash. A snapshot is reused for up to 30 seconds; the UI displays its source block, and writes are separately revalidated. Discovery is bounded to 1,000 issued tickets and 2,000,000 blocks since deployment. A larger market needs indexed discovery. The shared Arc RPC can rate-limit initial reads; read failures are separate from wallet and solver states.

Validation commands:

```powershell
npm.cmd run build
$env:WALLET_TEST_URL = 'http://localhost:3101'
node scripts/test-market-browser.mjs
node scripts/test-market-rejections.mjs
```

Browser tests use explicit fixtures and a cancelling mock wallet, including desktop/mobile layout, no initial connection, step progression, draft persistence, read-only map behavior and review-to-wallet payload equality, all four deferred actions, cancellation, solver outage and inline receipt claims. The rejection integration test uses real Arc `eth_call` with the same mutation function as the UI. At block **61476648**, its valid control passed and all three mutations returned the expected distinct named errors. Real receipt checks also verified the six-ticket act-one receipt and decoded the recorded `SeatsNotAdjacent` rejection. Unauthorized reset requests were rejected with HTTP 403.


## Intent creation

### Matching after submission

On load, after a confirmed commit and after public snapshot refreshes every 30 seconds while the page is open, the frontend requests **all live Event 1 intents** through `/api/solve/pool`. The backend discovers the pool from public chain records independently of the viewing wallet or selected checkboxes. It verifies committed hashes, re-reads registry state, custody and payment capacity at one fresh block, then searches combinations of two to four participants across the pool. Four is the maximum size of a candidate settlement, not the size of the input pool. A personal request ending does not stop searches for other participants.

The search is bounded to 100 candidates and a two-second search budget, with at most 100 ticket assignments per participant subset. Evidence records whether it completed within its configured bounds or stopped on time/candidate limits; a complete bounded search is not a claim that every possible assignment was enumerated. Intents with more than four offered/received tickets are explicitly excluded with a reason. Above 256 live intents the service returns an explicit capacity error, rather than silently searching a prefix. Concurrent identical pool requests share work, and matching snapshot results are cached for up to 30 seconds. Changed commitments or snapshot blocks invalidate that cache. Simulation does not reserve state.

The frontend does not send settlement transactions automatically. A proposer uses **Propose and settle**, which re-solves and simulates only the chosen candidate's two to four intent hashes before submitting and paying gas. There is no continuously running background settlement worker in this UI.

The intent pool shows other participants' offers and signed conditions. **Check all intents** reruns automatic pool search. Selecting checkboxes switches to manual search, where **Run solver** uses the chosen two to four requests through `/api/solve`; **Resume automatic matching** returns to the whole pool. Ordinary users do not need to choose counterparties before submitting an intent.

The **Intent pool (N)** button opens the request list in a native modal dialog. The list starts closed and uses already-loaded public state; closing it does not stop automatic search. Escape and Close dismiss it, restore focus to the opener and restore background scrolling. Manual selection and revocation remain available inside it. Matching results and **Propose and settle** stay on the main page. **Past settlements** is a collapsed disclosure with readable swap labels; opening a receipt reveals its real transaction hash. Technical search evidence and ranking details are also disclosures.

Rechecking keeps the previous candidate visible and labels it as being rechecked, with settlement disabled until the new result arrives. A failed search or a no-match result clears the obsolete candidate. The open/closed choices for search evidence and match explanation persist across manual checks and automatic refreshes, including when results temporarily disappear. Refreshing results never closes the intent-pool dialog.

Participant displays use **You** or **Wallet N**, derived consistently from the addresses in the current snapshot, with real address links available in details or on the label. These are interface labels, not registered ENS names. ENS remains optional: displaying an existing primary name requires verified reverse/forward resolution, while transaction hashes remain transaction identifiers. See [ENS primary-name documentation](https://docs.ens.domains/web/reverse/). No ENS integration or registration was added for this presentation change.

To submit a match: wait for a candidate that passed simulation, inspect its participants and USDC net distribution, click **Propose and settle**, connect/switch to Arc Testnet if prompted, and confirm the settlement transaction in the proposer wallet. The proposer pays native USDC gas. The app revalidates the candidate before submission, and only a successful receipt displays settlement success. Pool checkboxes are not required, and participants do not sign their committed intents again.

The persistent **Your latest swap request** panel distinguishes searching, waiting for a match, a simulated match awaiting settlement, solver outage, revocation, expiry and confirmed settlement. A candidate must include the exact request hash and pass simulation before it is called a match; only registry state `SETTLED` produces **Swap confirmed**. Existing transaction receipt panels continue to require a successful receipt. Waiting is not a claim that no possible match exists. Reopening the page with the same wallet restores the latest request from public chain state; closing it stops frontend retries while the on-chain intent remains available to other proposers.

`node scripts/test-matching-status.mjs` checks request selection and status rules. The mock-wallet browser suite covers automatic search after commit, retry ticks, manual mode, unrelated candidates, no-match results, failed simulation and terminal chain states without broadcasting real transactions.

`node scripts/test-solve-pool.mjs` runs the backend against an isolated local RPC: the first four requests cannot match, while the fifth and sixth can. It verifies that all six reach the solver, checks fresh revocation and simulation failure, and checks explicit exclusions, empty pools, hash validation and the service capacity guard. It never broadcasts a transaction.

The single-column flow has two steps: return conditions, then offering tickets. The second step contains the selected-ticket batch deposit, payment comparison, suggested limit and an inline Review and sign block. No additional Continue click or separate review step is needed. The review updates with the selected tickets and payment limit; Sign and commit stays disabled until a wallet is connected, tickets are selected and deposited, and the chosen conditions and deadline are valid. Completed steps retain their values behind a Change button. Ticket positions show the first eight, with additional positions in a disclosure; page content has no nested scroll containers.

In **Which tickets do you have?**, select multiple tickets and use **Deposit N selected tickets**. The flow checks current custody and ownership, skips tickets already deposited by the connected owner, and calls the existing `Escrow.deposit(uint256[])` once with the remaining IDs. If operator approval is missing, its transaction confirms first and the same action proceeds to the deposit without another page click. Approval and deposit are separate wallet confirmations. Cancelling approval stops the flow; selection is retained, and confirmed deposits refresh all ticket badges together. Per-ticket deposit/withdraw controls remain available.

`lib/intent-draft.ts` initializes masks from issued metadata. `lib/ui-copy.ts` generates the review from the same Intent object handed to the signer, after resolving the connected owner and unused nonce. Adjacency, signed payment bounds and expiry remain contract inputs without any ABI changes. The sentence regression check mutates all twelve fields.

Components obtain chain data through `lib/chain-reads.ts`: `getIntentPool`, `getTicketsFor`, `getSettlements` and `getSeatCustody` query a shared snapshot, keeping a coherent source block. Receipt, balance, approval, nonce and simulation reads use the same boundary. The existing public API remains the data source; no subgraph was added.

Run `node scripts/test-intent-sentence.mjs` for sentence and mask checks. With the app at localhost:3101, run `node scripts/test-market-browser.mjs` for the mock-wallet browser checks.

## Free demo tickets

The `Get free tickets` button in step 2 connects the recipient wallet, switches to Arc Testnet if needed, and requests a personal-sign claim message. `/api/demo/tickets` verifies a fresh, single-use signature from that recipient before the registered server issuer mints two adjacent Event 1 tickets. The issuer pays minting gas. The user still needs test USDC for deposits and settlement. Tickets appear after verified mint receipts and a fresh public-state read; no intent or outcome is created automatically.

Local development enables this endpoint when the issuer key is configured. Hosted demos must explicitly set `DEMO_TICKETS_ENABLED=true`; `false` disables it anywhere. `DEMO_ISSUER_PRIVATE_KEY` can select a separate registered issuer, otherwise the server uses `PRIVATE_KEY`. These keys remain server-side. Issuance is restricted to the recorded Arc Testnet NFT deployment, one pair per recipient and twenty new recipient claims per UTC day. Each mint uses an explicit gas limit and a maximum fee budget of 0.1 test USDC.

Run this issuer on one persistent Node server (or workers sharing the same disk). Keep `.data/demo-tickets/` across restarts: it holds the claim journal and signed transactions, allowing retries to resume a partial pair without duplicates. The filesystem lock serializes issuer transactions. After a process crash, stop issuer workers and reconcile recorded transactions before removing a stale `issuer.lock`; do not delete the claim journal to clear an error. Do not run other issuer scripts concurrently with claims. An ephemeral/serverless deployment needs durable shared storage and coordinated transaction submission before enabling this endpoint.

`node scripts/test-demo-tickets.mjs` exercises the issuer and claim API against a local RPC with a throwaway key, including receipt verification, partial-claim recovery, repeat claims, network checks, signatures and replay rejection. It does not broadcast to Arc. The browser test covers the `Get free tickets` button, cancelled signatures, issuer failures and refreshed ticket positions.


## Wishlist and payment comparison

The user first chooses exactly one night and one section, then count and cohesion. Radio controls always retain one selection. Section labels and offered tickets show demo reference prices from `lib/demo-pricing.ts`: Sections 0, 1, 2 and 3 are 1, 1.5, 2 and 2.5 USDC per ticket respectively. Each section shows unique tickets offered for swap for the selected night, plus deposited/issued counts from the same public snapshot. Offered supply requires a live, unexpired intent whose entire offered bundle is unredeemed and still in escrow under the correct depositor; overlapping intents do not count the same ticket twice. Deposited tickets without a live request are not offered supply. Counts refresh with public state and change with the selected night. Empty sections stay selectable for future requests. These inventory counts do not guarantee a match or payment capacity. No additional inventory is minted by adding a section choice. The second step compares the selected offered total with the desired bundle total; two Section 0 tickets for two Section 1 tickets suggest a 1 USDC debit ceiling. A reverse exchange suggests a 1 USDC credit floor. Unknown sections have no fabricated price and fall back to the manual limit.

The labelled demo nights start on 19 and 20 September 2026 at 20:00 Malaysia time (UTC+8), independently of the poster artwork. `lib/event-schedule.ts` sets each new intent's deadline to exactly eight hours before its chosen night: 12:00 Malaysia time on the same date. The validity field displays this fixed cutoff instead of an editable date. Changing nights updates the signed deadline. The snapshot disables expired choices; a fresh chain timestamp is checked again before signing. The existing contract checks the signed deadline at settlement; it does not store or verify the event schedule. Existing committed intents retain their original signed expiry. Set `NEXT_PUBLIC_SESSION_0_START` and `NEXT_PUBLIC_SESSION_1_START` to explicit timezone-qualified ISO dates and rebuild to change future drafts; missing or invalid schedules prevent signing.

The user may override the suggestion before signing. Only `maxNetPay` is enforced by the existing contract; actual payment can differ within that limit. This user-requested demo reference table is neither a valuation oracle nor a new settlement rule. No specific row is promised, no USDC prepayment was added, and no existing signed intent is changed.

After a free-ticket claim is confirmed, the app checks current NFT ownership and requests `wallet_watchAsset` with `type: ERC721`, the actual contract address and each token ID. Network/account changes stop import requests. MetaMask controls confirmation and display. Unsupported or declined imports preserve the successful claim and show contract/IDs/receipts plus an `Add to wallet` retry. Existing deployed tickets return an empty `tokenURI`, so this does not add NFT artwork; wallet placeholders are possible.


After a successful **Propose and settle**, the app requests NFT display for the connected recipient's replacement tickets, using the verified settlement receipt's `receives` IDs. IDs are deduplicated across that owner's legs; other participants' tickets and failed settlements never trigger imports. Each request checks the active Arc account and current NFT ownership. Settlement already releases tickets directly into recipient wallets, so no withdrawal is needed. Declining or failing a wallet display request does not undo or mark the swap failed. The confirmed receipt shows the NFT contract, received token IDs and an **Add to wallet** retry, also available when a recipient opens a past receipt settled by another proposer. Reading public history does not prompt wallet connection or import; offline participants can use the receipt when they return. MetaMask still controls import confirmation and NFT display.


The offering step shows only the connected wallet's tickets, including tickets deposited by that wallet. Before connection it shows **Connect wallet to see my tickets**, without selectable public inventory. This explicit read-only connection does not switch networks or deposit anything; signing actions still handle the Arc switch. A connected empty wallet is offered **Get free tickets**, with no approval/deposit controls or price comparison until it holds tickets. Changing accounts clears offered IDs and the prepared signature review while retaining the wishlist; transferred or redeemed tickets cannot remain in the effective offer. The public seat map and intent pool remain readable without connection.


**Start over** in the header requests MetaMask `wallet_revokePermissions` for this site's `eth_accounts` permission, then remounts the page state: wallet display, wishlist, offered selection, receipt, popup and solver controls return to their initial state. Public state is read again. It is disabled while wallet actions are pending. A failed or unsupported disconnect preserves the draft and gives manual MetaMask disconnect/reload instructions. This sends no chain transaction, clears no issuer journal or credentials, and does not revoke signed intents, withdraw deposited tickets, undo swaps or renew free-ticket eligibility. The operator's **Reset demo** is a separate on-chain preparation action.
