# Section and session inventory

Verified at Arc block **61618824**: token IDs **36 through 99**, **32 live offers**, and **104 successful setup transactions**. Receipt gas fees total **0.254121296 test USDC**. These figures describe that verification block; later swaps, withdrawals, revocations or expiry can reduce available supply.

`npm run demo:inventory -- --broadcast` prepares 64 Event 1 tickets on the existing Arc Testnet contracts: eight tickets in each section (0–3) of each session (0–1). Each cell contains four adjacent pairs, deposited by the configured registered issuer and committed as four ordinary swap intents. The script does not settle them.

```bash
npm run demo:inventory -- --check      # configuration, domain, balance and plan
npm run demo:inventory -- --broadcast  # create or resume this batch
npm run demo:inventory -- --verify     # current custody, metadata and live offers
```

To add another batch while preserving the original inventory and its evidence, give it a new name:

```bash
npm run demo:inventory -- --check batch-2
npm run demo:inventory -- --broadcast batch-2
npm run demo:inventory -- --verify batch-2
```

Each named batch adds another 64 tickets and 32 offers. The same name always resumes that batch. `batch-2` uses the ignored `.data/section-inventory-batch-2.json` journal and the public [second-batch manifest](../deployments/section-inventory-batch-2.json); omitting the name continues to use the original files. Batch names accept only lowercase letters, digits and hyphens. All batches share the issuer lock and keep separate fee ceilings. Reuse the same name after an interrupted run; use a new name only when intentionally adding more inventory.

Each issuer intent offers two adjacent tickets and accepts exactly two adjacent tickets from either configured session and any of the four sections. Its `maxNetPay` is zero: the issuer will not pay a top-up and does not require a credit. These are deliberately permissive demo inventory constraints, not a platform valuation. A participant's own signed constraints still govern their side of the exchange. The issuer's replacement tickets must share a session, section and row and have consecutive seat numbers.

All inventory offers expire at the earlier session's eight-hour cutoff, because they can receive tickets from either night. With the labelled demo schedule, this is **19 September 2026, 12:00 Malaysia time (04:00 UTC)**. The committed deadline stays fixed if configuration changes later.

The script uses `DEMO_ISSUER_PRIVATE_KEY`, falling back to `PRIVATE_KEY`, from `.env`. It checks issuer registration, chain ID, contract wiring, frontend addresses and the EIP-712 domain before sending anything. Every write is simulated and has an explicit gas limit. It enforces a fee ceiling of 0.1 test USDC per transaction and 5 test USDC for the entire batch; these are spending limits, not measured gas estimates. Actual receipt gas and fees are recorded separately.

The ignored `.data/section-inventory.json` journal saves signed transactions before broadcast. Rerunning resumes those exact transactions instead of minting another batch. It shares `.data/demo-tickets/issuer.lock` with free-ticket claims to avoid competing issuer nonces. After a crash, confirm no issuer process is running and reconcile pending transactions before removing a stale lock. Keep the journal; deleting it creates another batch on the next broadcast. Do not run other scripts that spend from this issuer concurrently.

The public [inventory manifest](../deployments/section-inventory.json) records ticket IDs, metadata, mint/deposit/commit transaction hashes, signed intent fields, receipt gas and measured fees. Verification reads custody, metadata and registry state at one block. It fails if any of the expected 64 tickets are no longer offered, rather than reissuing tickets that another participant already received.

In the app, open Event 1 and refresh public state. **Which section** counts these tickets as offered only while their intents remain live and their complete offered bundles remain in escrow. Select either night to inspect its section counts. Public discovery reads the chain; the inventory manifest is evidence, not a preloaded solver outcome.

The public market reader spaces historical log queries to avoid Arc RPC rate limits during a cold scan. Initial loading includes the full deployment history; subsequent reads reuse discovered events after checking the previous block hash and still refresh current custody and intent state.

The app backend public scan also passed at block **61619336**: 100 total issued tickets and at least eight live offered tickets in every configured section/session. [Public section counts](../deployments/section-inventory-public-state.json). Session 1 / Section 0 also includes two pre-existing offers, for ten tickets offered at that block.

Second batch verified at Arc block **61622739**: token IDs **100 through 163**, **32 additional live offers**, and **104 successful transactions**. Its receipt gas fees total **0.254122616 test USDC**. The two batches minted **128 distinct tickets** in total; the original batch manifest and journal were preserved.

For the 12 September batches with varied one-, two- and three-ticket requests, see
[demo replacement inventory](DEMO_REPLACEMENT_INVENTORY.md).
