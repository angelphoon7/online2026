# Act two: an open chain with a buyer and a seller

This scene answers both questions with the existing deployed contracts and the existing backend solver: the market is not fixed to three participants, and the ticket route does not have to close into a cycle.

**Confirmed transaction:** [0x6df107019a5bb2d47654a12cf594923adf5f3cfb6259ba3a49d870f79e9ce29e](https://testnet.arcscan.app/tx/0x6df107019a5bb2d47654a12cf594923adf5f3cfb6259ba3a49d870f79e9ce29e), block **61369696**. [Full public proof](../deployments/act-two.json).

| Role | Offered | Received | Wallet USDC net, excluding gas |
| --- | --- | --- | --- |
| Buyer · `0xa8dae73BdE3a5C0E412884C9be2039a79dfB31fD` | No tickets | #18, #19 | −0.10 |
| Swapper B · `0x8C3345e88cB68f16dc31f88EE21b2032a5250e90` | #18, #19 | #20, #21 | −0.10 |
| Swapper C · `0xC1d189f4faD5BbaE8Cf972cB59e669441d813FBB` | #20, #21 | #22, #23 | −0.10 |
| Seller · `0x0dcd390c1df4cd14DE2EB9bbB53271ae9f48e034` | #22, #23 | No tickets | +0.30 |

Six NFT Transfer events and four SETTLED intents were verified, along with the net USDC transfers. The path is seller → C → B → buyer; it never returns to the seller. The six new tickets are in row 3, seats 1–2 of their respective session/section classes.

Before settlement, the backend found zero candidates without the buyer at block **61369658**, and zero without the seller at block **61369671**. Each search considered the remaining three committed intents. Adding both endpoints produced the four-intent candidate that was simulated and submitted. The artifact separately lists **15 setup transactions**; the exchange itself is the single settlement above.

There are four distinct wallets. The pure buyer offers no tickets and requests two adjacent tickets. Two swappers each offer a pair and request a different pair. The pure seller offers a pair, requests zero tickets, and signs a minimum USDC receipt. Tickets flow along one open path from seller through both swappers to buyer. The buyer and each swapper have a 0.10 USDC debit ceiling; the seller has a 0.30 USDC credit floor.

These are ordinary Intent fields: `offered=[]` for the buyer, `exactCount=0` and `maxNetPay=-300000` for the seller. No role flag, participant whitelist or scene-specific branch was added to `Settlement` or the solver. The transaction contains no new participant signatures; they were authenticated at commit.

## Show the scene

Open `/demo/act-two` in the running app. It verifies the recorded receipt against Arc and shows the four outcomes, USDC distribution and transaction link. The two endpoint-removal searches are explicitly labeled as recorded backend evidence from before settlement, not fresh searches of already-settled intents.

The runner requests three searches through the same `/api/solve` endpoint:

1. Omit the buyer: retain both swappers and seller.
2. Omit the seller: retain buyer and both swappers.
3. Include all four: submit only the proposal returned by the solver after simulation.

The first two searches must report no candidate before this script executes the third. Their block numbers, considered hashes, exclusions and search caps are saved with the successful proposal. Omitting an intent from a search does not revoke it on-chain.

Suggested narration:

> 第一幕是三方闭环。现在换成四个人：一个只买票、两个换票、一个只卖票。先去掉任意一端，solver 都没找到符合这些条件的方案。两端加入后，同一个 solver 找到这条开放链，同一份合约在一笔交易里完成六张票的交付和 USDC 净额结算。卖家的 exactCount 是零，买家没有 offered tickets，所以票流根本没有闭合成环。

“No solution found within the search bound” describes the recorded search. It is not a general claim that an endpoint is always necessary or that the market has no other possible solution. This backend supports 2–4 selected intents, at most four offered/received tickets per intent, 100 candidates and a two-second solver budget. The scene does not establish unbounded market support or organic demand; the four wallets are controlled test participants.

## Execute or verify

Start the configured Next.js backend, then run from the repository root:

```bash
npm run demo:act-two -- --prepare-only
npm run demo:act-two
```

The first command commits the four intents and records the failed subset searches plus the successful complete-chain simulation. The second resumes setup by its saved receipts, refreshes the searches, and executes one settlement. Once `deployments/act-two.json` exists, repeating either command audits the same transaction without minting or settling again.

```bash
npm run demo:act-two -- --verify
```

The runner uses `.env` and `.env.seed`, generates a new `SEED_D_PRIVATE_KEY` locally if absent, and funds that seller wallet's setup gas from the operator's test USDC. Preserve that ignored file and `.data/act-two-journal.json`. The journal saves signed bytes before broadcast so interrupted runs resume the same transaction hash. Do not run concurrent copies. No keys or raw signed bytes enter the public artifact or API.

The scene uses six additional tickets on the same TicketNFT and keeps the earlier twelve-ticket pending round separate. Minting, funding, approvals, deposits and commits are setup transactions, listed separately from the one settlement. `SOLVE_API_URL` defaults to `http://127.0.0.1:3000`.

## What is verified

The receipt audit binds calldata to the backend proposal and the transaction to its receipt block. It checks four distinct participants, a pure buyer, a pure seller, two swappers, exactly six distinct NFT releases, and each participant's actual USDC debit/credit. It follows the NFT recipients from seller to buyer and rejects a disconnected swap cycle, even if that receipt otherwise has four participants and six transfers.

Historical reads verify LIVE intent states and escrow depositors in the preceding block, then SETTLED states and final ticket ownership in the receipt block. Gas is separate from the balanced settlement payments. The existing first-scene receipt audit uses the same base checks with its original three-party-cycle requirements.

Tests also change wallet addresses and input ordering, lower the buyer's signed budget and revoke the seller in the test state. They invoke the existing solver rather than substituting a saved outcome:

```bash
node --test scripts/test-act-one-proof.mjs scripts/test-act-two.mjs
```
