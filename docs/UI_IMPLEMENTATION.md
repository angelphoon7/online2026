# Single-page UI

The current product lives at `/`. The former demo and workspace URLs redirect there. Hero, event picker, workspace and receipts share the page; opening a poster or receipt does not change the URL. Historical proof APIs remain available.

Public positions and commitments for every deployed event preload as soon as the page mounts, while the visitor reads the hero. The active poster shows loading status until the snapshot is ready. Its workspace is prepared in advance and opening it reuses that snapshot; no additional read starts on poster click. Overlapping background refreshes share the same pending request. Undeployed placeholder events remain inactive.

The page is fully readable with no wallet. Seat grid, intent pool, past settlements and solver
candidates all render from public chain reads. There is no connect gate, no modal on load, no
"connect to continue" empty state.

The connect prompt fires only on an action needing a signature. Exactly four: Sign and commit,
Deposit, Withdraw, Propose and settle. Clicking any of these with no wallet connected opens the
connection inline and then continues into the original action without a second click — connect
and act are one gesture.

If the chain is not Arc testnet, prompt the switch inside that same flow. Never block beforehand.

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

- There is no signed row target or requested receiving ticket-ID field. The three-step builder sets session and section masks in one place. The closed, read-only seat map follows those masks; it does not promise a particular row. Count, masks, cohesion and adjacency remain independently editable signed conditions.
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

The single-column flow expands one step at a time: return conditions, offering tickets and payment comparison, then review and sign. Completed steps retain their values behind a Change button. Ticket positions show the first eight, with additional positions in a disclosure; page content has no nested scroll containers.

`lib/intent-draft.ts` initializes masks from issued metadata. `lib/ui-copy.ts` generates the review from the same Intent object handed to the signer, after resolving the connected owner and unused nonce. Adjacency, signed payment bounds and expiry remain contract inputs without any ABI changes. The sentence regression check mutates all twelve fields.

Components obtain chain data through `lib/chain-reads.ts`: `getIntentPool`, `getTicketsFor`, `getSettlements` and `getSeatCustody` query a shared snapshot, keeping a coherent source block. Receipt, balance, approval, nonce and simulation reads use the same boundary. The existing public API remains the data source; no subgraph was added.

Run `node scripts/test-intent-sentence.mjs` for sentence and mask checks. With the app at localhost:3101, run `node scripts/test-market-browser.mjs` for the mock-wallet browser checks.

## Free demo tickets

The `Get free tickets` button in step 2 connects the recipient wallet, switches to Arc Testnet if needed, and requests a personal-sign claim message. `/api/demo/tickets` verifies a fresh, single-use signature from that recipient before the registered server issuer mints two adjacent Event 1 tickets. The issuer pays minting gas. The user still needs test USDC for deposits and settlement. Tickets appear after verified mint receipts and a fresh public-state read; no intent or outcome is created automatically.

Local development enables this endpoint when the issuer key is configured. Hosted demos must explicitly set `DEMO_TICKETS_ENABLED=true`; `false` disables it anywhere. `DEMO_ISSUER_PRIVATE_KEY` can select a separate registered issuer, otherwise the server uses `PRIVATE_KEY`. These keys remain server-side. Issuance is restricted to the recorded Arc Testnet NFT deployment, one pair per recipient and twenty new recipient claims per UTC day. Each mint uses an explicit gas limit and a maximum fee budget of 0.1 test USDC.

Run this issuer on one persistent Node server (or workers sharing the same disk). Keep `.data/demo-tickets/` across restarts: it holds the claim journal and signed transactions, allowing retries to resume a partial pair without duplicates. The filesystem lock serializes issuer transactions. After a process crash, stop issuer workers and reconcile recorded transactions before removing a stale `issuer.lock`; do not delete the claim journal to clear an error. Do not run other issuer scripts concurrently with claims. An ephemeral/serverless deployment needs durable shared storage and coordinated transaction submission before enabling this endpoint.

`node scripts/test-demo-tickets.mjs` exercises the issuer and claim API against a local RPC with a throwaway key, including receipt verification, partial-claim recovery, repeat claims, network checks, signatures and replay rejection. It does not broadcast to Arc. The browser test covers the `Get free tickets` button, cancelled signatures, issuer failures and refreshed ticket positions.


## Wishlist and payment comparison

The user first chooses acceptable sessions, sections, count and cohesion. Section labels and offered tickets show demo reference prices from `lib/demo-pricing.ts`: Section 0 is 1 USDC per ticket and Section 1 is 1.5 USDC. The second step compares the selected offered total with the desired bundle total; two Section 0 tickets for two Section 1 tickets suggest a 1 USDC debit ceiling. A reverse exchange suggests a 1 USDC credit floor. Multiple acceptable sections show a range and use its upper endpoint for the suggested signed limit. Unknown sections have no fabricated price and fall back to the manual limit.

The user may override the suggestion before signing. Only `maxNetPay` is enforced by the existing contract; actual payment can differ within that limit. This user-requested demo reference table is neither a valuation oracle nor a new settlement rule. No specific row is promised, no USDC prepayment was added, and no existing signed intent is changed.

After a free-ticket claim is confirmed, the app checks current NFT ownership and requests `wallet_watchAsset` with `type: ERC721`, the actual contract address and each token ID. Network/account changes stop import requests. MetaMask controls confirmation and display. Unsupported or declined imports preserve the successful claim and show contract/IDs/receipts plus an `Add to wallet` retry. Existing deployed tickets return an empty `tokenURI`, so this does not add NFT artwork; wallet placeholders are possible.
