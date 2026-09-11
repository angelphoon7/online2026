# Act one: three parties, six tickets, one real settlement

The first scene is a confirmed transaction on Arc Testnet (5042002):

**[0xdc54e3971c04dc533b1ad3604cd29368cb67556d265fb093b60e146e5e6f3143](https://testnet.arcscan.app/tx/0xdc54e3971c04dc533b1ad3604cd29368cb67556d265fb093b60e146e5e6f3143)**

Receipt block: **61301567**. The receipt contains one `Settled` event with three participants, and six distinct `TicketNFT.Transfer` events releasing tickets from Escrow to the three replacement holders.

| Participant | Offered pair | Received pair | Wallet USDC net, excluding gas |
| --- | --- | --- | --- |
| A · `0xa8dae73BdE3a5C0E412884C9be2039a79dfB31fD` | #12, #13 · Saturday Floor | #14, #15 · Sunday Floor | −0.10 |
| B · `0x8C3345e88cB68f16dc31f88EE21b2032a5250e90` | #14, #15 · Sunday Floor | #16, #17 · Saturday Tier 1 | 0 |
| C · `0xC1d189f4faD5BbaE8Cf972cB59e669441d813FBB` | #16, #17 · Saturday Tier 1 | #12, #13 · Saturday Floor | +0.10 |

Each signed intent requests exactly two adjacent seats in the desired session and section. All pairs are row 2, seats 1 and 2 in their respective session/section. These are six additional tickets on the existing TicketNFT, using the same three controlled test wallets and four deployed contracts. Tickets #0–#11 remain available for the separate pending demo.

## Show the first scene

Run the Next.js app and open **`/demo/act-one`**. The view reads the confirmed receipt and block from Arc on each verification, checks the submitted calldata against the solver's proposal, and verifies escrow depositors before settlement and NFT recipients afterward. The display is a completed transaction view, not a new settlement animation or a preloaded solver result.

Suggested narration:

> 三个人各有两张票，也各自签好了愿意接受的替换条件。A 要 B 的票，B 要 C 的票，C 要 A 的票。这笔 Arc 交易验证三个人的条件后，六张票一起换手。这里是同一个 tx hash 的六条转移日志；三条 intent 都已 SETTLED。补差价在同笔结算里完成，USDC 净额相加是零，gas 也用 USDC 支付。

Show the before/after table, then follow the transaction link and inspect its six NFT transfer logs. The full proof includes each log index, the three intent hashes, metadata, the solver evidence, and historical ownership checks at blocks 61301566 and 61301567: [public artifact](../deployments/act-one.json). `GET /api/demo/act-one` independently reruns these receipt and state checks; an RPC failure is displayed as unavailable verification.

Minting, depositing and committing required **12 separate preparation transactions**, listed in the artifact's `setupTransactions`. The claim of **one transaction** refers to the six-ticket settlement itself, not to all setup operations.

## Commands and repeat behavior

```bash
# First run: prepare the six tickets, solve through the backend, and settle once.
# Completed runs: verify the existing transaction; do not settle again.
npm run demo:act-one

# Strictly read-only chain verification of the completed scene:
npm run demo:act-one -- --verify
```

Before execution, `--prepare-only` stops after the three intents are committed and the backend simulation passes. After completion, all modes verify the existing artifact. This command deliberately identifies one recorded scene; it does not consume the twelve-ticket pending demo or mint more tickets each time.

Initial preparation requires the configured Arc deployment, `.env` operator key, `.env.seed` participant keys, and a running backend. `SOLVE_API_URL` defaults to `http://127.0.0.1:3000`. Local keys sign the setup and settlement; the public API only searches, simulates and verifies.

The ignored `.data/act-one-journal.json` persists the plan and signed transaction bytes before broadcast. Keep it private and do not run concurrent copies. Interrupted execution resumes the same transaction hash. Once confirmed, the public artifact contains the proof and setup hashes without signing keys or raw signed transactions. If receipt verification is interrupted after settlement, rerun the command to finish auditing the existing transaction.

The receipt audit also checks inclusion in the block's transaction list. This handles the observed Arc RPC response where `eth_getTransactionByHash` had a null `blockHash` despite a confirmed receipt, without accepting an unbound receipt or sending another settlement.

Proof rejection checks:

```bash
node --test scripts/test-act-one-proof.mjs
```
