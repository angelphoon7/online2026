# Three-user circle demo: one and three tickets

Four independent groups are committed on the existing Arc Testnet contracts and indexed by `reshuffle` v0.1.1. Each group has three distinct demo wallets: A wants the class held by B, B wants the class held by C, and C wants the class held by A. All tickets in each group are disjoint from the other groups. These are seeded participants, not a claim about organic demand.

**Scope:** the no-direct-swap proof applies to the three selected requests in each group. Existing permissive inventory elsewhere in the market can allow other direct trades. Use manual selection for this demonstration; arbitrary new conditions are not guaranteed to require or admit a circle.

Verified at indexed block **61777195**: 12 pair failures and four successful three-user simulations. All 12 intents were LIVE, all 24 offered tickets were escrow-backed, and every indexed signed intent hash matched the contract. The seed made 48 successful setup transactions, with 0.0999088425 test USDC in receipt fees. No settlement was broadcast.

| Role | Wallet |
|---|---|
| A | `0xa8dae73BdE3a5C0E412884C9be2039a79dfB31fD` |
| B | `0x8C3345e88cB68f16dc31f88EE21b2032a5250e90` |
| C | `0xC1d189f4faD5BbaE8Cf972cB59e669441d813FBB` |

## In the app

1. Refresh public state, then open **Intent pool**.
2. Clear unrelated selections. Use **Wallet and transaction details** to identify each request by the Commit prefix below. Checking a box switches matching to manual mode. Do not rely on Request numbers: they change as the pool changes.
3. Select A+B from one group and click **Search selected requests**. Repeat for A+C and B+C: each should return no candidate for those selected requests.
4. Select exactly A+B+C from that group and search again: the complete circle can be found and simulated.
5. To execute during the demo, use **Propose and settle** and confirm from a funded proposer wallet. The three owners have already signed their intents and do not need to be online. All three bundles move together.

The verifier also submits each invalid direct-swap proposal through read-only `eth_call`, confirming a specific named contract rejection. It does not broadcast invalid transactions. A normal solver search reports no candidate without sending that invalid proposal.

All requests have `maxNetPay=0`. The triple-ticket requests require same session, same section and adjacent seats in one row. Single-ticket requests leave adjacency off. Deadline: **19 September 2026, 04:00 UTC / 12:00 Malaysia time**.

## Groups

### single-date

| User | Offers | Held class | Accepts only | Commit prefix |
|---|---|---|---|---|
| A | #260 | Saturday / Floor | Sunday / Floor | `0x51498d55` |
| B | #261 | Sunday / Floor | Saturday / Tier 1 | `0xf268cef2` |
| C | #262 | Saturday / Tier 1 | Saturday / Floor | `0x54e34092` |

| Selected users | Result |
|---|---|
| A+B | No valid assignment; direct-swap contract rejection: `SectionNotAccepted` |
| A+C | No valid assignment; direct-swap contract rejection: `SessionNotAccepted` |
| B+C | No valid assignment; direct-swap contract rejection: `SessionNotAccepted` |
| A+B+C | Three-user cycle; chain simulation passed |

The ticket direction is **B ? A, C ? B, A ? C**. A request describes the acceptable class; the solver derives the actual assignment from indexed data.

For the selected-intent backend endpoint, POST this JSON to `/api/solve`:

```json
{
  "intentHashes": [
    "0xc7a6f1396af3f240050c98910ecf035119cf9a7d17885244afcb3242b69ecb07",
    "0x486f7c7c659f5a307dcc924e6a7d1058bc0b1923160894774f11b9eff3706759",
    "0xd45fbafc70ad594484c5946b776bca86a2a0f2c7218617c793aacb0ba56f86c1"
  ],
  "minBlock": "61777093"
}
```

### single-section

| User | Offers | Held class | Accepts only | Commit prefix |
|---|---|---|---|---|
| A | #263 | Sunday / Floor | Sunday / Tier 1 | `0xad9593d9` |
| B | #264 | Sunday / Tier 1 | Sunday / Tier 2 | `0x829bf5a5` |
| C | #265 | Sunday / Tier 2 | Sunday / Floor | `0x3d0271f9` |

| Selected users | Result |
|---|---|
| A+B | No valid assignment; direct-swap contract rejection: `SectionNotAccepted` |
| A+C | No valid assignment; direct-swap contract rejection: `SectionNotAccepted` |
| B+C | No valid assignment; direct-swap contract rejection: `SectionNotAccepted` |
| A+B+C | Three-user cycle; chain simulation passed |

The ticket direction is **B ? A, C ? B, A ? C**. A request describes the acceptable class; the solver derives the actual assignment from indexed data.

For the selected-intent backend endpoint, POST this JSON to `/api/solve`:

```json
{
  "intentHashes": [
    "0xdeb9d14956f8ec6a5e3653a0015afeebdbd116e6a8a17893ae3723f230b04129",
    "0xba9fc0a4d3b0947ce1d3661bfeb07fc443bcc38358098f8d9123aab91b196fc1",
    "0x5b517df192f08354ac58913a147f2349c60d5fed60963bb7a8bb7598089c9597"
  ],
  "minBlock": "61777093"
}
```

### triple-date

| User | Offers | Held class | Accepts only | Commit prefix |
|---|---|---|---|---|
| A | #266, #267, #268 | Sunday / Tier 1 | Saturday / Tier 1 | `0x76be5ca6` |
| B | #269, #270, #271 | Saturday / Tier 1 | Sunday / Tier 2 | `0xa3d36bae` |
| C | #272, #273, #274 | Sunday / Tier 2 | Sunday / Tier 1 | `0x6b6fdf30` |

| Selected users | Result |
|---|---|
| A+B | No valid assignment; direct-swap contract rejection: `SectionNotAccepted` |
| A+C | No valid assignment; direct-swap contract rejection: `SessionNotAccepted` |
| B+C | No valid assignment; direct-swap contract rejection: `SessionNotAccepted` |
| A+B+C | Three-user cycle; chain simulation passed |

The ticket direction is **B ? A, C ? B, A ? C**. A request describes the acceptable class; the solver derives the actual assignment from indexed data.

For the selected-intent backend endpoint, POST this JSON to `/api/solve`:

```json
{
  "intentHashes": [
    "0xb9a1efd313f4a3de81b3c944f8be7f5d8d639cc3a63746ea78910292ad8683fd",
    "0x42c9674f8f95f3a0a53c170eb544d9b736b6978cbd32c8efe5b35166af3f785c",
    "0x5f21bc9152349377513de84538edbd86c7b9ea04c1b457e6fb38481dc86130dc"
  ],
  "minBlock": "61777093"
}
```

### triple-section

| User | Offers | Held class | Accepts only | Commit prefix |
|---|---|---|---|---|
| A | #275, #276, #277 | Saturday / Floor | Saturday / Tier 1 | `0x5a5666ed` |
| B | #278, #279, #280 | Saturday / Tier 1 | Saturday / Tier 2 | `0x2b6178af` |
| C | #281, #282, #283 | Saturday / Tier 2 | Saturday / Floor | `0x99fb8216` |

| Selected users | Result |
|---|---|
| A+B | No valid assignment; direct-swap contract rejection: `SectionNotAccepted` |
| A+C | No valid assignment; direct-swap contract rejection: `SectionNotAccepted` |
| B+C | No valid assignment; direct-swap contract rejection: `SectionNotAccepted` |
| A+B+C | Three-user cycle; chain simulation passed |

The ticket direction is **B ? A, C ? B, A ? C**. A request describes the acceptable class; the solver derives the actual assignment from indexed data.

For the selected-intent backend endpoint, POST this JSON to `/api/solve`:

```json
{
  "intentHashes": [
    "0xf50851ff97e08eabae4b37511f880c0bf8f847a9ad429fcdc54cd2a0dd25ed0e",
    "0x3a75f8985df9018d08331cf169e7e2206ba20e11936c5fc6cffb66a4e175578b",
    "0x3885e55e61ce2c6645b9aedeb29fb213b58f8508cdbefc514c594fb28fac577b"
  ],
  "minBlock": "61777093"
}
```

## Recheck or add another batch

```powershell
npm.cmd --prefix solver run build
node scripts/check-circle-inventory.mjs sep12

# Read-only preflight; the same batch resumes without creating a duplicate.
node scripts/seed-circle-inventory.mjs --check sep12
# To intentionally add four more groups, choose a NEW name before broadcasting.
node scripts/seed-circle-inventory.mjs --broadcast rehearsal-2
node scripts/check-circle-inventory.mjs rehearsal-2
```

`--broadcast` uses the existing local issuer and two seed wallet keys; the ignored journal stores signed bytes before submission. Total fee ceiling per batch is 3 test USDC, with optional participant funding capped at 1 test USDC total. This batch needed no funding transfers. Keep the private journal when resuming.

The read-only verifier checks indexed data against chain state at the indexed block, demonstrates that every pair lacks enough acceptable tickets under the signed masks, completes bounded pair searches, confirms named rejections with offending values, solves all three intents, checks the three distinct recipients and simulates the result. Each search allows at most 3 intents, 100 candidates and 5,000 ms; actual runtime and exclusions are in the evidence.

[Public tickets, intent hashes and transaction receipts](../deployments/circle-inventory-sep12.json) ? [Pair and triple evidence](checks/circle-inventory-sep12.json)

Successful execution consumes that group. Other groups use different tickets and remain available unless someone changes their state. Before each demo, recheck freshness: revocation, withdrawal, expiry or an intervening settlement can invalidate a previously simulated result. The user need not be online; the signed conditions and chain state still have to remain valid.
