# Circle integration in RESHUFFLE

Updated: **2026-09-09**. This document records products actually used, their architectural role, and the reasons for excluding other Circle products from the first version.

| Product | Status | Layer and purpose |
| --- | --- | --- |
| **Arc L1 — Testnet** | Used | Execution and settlement: four deployed contracts verify signed ticket conditions, custody and payments. |
| **USDC** | Used | Native network gas and the asset for participants' net ticket payments. Users need no second token to pay ticket differences and gas. |
| **App Kits** | Evaluated; not integrated | The reviewed payment SDK APIs do not replace our NFT custody and conditional multi-owner settlement. |
| **CCTP / Gateway** | Not used | Cross-chain funding and balance abstraction are outside the first version's single-chain workflow. |
| **StableFX** | Not used | No foreign-exchange conversion is required; all signed payment limits and transfers use USDC. |

## Arc L1: settlement and contract execution

Network: **Arc Testnet**, chain ID **5042002**. Public RPC: `https://rpc.testnet.arc.io`.

The contract addresses and deployment transactions below are taken from the committed [deployment manifest](../deployments/arc-testnet.json). Each deployment is recorded there with a successful receipt. These are RESHUFFLE contracts deployed on Arc, not Circle-provided escrow templates.

| Contract | Deployed address | Deployment transaction | Block |
| --- | --- | --- | --- |
| TicketNFT | [0xb2490568bb27c9c38588e3b5511ee3980892cce4](https://testnet.arcscan.app/address/0xb2490568bb27c9c38588e3b5511ee3980892cce4) | [0x180d9a5501cc9a4d3ed5ad95523425627452758cf86cccf21624ce3c10ffafa0](https://testnet.arcscan.app/tx/0x180d9a5501cc9a4d3ed5ad95523425627452758cf86cccf21624ce3c10ffafa0) | 61264501 |
| Escrow | [0x07ab57380db7df630fab2d3d3a1019a5a890b018](https://testnet.arcscan.app/address/0x07ab57380db7df630fab2d3d3a1019a5a890b018) | [0xc5c42c944843e7df6771636b8bc1425627411e421221c5e5d4f3a4e06b63193b](https://testnet.arcscan.app/tx/0xc5c42c944843e7df6771636b8bc1425627411e421221c5e5d4f3a4e06b63193b) | 61264510 |
| IntentRegistry | [0x479b4455f494679dcdd6f6f32e93e08682deda75](https://testnet.arcscan.app/address/0x479b4455f494679dcdd6f6f32e93e08682deda75) | [0x9c4aa2932b945431527a2ec8ed328db2f8fc0f1733d826e4993a593b8fd52ded](https://testnet.arcscan.app/tx/0x9c4aa2932b945431527a2ec8ed328db2f8fc0f1733d826e4993a593b8fd52ded) | 61264518 |
| Settlement | [0x75872168f2d6ae13c7d9258159e59025fd9b5eae](https://testnet.arcscan.app/address/0x75872168f2d6ae13c7d9258159e59025fd9b5eae) | [0xfa2ef61fd1fbe309858ad70ca828ee0377b5e3605373ab7cfee968f23c5273fb](https://testnet.arcscan.app/tx/0xfa2ef61fd1fbe309858ad70ca828ee0377b5e3605373ab7cfee968f23c5273fb) | 61264529 |

[TicketNFT](../src/TicketNFT.sol) supplies seat metadata and redemption state. [Escrow](../src/Escrow.sol) holds deposited tickets and permits depositor-only withdrawal. [IntentRegistry](../src/IntentRegistry.sol) authenticates EIP-712 conditions and tracks commitment, revocation and settlement. [Settlement](../src/Settlement.sol) checks V0–V8, including exact ticket count, cohesion, adjacency, signed payment limits, conservation and payment capacity, before moving assets.

The [Node.js backend](../server/README.md) reads Arc state, searches and simulates. The submitting wallet broadcasts the transaction; contracts revalidate at execution. The backend then verifies the receipt against the proposed calldata and settlement events. Participants need not return to approve the discovered proposal, but their intents, tickets and payment capacity must remain valid.

## USDC: native gas and net settlement

Arc uses USDC for gas and exposes the same underlying balance through an ERC-20 interface at **`0x3600000000000000000000000000000000000000`**. Native amounts use 18 decimals; the ERC-20 interface uses 6. No wrapping step is required. [Official Arc USDC reference](https://docs.arc.io/arc/references/contract-addresses#usdc).

RESHUFFLE uses the native balance for the wallet's gas display and the ERC-20 interface for `approve`, allowance checks and settlement transfers. **Users can pay ticket differences and network fees with USDC, without obtaining a second token.** Gas remains an additional cost paid by the submitting wallet; the demo does not sponsor it.

Payment limits are signed in USDC. Settlement sums each owner's signed legs, collects only net debts, then distributes net credits. The sum of all participant payments must equal zero. This is verified alongside every ticket condition in the same transaction; a later revert rolls back its preceding payment and ticket effects.

After receipt verification, the [USDC distribution panel](../component/reshuffle/SettlementPayments.tsx) shows each wallet's net change: negative for payment, positive for receipt, and the computed **Σ = 0**. Gas is excluded from that distribution and from the signed ticket-payment limits. Values use integer arithmetic and the settlement token's six-decimal units.

## App Kits: evaluated, not integrated

The documented App Kit capabilities include Send, Bridge, Swap and Unified Balance, with Arc Testnet support. Send can transfer USDC between wallets; the reviewed API does not supply RESHUFFLE's signed seat predicates, NFT conservation or owner-net settlement checks. [Official App Kits overview](https://docs.arc.io/app-kit), [public API](https://docs.arc.io/app-kit/references/sdk-reference).

We therefore retain our Escrow and Settlement execution path. Separate SDK sends would not roll back when a subsequent ticket transfer fails. A future wallet-funding flow could use App Kits before settlement, if such an onboarding requirement is added.

The [full App Kits assessment](APP_KITS_EVALUATION.md) includes the capability comparison, the separate ERC-8183 escrow example, official sources and presentation wording. No App Kits integration or transaction is claimed by this project.

## CCTP / Gateway: excluded from the single-chain version

[CCTP](https://developers.circle.com/cctp) moves USDC between chains through burn-and-mint transfers. [Gateway](https://developers.circle.com/gateway) provides a unified USDC balance across supported chains. Neither is used by RESHUFFLE today.

All current tickets, intents and payment capacity are on Arc Testnet. Adding cross-chain steps inside the exchange would introduce separate chain transactions, funding completion and recovery states that are not covered by the existing settlement transaction's rollback. This would complicate the guarantee without adding a benefit to the current demo, whose participants already hold Arc USDC.

This does not rule out cross-chain onboarding: funding an Arc wallet first can leave the subsequent ticket settlement on one chain. If needed later, confirm the funding, reread the Arc balance and allowance, and simulate again. Keep the funding and settlement evidence separate. The deferred scope is recorded in [IDEAS.md](../IDEAS.md).

## StableFX: no currency conversion requirement

[StableFX](https://developers.circle.com/stablefx) is Circle's permissioned stablecoin FX platform on Arc. It combines offchain RFQ execution with onchain payment-versus-payment settlement, including USDC/EURC conversion.

RESHUFFLE has no currency pair to exchange: every participant expresses a reservation limit in USDC, and every net payment is USDC. Ticket preferences are subjective; the system does not compute a platform price for tickets or require an FX quote to decide whether a reshuffle satisfies its signed conditions.

Adding StableFX would introduce a currency-conversion and quote workflow without satisfying an unmet requirement. Its FX escrow is not a replacement for NFT seat checks and custody. We use no StableFX API, quote, liquidity provider or contract. Reassessment would make sense only if a future version accepts or pays out different currencies.

## Reviewable evidence

- Architecture: [standalone SVG](diagrams/architecture.svg) and [4K PNG](diagrams/architecture.png).
- Deployments: [four-contract manifest](../deployments/arc-testnet.json).
- Execution: [ten confirmed settlement hashes](../README.md#confirmed-arc-testnet-settlements), [per-round evidence](../deployments/settlements/) and [saved audit results](../deployments/settlement-audit.json).
- Implementation: [backend API and simulation](../server/README.md), [contract validation tests](../test/Settlement.t.sol).

Arc deployment does not by itself imply use of Circle Wallets, Circle Contracts APIs, App Kits or other SDKs. This document describes the repository's actual integration boundary. This documentation update cross-checks saved deployment records; it does not claim a new live RPC audit or mainnet deployment.
