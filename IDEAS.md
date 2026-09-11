# Ideas outside the current demo scope

## Wallet funding with Circle App Kits

Status: evaluated, not implemented. See the [App Kits assessment](docs/APP_KITS_EVALUATION.md).

If participants need to bring USDC from another supported chain, evaluate App Kit Bridge or Unified Balance for funding their own Arc wallet before the existing settlement flow. A standalone same-chain funding requirement could use Send. [Official capabilities](https://docs.arc.io/app-kit).

Any implementation should wait for funding confirmation, reread Arc balance and allowance, then run a fresh solver simulation. Funding and settlement have separate transaction evidence. Do not send funding directly into the Settlement contract: its current flow pulls USDC from each net debtor. Do not present a multi-chain transfer as part of the ticket transaction's rollback guarantee.

Revisit adoption when this onboarding need exists, or when a documented module can preserve all existing signed conditions, NFT custody rules and owner-net payment behavior. Currency conversion and treasury yield remain outside the current scope.
