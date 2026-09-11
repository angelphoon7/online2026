# Arc Mainnet deployment readiness

Updated **2026-09-10**. **Deployment tooling and local rehearsal are complete; Arc Mainnet deployment and production application cutover are pending.** This document is a reviewable release package, not a claim that mainnet contracts are deployed or that production security review is complete.

## Prize requirement: preparation is not deployment

The currently published [ETHOnline 2026 Arc prize page](https://ethglobal.com/events/ethonline2026/prizes#arc) lists Best DeFi/Onchain Finance Application and makes $2,500 of its award conditional on the same project being deployed to Arc Mainnet by September 30. It does not currently list the previously selected “Launch on Testnet & Push to Mainnet” category or state that a deployment-ready package substitutes for that condition. Treat the older “deployed or deployment-ready” wording as unconfirmed; this package does not establish eligibility or register a bounty.

The [Arc deployment model](https://docs.arc.io/arc/concepts/deployment-model) currently labels public testnet live and private/public mainnet upcoming. The [RPC reference](https://docs.arc.io/arc/references/rpc-endpoints) publishes testnet parameters and says mainnet parameters are published separately when available. Therefore **5042002 and the existing Testnet RPC are not used as mainnet defaults**. Recheck official documentation at release time; the older PRD's September 16 launch statement is not verified by these sources.

## Deliverables and current status

| Deliverable | Location | Status |
|---|---|---|
| Mainnet entry point | [`scripts/mainnet.mjs`](../scripts/mainnet.mjs) | Check, unsigned plan, explicit deployment, read-only verification |
| Deployment and verifier implementation | [`scripts/lib/mainnet-deployment.mjs`](../scripts/lib/mainnet-deployment.mjs) | Four CREATE transactions, three configuration calls, explicit gas/fee limits, journaled resume |
| Public network and role configuration | [`config/arc-mainnet.json`](../config/arc-mainnet.json) | Unknown mainnet fields deliberately `null`; confirmation flag false |
| Secret variable template | [`.env.example`](../.env.example) | Separate `ARC_MAINNET_RPC` and `ARC_MAINNET_PRIVATE_KEY`; existing `.env` remains private |
| Local deployment rehearsal | [`scripts/rehearse-mainnet.mjs`](../scripts/rehearse-mainnet.mjs) | Passed on temporary Anvil with fresh throwaway keys and MockUSDC |
| Saved rehearsal result | [`deployments/mainnet-rehearsal.json`](../deployments/mainnet-rehearsal.json) | Local chain 31337 only; not an explorer-verifiable Arc deployment |
| Contract validation and gas | [`docs/gas/README.md`](gas/README.md) | Existing 32-test suite passed; no Solidity changes for this package |
| Live integration evidence | [Testnet deployments](../deployments/arc-testnet.json), [settlements](../README.md#confirmed-arc-testnet-settlements), [offline proof](DEMO_OFFLINE.md) | Arc Testnet evidence; not mainnet receipts |
| Governance and application release | Checklists below | Pending |

The deployment script is JavaScript using viem and compiled Foundry artifacts; a second Solidity deploy script is not required. The existing [`script/Deploy.s.sol`](../script/Deploy.s.sol) and `arc:*` commands remain the Testnet deployment path. This package never rewrites the Testnet deployment manifest or frontend env values.

## Network configuration

Complete `config/arc-mainnet.json` only from confirmed Arc Mainnet information and the project's chosen deployment roles:

| Field | Required evidence / meaning |
|---|---|
| `officialParametersConfirmed` | Set true after reviewing the official mainnet references; a local attestation, not an automated certification |
| `chainId` | Official Mainnet chain ID; local IDs and 5042002 are rejected |
| `genesisHash` | Pin block 0's hash on the confirmed network, corroborated with an independent provider |
| `usdc` | Mainnet USDC ERC-20 interface from the [official address reference](https://docs.arc.io/arc/references/contract-addresses); do not infer from Testnet |
| `explorerUrl` | Official Mainnet explorer over HTTPS |
| `deployer` | Dedicated EOA whose key will sign all seven transactions; it becomes the three admin addresses |
| `issuer` | Address authorized to issue real ticket metadata; explicitly chosen, not automatically the deployer |
| `adminModelAcknowledged` | Must be true after reviewing the actual privileged powers below; does not implement governance hardening |
| `maxFeePerGasWei` | Operator's maximum permitted gas price / EIP-1559 fee cap in native base units; no guessed default |
| `deployGasLimit`, `configureGasLimit` | Explicit per-transaction budgets, currently 8,000,000 / 500,000; these are caps, not measured gas usage |
| `confirmations` | Receipt confirmation count, currently 2; review against the final network's finality guidance |
| `sources`, `checkedOn` | Official source URLs and review date |

Supply the private endpoint and deployer credential through environment variables or the existing ignored local `.env`:

```dotenv
ARC_MAINNET_RPC=
ARC_MAINNET_PRIVATE_KEY=
```

No additional `.env.mainnet` file is needed. No key belongs in JSON, `NEXT_PUBLIC_*`, a command argument, screenshot or committed manifest. Use a dedicated mainnet credential; do not reuse demo participant keys. The read-only `check`, `plan` and `verify` commands do not require a signing key. RPC credentials are not written into public deployment artifacts.

The current integration expects USDC gas amounts at 18 decimals and settlement ERC-20 amounts at 6 decimals. Confirm this on mainnet before cutover. Preflight checks the configured RPC chain ID, genesis hash, USDC `decimals()`/`symbol()`, deployer account type and block gas limit. Token metadata only corroborates the reviewed address; another contract can imitate those values. A native/precompiled token need not have ordinary ERC-20 bytecode, so metadata calls are checked rather than assuming `eth_getCode` must be nonempty for USDC.

## Build, rehearse, plan and deploy

Run from the repository root with Node dependencies and Foundry installed:

```bash
npm ci
forge build
forge test --gas-report
npm run mainnet:rehearse
```

On this workspace, the Foundry binaries also exist under `.tools/foundry/`. The rehearsal command finds the bundled Windows Anvil when present, otherwise uses `anvil` from PATH. It starts an isolated loopback-only chain, generates new throwaway credentials, deploys mock USDC and runs the real deployment implementation. It never loads or uses `.env` keys, never forks Arc and stops Anvil on completion.

The rehearsal verifies successful deployment, immutable/public configuration, EIP-712 binding and runtime code. It also checks that resumption sends no duplicate transactions, the mainnet validator refuses local chain IDs, rehearsal refuses an external RPC, and the verifier rejects an altered address, altered runtime or changed settlement permission. Test-only permission tampering is restored before the final verification. The saved local transaction hashes are evidence of the local run, not live Arc hashes; its temporary chain is discarded.

After confirmed mainnet parameters and roles have been recorded:

```bash
npm run mainnet:check
npm run mainnet:plan
```

The current committed configuration intentionally fails `mainnet:check` with “Mainnet parameters are unconfirmed.” Once configured, `check` performs read-only preflight and verifies source/compiler artifact consistency. `plan` writes `deployments/mainnet-plan.json` with predicted CREATE addresses, exact unsigned calldata, nonces and gas budgets. **A plan is not a fork simulation.** It depends on the deployer's pending nonce and changes if the deployer transacts before deployment. Review the plan and run a rehearsal against the confirmed mainnet execution environment before release; local Anvil does not reproduce Arc precompiles or USDC restrictions.

The explicit transaction-sending command, for the release operator after the checklist is satisfied, is:

```bash
npm run mainnet:deploy
npm run mainnet:verify
```

No mainnet deployment was performed while preparing this package. `mainnet:deploy` signs only with `ARC_MAINNET_PRIVATE_KEY`, verifies it matches the configured deployer, simulates each transaction immediately before signing, supplies explicit transaction gas caps and enforces the configured fee ceiling and required balance. It verifies compiled source hashes and Paris/via-IR/optimizer settings. Current `paris` settings are the tested build target, not a permanent claim about mainnet EVM compatibility.

The deployment sequence is:

1. Create `TicketNFT`.
2. Create `Escrow(ticketNFT)`.
3. Create `IntentRegistry`.
4. Create `Settlement(registry, escrow, ticketNFT, usdc)`.
5. Set `Escrow.settlement` to the deployed Settlement.
6. Set `IntentRegistry.settlement` to the same Settlement.
7. Register the configured issuer in TicketNFT.

These are **seven separate transactions**, not one atomic deployment. No demo tickets, participant intents, allowances or seed balances are created. Keep participant deposits closed until verification and application checks complete.

### Resume and verification artifacts

- `.data/mainnet/journal.json` stores exact signed transaction bytes before submission. It is private and ignored by Git. Preserve it through interruptions; resuming resends the same signed bytes instead of allocating another nonce. Changes to config, artifacts or the saved plan cause a stop.
- `.data/mainnet/deploy.lock` prevents simultaneous CLI deployments. If a process is killed, first confirm it has stopped and inspect pending transactions before removing only the stale lock. Do not delete the journal to retry.
- `deployments/arc-mainnet.json` is produced only after all receipts and verification pass. It contains public addresses, transaction hashes, receipt blocks, code hashes and verification scope; it contains no private key or raw signed transaction.
- `mainnet:verify` checks successful receipts and block inclusion, confirmations, exact creation/configuration calldata, sender, chain ID, nonce, addresses and gas caps. It compares compiled runtime code outside constructor-specific immutable slots, then checks all corresponding getters and the EIP-712 domain. It also checks all three admins and the intended issuer. It does not mutate chain state.

Do not let another tool use the deployer nonce during this sequence. A failed, replaced or underpriced transaction requires inspecting the saved transaction and nonce; the script does not silently raise fees, replace it or declare partial deployment successful. If contracts are already deployed when a later step fails, resume that deployment after diagnosis. There is no automatic rollback of earlier CREATE transactions.

## Actual permissions and trust assumptions

The following describes the existing source, not proposed future governance. All three `admin` variables are initialized to the creating account. **There is no admin transfer, renounce or timelock function.** The supplied mainnet deployer intentionally supports direct EOA deployment only; deploying through a Safe or factory would change `msg.sender` and therefore the resulting admin. A multisig handoff cannot be claimed or performed by configuration alone.

| Actor / contract | Actual authority | Consequence and release consideration |
|---|---|---|
| TicketNFT admin | `registerIssuer(address)` can add issuers repeatedly | Admin can expand who mints tickets. No issuer removal or admin rotation function exists. |
| Registered issuer | Mint tickets with event/session/section/row/seat metadata | Issuer controls the meaning and authenticity of seats. The contract enforces mask width, not real venue inventory uniqueness. |
| Ticket holder | ERC-721 approvals/transfers and `redeem` | Redemption is holder-only. A redeemed ticket cannot be deposited or used for settlement. |
| Escrow admin | `setSettlement(address)` can change the release authority repeatedly | **Admin can point at arbitrary code/an EOA that then calls `releaseBatch` to release deposited NFTs without signed-condition validation.** This is a custody trust assumption. |
| IntentRegistry admin | `setSettlement(address)` can change who calls `markSettled` | Admin can appoint another caller able to mark LIVE intents SETTLED, bypassing the normal settlement workflow. |
| Configured Settlement | Release escrow batches and mark intents SETTLED | Current Settlement validates V0–V8 before effects/interactions; that guarantee assumes the wiring has not been replaced by admins. |
| Settlement contract itself | Immutable registry/escrow/NFT/USDC references; no owner or upgrade method | No proxy upgrade, pause switch, solver allowlist or administrative price setting exists here. Changing the other contracts' authorized settlement is a separate privileged path. |
| Participant | Sign conditions; revoke own intent; withdraw own escrowed tickets; control USDC allowance | Approvals are spending allowances, not reservations. Withdrawal does not revoke an intent; later settlement checks current custody. |
| Anyone / solver | Relay valid signed commits; submit `settle(intents, legs)` | Commit authenticates the owner's EIP-712 signature. Settlement does not need new participant signatures; invalid proposals revert and the proposer pays gas. |
| Backend operator | Host solver/discovery/evidence endpoints and hold provider API keys | Controls availability/discovery, not validity under the configured contracts. Production backend should not receive deployer or participant credentials. |

The current admin setters also use bare `require(msg.sender == admin)` rather than named authorization errors, contrary to the target convention. They emit no dedicated admin/issuer-configuration events. Do not claim all access failures are named or that an event-only monitor can detect every permission change. Read these getters periodically or inspect transactions as part of monitoring.

**Production governance decision remains open.** Before accepting real participant deposits, resolve the mutable custody/registry authority and non-rotatable admin/issuer keys through a reviewed design, or explicitly document an accepted custodial operating model. Merely changing `adminModelAcknowledged` does not resolve this. Contract hardening would change artifacts and require new tests, deployment, gas measurements and fresh intents. No security audit, irreversible wiring lock or multisig control is claimed for the present contracts.

## Deployment verification checklist

### Before broadcasting

- [ ] Confirm the current bounty category, September 30 requirement and submission timezone with the official submission materials; record any organizer clarification.
- [ ] Populate and review official mainnet network/USDC/explorer references, independently confirm the genesis hash, and commit public config without keys.
- [ ] Resolve the governance/admin model above; choose the actual deployer and issuer and document key custody/recovery. Existing contracts cannot rotate these administrators.
- [ ] Freeze a source revision and dependencies; `forge build`, the complete rejection suite and `forge test --gas-report` pass with recorded compiler settings.
- [ ] Confirm mainnet bytecode compatibility, USDC decimals/allowance/transfer behavior and relevant restricted-transfer failures against the actual network. Local mock tests alone are insufficient.
- [ ] Complete an external security review appropriate to real custody, including admin bypasses and callback/reentrancy behavior.
- [ ] Run `mainnet:rehearse`; review its public result, then complete a confirmed-network rehearsal without accepting user funds.
- [ ] Run `mainnet:check` and `mainnet:plan`; review all seven operations, predicted addresses, issuer/admin powers, fee ceiling, funding and deployer nonce exclusivity.

### After deployment, before enabling deposits

- [ ] All seven transactions have successful confirmed receipts on the intended chain; `mainnet:verify` passes and its manifest is committed.
- [ ] Confirm four nonempty runtime code deployments and independently verify source with the official explorer/provider, preserving exact compiler settings and constructor arguments.
- [ ] Confirm `TicketNFT.admin`, `Escrow.admin`, `IntentRegistry.admin`, the configured issuer, both settlement permissions, and all Settlement immutable getters.
- [ ] Confirm `DOMAIN_SEPARATOR` equals EIP-712 `{name: RESHUFFLE, version: 1, chainId: mainnet chain ID, verifyingContract: new registry}`.
- [ ] Complete the [signature migration acceptance checks](#eip-712-domain-and-signature-migration), including rejection of old-domain signatures and a successful fresh-domain commit.
- [ ] Publish real mainnet addresses, deployment hashes, start block, source-verification links, governance disclosure and verification timestamp. The local rehearsal manifest must never be presented as the mainnet manifest.
- [ ] Complete frontend/backend/indexer cutover below, then exercise controlled mint/deposit/commit, valid settlement, named rejection, revoke/withdraw and holder-only redemption with minimal controlled inventory; save actual receipts.
- [ ] Test payment balances/allowances and RPC failure handling, monitor admin wiring and intent/ticket state, and document the incident contact and recovery procedure.

Explorer verification is a separate step from the bytecode/getter checker. When the official explorer's verifier endpoint and supported verifier are known, use `forge verify-contract` with the actual chain ID, endpoint, compiler `0.8.36`, optimizer/via-IR/Paris settings and encoded constructor arguments. See `forge verify-contract --help` in the installed toolchain. Constructor arguments are: none for TicketNFT and IntentRegistry; TicketNFT address for Escrow; Registry, Escrow, TicketNFT and USDC addresses in that order for Settlement. No unconfirmed explorer API URL is baked into this package.

## EIP-712 domain and signature migration

**Changing networks or deploying a new IntentRegistry requires every participant to authorize the new domain again.** An old signature is not portable to that deployment. This protects the correctness of outcome authorization; changing an RPC URL or copying stored intents is not a migration.

The current [`IntentRegistry` constructor and `commit()`](../src/IntentRegistry.sol) and [`frontend signer`](../lib/contracts.ts) use:

| Domain field | Contract binding | Frontend value |
|---|---|---|
| `name` | `RESHUFFLE` | `RESHUFFLE` |
| `version` | `1` | `1` |
| `chainId` | `block.chainid` at Registry construction | `BigInt(CHAIN.id)`, sourced from `deployments/<network>.json` |
| `verifyingContract` | `address(this)`: the deployed **IntentRegistry** | `CONTRACTS.intentRegistry`, sourced from `deployments/<network>.json` |

`verifyingContract` is not the Settlement address. Registry verifies the signature once in `commit()` and reserves the owner's nonce. Later, `settle(intents, legs)` checks the committed hash and LIVE state through its configured Registry; it does not request or verify another participant signature.

```text
domainSeparator = hash(EIP712Domain(name, version, chainId, verifyingContract))
signingDigest   = keccak256(0x1901 || domainSeparator || hashIntent(intent))
```

`hashIntent(intent)` is the struct hash and does **not** include the domain. Identical intent fields can therefore have the same struct hash in different registries while their signing digests differ. Scope stored signatures, LIVE-state lookups, pending proposals and evidence by at least `(chainId, intentRegistryAddress, intentHash)`; a matching bare intent hash is not evidence that the new Registry accepted the old authorization.

For Testnet → Mainnet, obtain the confirmed mainnet chain ID and **new Registry address** from the verified deployment, update the frontend domain and deployment/RPC configuration together, then rebuild and redeploy the frontend. Recreate the intended inventory/custody on the target chain, read `usedNonce(owner, nonce)` from the new Registry, have each participant sign the new domain, relay fresh commits, and only then expose those intents to the solver. Old ticket custody, commitments and nonce reservations do not migrate automatically.

The existing `signAndCommitIntent()` constructs the domain from frontend configuration; it does not compare that domain with `DOMAIN_SEPARATOR()` before prompting the wallet. An unused pre-signing RPC read was removed; it was not a mismatch guard. [`mainnet:verify`](../scripts/lib/mainnet-deployment.mjs) does check the deployed Registry's domain against its deployment config; the frontend's exact built configuration and wallet network still need the acceptance checks below. Browser chain reads use the same-origin, read-only `/api/rpc` route, whose upstream is the backend's configured `ARC_RPC`.

### Signature migration acceptance checks

- [ ] Add the target deployment record under `deployments/`, register it in [`lib/deployment.ts`](../lib/deployment.ts), regenerate the public slice (`npm run deployment:public`) and point `NEXT_PUBLIC_DEPLOYMENT` at it. Rebuild/redeploy the frontend and retire stale browser bundles and cached signing requests.
- [ ] Confirm wallet `eth_chainId`, backend RPC chain ID and configured chain ID agree. Calculate the domain separator from the frontend's four actual signing fields and compare it with the target Registry's `DOMAIN_SEPARATOR()` before enabling signing for the release. A mismatch must block signing; the current frontend comparison still needs implementation for this release gate.
- [ ] Clear or segregate old signatures, queued commits, LIVE-state caches, solver proposals and evidence by chain/Registry. Fetch state and available nonces from the new Registry; do not label old records as LIVE there.
- [ ] In a controlled test, sign an otherwise valid intent for the old domain using a nonce unused on the target. Replay it via `commit()` against the target domain and assert the named `InvalidSignature` error. Cover a different chain ID and a different Registry address separately; use a well-formed intent so an earlier shape/nonce rejection cannot masquerade as signature protection.
- [ ] Sign for the exact target domain with the intended owner; confirm a successful `commit()` receipt and LIVE state in that Registry. Then verify solver simulation and settlement use those target commitments, with no second participant signature needed at settlement.
- [ ] If retiring the old authorization, revoke the original LIVE intents on their original Registry and verify their state there; withdraw original escrowed tickets if appropriate. Changing the frontend network does not revoke old commitments or invalidate already accepted authorization on the old deployment.

Replacing an RPC provider while keeping the same chain ID and Registry address leaves the domain unchanged. Redeploying only Settlement while retaining the existing Registry also does not change this domain or automatically revoke LIVE intents; it changes the privileged wiring described above. These distinctions prevent both replay mistakes and a false promise that a migration silently cancels the old market.

## Frontend, backend and indexer cutover

Deployment alone does not migrate the working app. The current hosted workflow and recorded demos are deliberately Testnet-specific:

- [`server/chain.ts`](../server/chain.ts) currently requires chain ID 5042002 and fixes the Testnet USDC address. Replace that restriction with a validated mainnet configuration only in the reviewed release; changing `.env` alone will make it reject mainnet.
- [`lib/config.ts`](../lib/config.ts) currently names the chain Arc Testnet. Update its network name, native currency settings and public RPC/chain/USDC/contract values together. Review wallet chain switching, explorer links and Testnet labels throughout the UI.
- Set `startBlock` in the new deployment record to the first mainnet deployment block and bind backend receipt verification to the new chain and contract addresses. Keep backend RPC credentials server-side and use a separately approved public browser endpoint.
- Follow the [EIP-712 domain and signature migration procedure](#eip-712-domain-and-signature-migration): collect new-domain signatures and commits, segregate old cached state, and explicitly retire any old authorization that should no longer execute.
- Recorded `/demo/*` proofs and `deployments/arc-testnet.json` remain explicitly labeled historical Testnet evidence. Do not rewrite them as mainnet proofs. Retire Testnet write actions from a mainnet-facing release and keep any demo site separate.
- If using The Graph, confirm **Arc Mainnet** support independently of Arc Testnet; deploy a separate subgraph with the new network, addresses and start block. Do not point mainnet discovery at the Testnet index. RPC discovery currently works without a subgraph but must use the correct mainnet chain/config.
- Build and host the working frontend **and backend**, then verify end-to-end from a fresh wallet session. Solver evidence must identify the actual source, block, candidates, simulation and receipt.

These application changes are release gates, not changes silently applied to the current Testnet demo by the deployment tool.

## Incident and rollback limits

Before configuration completes, do not open deposits. Stop after a failed check and inspect receipts/journal; contract deployments cannot be undone. If abandoning a partial deployment, publish that fact and use a separately tracked release only after reviewing the remaining admin powers.

Once participants use a deployment, there is no contract pause and no atomic rollback to an earlier release. Taking the website offline does not prevent direct contract calls. Participants can revoke and withdraw where custody remains intact; stop solver submission, notify affected users, and inspect actual permissions and balances. Do not switch settlement addresses as an unexplained “upgrade”: the admin capability itself changes the security boundary. A new deployment requires new addresses, fresh participant authorization and an explicit migration plan.

Readiness evidence should be presented as: **Testnet execution proven; deployment automation rehearsed; official mainnet parameters, governance/security decisions and application cutover pending.** Only publish a mainnet deployment claim after the actual mainnet manifest and end-to-end verification exist.
