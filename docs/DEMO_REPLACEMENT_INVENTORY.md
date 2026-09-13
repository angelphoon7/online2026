# Demo replacement inventory

These batches mint real Arc Testnet tickets, deposit them into the existing Escrow and commit
signed requests to the existing IntentRegistry. The current `reshuffle` v0.1.1 subgraph indexes
them. Different bundle sizes use the same contracts and EIP-712 domain.

The requests are seeded by the issuer wallet. They are demonstration liquidity, not evidence
of independent participant demand. Matching is computed from live indexed conditions; no
settlement is sent by the seed or verification commands.

| Batch | Tickets | Intents | Exact replacement count |
|---|---:|---:|---:|
| `demo-pairs-sep12` | 64 | 32 | 2 |
| `demo-singles-sep12` | 8 | 8 | 1 |
| `demo-triples-sep12` | 24 | 8 | 3 |

All three batches completed on 12 September 2026: **96 new tickets and 48 LIVE requests**.
At indexed block **61774575**, each of the 48 requests found a candidate and passed a
Settlement simulation. Five selected pair proposals included the participant wallet and
issuer wallet; the other selected proposals checked issuer inventory against issuer inventory.
These are individual checks, not 48 disjoint settlements: candidates may reuse inventory.
There were 168 successful setup transactions, with total receipt fees of **0.35958816 test USDC**.

Both Saturday (session 0) and Sunday (session 1) have inventory in sections 0–3: Floor,
Tier 1, Tier 2 and Section 3. Every pair and triple requires the same session, section and
adjacent seats in one row. Single-ticket requests do not set adjacency. All these inventory
requests have `maxNetPay=0` and expire at **2026-09-19 04:00 UTC**.

Pairs include four request types in each session/section:

- Change to the other session while keeping the same section.
- Accept either session within the same section.
- Keep the session and change between sections 0/1 or 2/3.
- Accept either session and any of sections 0–3.

Singles and triples request the other session within the same section.

## Run or resume

From the repository root, use `npm.cmd` on Windows PowerShell if execution policy blocks
`npm.ps1`. Existing batch names resume their journal; use a new name only to intentionally
create another batch. The final argument selects the varied request profile and exact count.
Omitting it preserves the original two-ticket inventory profile.

```powershell
node scripts/seed-inventory.mjs --check demo-pairs-sep12 2
node scripts/seed-inventory.mjs --broadcast demo-pairs-sep12 2
node scripts/seed-inventory.mjs --broadcast demo-singles-sep12 1
node scripts/seed-inventory.mjs --broadcast demo-triples-sep12 3
```

`--broadcast` sends testnet mint, approval when needed, escrow and commitment transactions.
Each batch has a 5 test-USDC fee ceiling. Signed transaction journals stay in ignored `.data/`;
public manifests contain ticket metadata, intent hashes and transaction receipts.

## Verify before the demo

```powershell
npm.cmd --prefix solver run build
node scripts/check-inventory-matches.mjs demo-pairs-sep12 demo-singles-sep12 demo-triples-sep12
```

This reads The Graph at or beyond the seed receipt blocks, checks indexed intent hashes,
uses chain payment capacity and runs the real solver with a required intent. Each search
is capped at two intents, 100 candidates and 2,000 ms. Counterparts must request a change
of session or section, so the checked proposal changes ticket IDs. Each selected proposal
must also pass `Settlement.settle` through `eth_call`. The evidence records the pool block,
search bounds, measured runtime, exclusions, ranking reason, proposal and simulation result.

The report states the number of distinct wallets per proposal. Matches between two issuer
intents should be described as issuer inventory checks. Wallet-to-issuer examples in the
report provide the participant-facing demonstration.

The first pair verification found a wallet-to-issuer example: wallet `0x4a599d033e1295e93bbfb5fea17ab44b2cbad9fd`
offers tickets **34 and 35**, and can receive issuer tickets **164 and 165**, with zero net
payment. The wallet intent is
`0x117a7a0b18f99c663eb9f29158a750d572a9c22bd0c3bfb86d9099122e4872ed`;
the issuer intent is
`0xfec338b336a433b745dc2f250092ebaf5d2de45763569512b81311ea9540ee48`.
This is a verified example, not a fixed outcome: use the wallet's request in the app and
run matching again. The solver may choose another valid bundle.

See the [matching evidence](checks/inventory-matches-demo-pairs-sep12.json) and the
[pair inventory manifest](../deployments/section-inventory-demo-pairs-sep12.json).
Verification does not reserve tickets or lock state. Demo settlement still requires live
intents, valid escrow custody and sufficient payment capacity at execution; rerun matching
after any settlement, revocation or withdrawal. In particular, several existing requests
reference the same wallet tickets, so consuming one can invalidate the others' custody.
