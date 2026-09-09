# Circle App Kits: escrow and payment fit

Reviewed: **2026-09-09**. Decision: **retain the current Escrow and Settlement contracts; do not add App Kits to the settlement execution path.** App Kits offers usable payment operations on Arc, but the reviewed public APIs do not provide a replacement for RESHUFFLE's ticket custody and signed outcome validation. This is an assessment of documented capabilities, not a claim that custom extensions are impossible.

## Why we evaluated it

The ETHOnline 2026 Arc prize description includes:

> Payment, liquidity or treasury workflows using App Kits where relevant

Source: [official ETHOnline 2026 prize page, Arc](https://ethglobal.com/events/ethonline2026/prizes#arc).

Our interpretation is to explain fit and use a kit when it serves the product. This decision records that assessment; it does not claim integration credit or guarantee a judging outcome.

## Available capabilities and the decision

Circle's [App Kits overview](https://docs.arc.io/app-kit) documents Send, Bridge, Swap and Unified Balance. The [supported-chain table](https://docs.arc.io/app-kit/references/supported-blockchains) lists all four on Arc Testnet, including a Viem adapter. **Network compatibility is not the reason for declining integration.**

| Capability | What is documented | Fit for RESHUFFLE |
| --- | --- | --- |
| **Send** | Same-chain wallet-to-wallet token transfers; the sender's adapter signs and submits. [Send documentation](https://docs.arc.io/app-kit/send) | Usable for a separate wallet funding transfer. It does not check ticket conditions or execute our multi-owner settlement. No new standalone payment flow is needed in this demo. |
| **Bridge** | USDC movement across chains, with CCTP handling exposed through the SDK. [SDK reference](https://docs.arc.io/app-kit/references/sdk-reference) | A possible future way to fund the user's Arc wallet before settlement. Cross-chain onboarding is outside the current single-chain scope. |
| **Swap** | Token exchange on one chain or across chains. [Swap documentation](https://docs.arc.io/app-kit/swap) | No currency conversion is needed: payment limits and settlement use USDC. Fungible-token exchange does not implement our NFT bundle constraints. |
| **Unified Balance** | Gateway-based deposits and spending from USDC held across chains. [Unified Balance documentation](https://docs.arc.io/app-kit/unified-balance) | Useful if users arrive with balances spread across chains. Our contract currently checks each owner's Arc USDC balance and allowance; a Gateway balance cannot simply be counted as that capacity. |
| **Earn / vault operations** | Circle's treasury sample includes Earn Kit for vault discovery, deposits, withdrawals and positions. [Official arc-fintech sample](https://github.com/circlefin/arc-fintech) | No platform treasury or yield workflow exists here. Escrow holds tickets; payment USDC remains in participant wallets until settlement. Adding vault allocations would change the product and payment-capacity assumptions. |
| **Drop-in ticket escrow + conditional net settlement** | No matching method or module was found in the reviewed [App Kit public API](https://docs.arc.io/app-kit/references/sdk-reference). | Keep the custom contracts. This conclusion is limited to the reviewed API surface, not every Circle product or future release. |

## Why individual sends cannot replace settlement

This conclusion follows from our implementation and the documented Send operation:

1. [Escrow.sol](../src/Escrow.sol) records each deposited NFT's owner, rejects redeemed tickets and allows depositor-only withdrawal. Only Settlement may release tickets to replacement holders.
2. [IntentRegistry.sol](../src/IntentRegistry.sol) authenticates signed outcome conditions and reserves nonces. A generic transfer signature is not an authorisation to change ticket count, adjacency or the signed payment limit.
3. [Settlement.sol](../src/Settlement.sol) validates V0–V8 before transfers: live intent, custody, conservation, all seat conditions, signed budgets, exactly balanced payments and payment capacity.
4. Multiple legs for one owner are summed as signed amounts before collecting USDC. A debit of 80 and credit of 30 requires 50 from that owner; a transfer per leg would implement a different cash flow.
5. The transaction marks intents settled, pulls debtor USDC, pays creditors and releases tickets. If any later operation reverts, preceding effects revert too.

Calling `kit.send()` separately for each payment would place those payments outside that transaction. A later ticket failure would not undo an earlier successful send. Wrapping SDK calls in one JavaScript function does not make them one EVM transaction. App Kits can support funding around this boundary, but its documented Send API does not replace the boundary.

Approval is a spending allowance, not a reservation. The backend's simulation does not lock balances, tickets or intent state; contracts revalidate at execution. See [backend details](../server/README.md) and the existing [rejection and owner-net tests](../test/Settlement.t.sol).

## Other Circle escrow and contract tooling

There **is** an official Arc [ERC-8183 escrow tutorial](https://docs.arc.io/arc/tutorials/create-your-first-erc-8183-job). Its reference flow creates a client/provider/evaluator job, funds a USDC budget, submits a deliverable hash and lets the evaluator complete the job. It also exposes a hook field. This is separate from the App Kit Send API.

Our assessment: that default job lifecycle does not enforce multiple ticket owners' signed replacement conditions, NFT conservation and owner-net payment balance. Implementing those through hooks or another evaluator would still require custom validation and custody integration. We have not prototyped such an extension and do not claim it cannot be built.

[Circle Contracts](https://developers.circle.com/contracts) provides deployment and interaction tools, including custom bytecode and standard token/NFT templates. It can operate custom contracts, but deploying through it does not supply RESHUFFLE's outcome checks. Circle's [wallet Modules](https://www.circle.com/modules-beta) describes wallet features such as session keys and spending limits; those are distinct from a ticket settlement module.

## Answer for the presentation

**English:** We evaluated Circle App Kits. Send supports USDC transfers on Arc, and Bridge and Unified Balance could support future wallet funding. Our core payment is conditional on every participant receiving their signed ticket outcome. The reviewed App Kit APIs do not supply those checks, so we retain one Settlement transaction that validates the conditions, nets USDC and releases the NFTs. We use Arc and USDC today; we do not claim App Kits integration.

**中文：** 我们评估过 Circle App Kits，它能做 Arc 上的 USDC 转账，也能支持未来的跨链入金。我们这里的付款必须和每个人签署的换票条件一起验证、一起执行。已查阅的 App Kit 接口不提供这些票务条件检查，所以当前保留自建 Settlement，在同一笔交易中完成条件验证、USDC 净额分配和 NFT 交付。我们已使用 Arc 和 USDC，但没有把“评估过 App Kits”说成“已经接入”。

## Review scope and follow-up

This review compared official documentation and sample descriptions with the repository's contracts, backend and dependency manifests. It installed no SDK, ran no App Kit transactions and changed no contract, allowance, wallet or environment variable. Existing settlement evidence demonstrates RESHUFFLE's implementation; it is not App Kits execution evidence.

Possible funding integrations and the conditions for revisiting them are recorded in [IDEAS.md](../IDEAS.md). Recheck the official API and chain-support pages when implementing one; package capabilities can change after this review date.
