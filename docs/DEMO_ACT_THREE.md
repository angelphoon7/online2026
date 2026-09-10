# Act three: the contract rejects an untrusted proposer

**Real rejected transaction:** [0x087f78f9bdc54b5f9bb8f6939f2a4633ee1f554e8fc198cc75739b1b722279fe](https://testnet.arcscan.app/tx/0x087f78f9bdc54b5f9bb8f6939f2a4633ee1f554e8fc198cc75739b1b722279fe), block **61374887**. [Full public evidence](../deployments/act-three.json).

Historical replay at block **61374886** decoded `SeatsNotAdjacent`, selector **`0x5ce36642`**, for intent `0x125054f2f4e4a7e939dd6442c45dfa9377642294bf41d52492cda35d507a967e`. The offending allocation used tickets #24 and #26: row 4, seats 1 and 3. The other buyer was assigned #25 and #27: seats 2 and 4.

The failed transaction moved zero tickets and executed zero USDC settlement payments. All four tickets remained escrowed by the same depositor; all three intents stayed LIVE; participant USDC balances and allowances and the Settlement USDC balance were identical in the before/after snapshots. The separate proposer paid gas. The artifact also lists **8 successful setup transactions**, separately from the failed proposal.

The third scene keeps the signed intents intact and changes only the ticket allocation in a proposal. Two buyers each request exactly two adjacent seats. A seller offers four active tickets in one event, session, section and row, seats 1–4. The ordinary solver finds a valid assignment of adjacent pairs. The malicious proposer instead assigns seats 1 and 3 to one buyer, and 2 and 4 to the other.

The offered/received ticket multiset, exact counts, signed payment limits and proposed USDC amounts stay unchanged. A legitimate allocation succeeds in `eth_call`; the split allocation returns the deployed contract's `SeatsNotAdjacent(bytes32 intentHash)` error. The script then bypasses the normal solver submission path to broadcast that exact malicious calldata from a separate proposer wallet, expecting a reverted receipt. The proposer pays test USDC gas.

No contract or solver special case is added. `Settlement._checkPredicate` invokes `_checkAdjacency` because the unchanged signed intent requires it. Checking occurs before effects or transfers. Rejecting this proposal is the contract's decision, independent of the solver's willingness to submit it.

## Show the scene

Open `/demo/act-three`. It shows the recorded failed transaction, the decoded error name and offending intent hash, the four seats with the malicious selection highlighted, and the participants' unchanged states and USDC balances. The page verifies the evidence against Arc when loaded.

The buttons **Run malicious proposal** and **Check valid allocation** call `POST /api/demo/act-three` with a fixed mode. The backend executes `eth_call` on current chain state using the original committed intents. These buttons never sign or broadcast, and require no wallet. The actual returned error is decoded from EVM bytes; a transport error is shown as unavailable simulation, not as `SeatsNotAdjacent`. A later expiry, withdrawal or settlement can change the live result.

Suggested narration:

> 现在换一个不可信的 proposer。用户原来的签名没变，还是要两张相邻座位。它把 1、3 号座位塞给一个买家，2、4 号塞给另一个。票数和钱都对，但合约直接返回 SeatsNotAdjacent。失败交易已经上链，票还在原来的 escrow，intent 仍然 LIVE，参与者没有付出补差价。把分配改回相邻座位，同一组签名就能通过模拟。相邻不是 UI 上的承诺，是合约执行前的检查。

## Evidence and its limits

An Ethereum-style receipt records success/failure, not custom-error return bytes. The public proof therefore separates:

- The real transaction, destination, calldata and inclusion in its block, with receipt status `reverted`.
- A historical `eth_call` of that exact calldata at the preceding block, returning raw bytes decoded with the deployed Settlement ABI. The decoded name must be `SeatsNotAdjacent` and its argument must match the targeted committed intent hash.
- A valid allocation using the same intents, caller and historical block, which must simulate successfully.
- Before/after reads of all four ticket owners and depositors, all three intent states, participant USDC balances and allowances, and the Settlement USDC balance. NFT and Settlement logs must be absent from the reverted receipt.

The recorded comparison uses block boundaries. The failure receipt proves this transaction did not commit its settlement effects; the historical reads show the tested state around its block. The gas-paying proposer is separate from the three participants, so its USDC gas expense is not described as an unchanged participant balance.

The original valid proposal is simulated, not settled by this command. The three intents remain available for the live rejection/control buttons until they expire or someone changes their state. The previous scenes' transactions and the twelve-ticket pending demo are separate.

## Run and resume

With the existing Arc deployment, local `.env` and `.env.seed` keys, and Next.js backend running:

```bash
npm run demo:act-three -- --prepare-only
npm run demo:act-three
```

The first command prepares four dedicated tickets and three ordinary intents, obtains the valid proposal through `/api/solve`, and checks both allocations. The second refreshes those checks, then intentionally sends one failing transaction with an explicit gas limit. It refuses to broadcast if simulation reports a different error.

Participant keys are the existing A/B/C wallets; `SEED_D_PRIVATE_KEY` supplies the separate proposer from act two. No private keys enter the frontend or public backend. The ignored `.data/act-three-journal.json` saves signed bytes before broadcast. Keep it private, avoid concurrent runs, and resume the same command after interruption. Once `deployments/act-three.json` exists, the command re-verifies the same failed transaction without sending another one.

```bash
npm run demo:act-three -- --verify
node --test scripts/test-act-three.mjs
```

The tests distinguish a genuine adjacency rejection from modified signatures, altered payment amounts, broken conservation, other named errors and unavailable RPC responses. The existing Foundry test `test_rejects_non_adjacent_when_required` asserts the specific Solidity error and offending intent hash.
