# Preparing the Arc demo

From the repository root, with dependencies installed and the four Arc contracts already deployed:

```bash
npm run demo:prepare
```

This builds the TypeScript solver, verifies the configured deployment, and reuses the current round if all three intents are LIVE, unexpired for at least another day, and a three-participant settlement passes `eth_call`. The result is real pending chain state. No settlement is sent by this command.

If another round is needed, the wrapper runs `script/SeedDemo.s.sol` against the existing Arc contracts. It mints twelve tickets only for an initial empty inventory; otherwise it reuses the twelve demo tickets in their current owners' wallets or escrow. It deposits four per participant, grants the debtor's required USDC allowance, signs and commits three EIP-712 intents using fresh nonces, and verifies the resulting state. Each participant wants the next participant's adjacent four-ticket bundle. The signed payment limits are pay at most 0.10 USDC, pay at most 0 USDC, and receive at least 0.10 USDC. The solver derives the actual proposal from those conditions.

The script uses `paris`, explicit per-call gas limits, and a 30,000,000 script execution budget. These are configuration values, not measured gas consumption. Participant gas top-ups use native USDC at 18 decimals; ERC-20 settlement amounts use 6 decimals.

## Local configuration

- `.env`: existing `ARC_RPC`, `ARC_CHAIN_ID=5042002`, `PRIVATE_KEY`, and the four `NEXT_PUBLIC_*` contract addresses matching `deployments/arc-testnet.json`. The operator key must match the deployment's issuer/deployer.
- `.env.seed`: `SEED_B_PRIVATE_KEY` and `SEED_C_PRIVATE_KEY`. Existing demo wallets require their original keys. For a genuinely empty initial inventory, the command generates missing participant keys and saves them here. Back up this ignored file locally.
- Fund the operator with Arc test USDC using the [Circle faucet](https://faucet.circle.com/). The command checks a 3.1 USDC minimum before preparing a new round and tops up B/C to 1 native USDC each if needed. This threshold is a setup budget, not a gas estimate. No extra token is needed.
- Foundry must be installed; the wrapper also supports the existing `.tools/foundry/forge.exe` installation. Dependencies and the compiler version come from `foundry.toml`.

No participant keys belong in `NEXT_PUBLIC_*`, browser storage, or a hosted backend. `.env.example` remains a template. The seed command reads `.env` and `.env.seed`, while Next.js uses its normal env precedence; keep any `.env.local` overrides consistent with the same Arc deployment.

## What a judge opens

```bash
npm run dev
```

Open `http://localhost:3000/demo`. The homepage links there. No wallet connection is required to read the three committed intents, run the backend solver, or view simulation and evidence. The frontend uses `GET /api/demo` for current intent status and `POST /api/solve` for discovery, chain checks, bounded search and simulation; outcomes are not loaded from a saved proposal.

Uncheck a participant and run the solver again. This excludes that intent from the search without revoking it or modifying signed conditions. To change a signed budget or revoke an intent on-chain, use its owner's wallet in the normal `/reshuffle` flow. The shared demo keys stay with the operator.

To execute, connect any funded Arc Testnet proposer wallet and click **Submit Settlement**. The backend checks fresh state and simulates again; the wallet signs the settlement transaction. Conditions are revalidated by the contract at execution. Once the backend verifies the successful receipt, the UI displays the USDC net distribution and its sum, separately from gas.

For remote judging, deploy the Next.js server, its server-side Arc settings, the public `deployments/demo-ready.json`, and the built solver. `npm run build` builds the solver automatically. A static-only export cannot run `/api/solve`. Share the hosted `/demo` URL. A localhost URL is not accessible to remote judges.

## Repeating a recording and recovery

Run the same `npm run demo:prepare` command after settlement or before expiry. It finds the twelve tickets' current holders, uses unused nonces, revokes the previous demo's LIVE intents when replacing them, and prepares the next round. Already-ready rounds are reused. Tickets redeemed or transferred outside the three local demo wallets cause a clear failure instead of quietly minting substitute inventory.

The public manifest is updated only after all three new intents are LIVE and a real candidate passes simulation. `deployments/arc-seed-evidence.json` records the verification block and result. Neither artifact guarantees future availability: withdrawal, revocation, expiry, spending the approved USDC, or another settlement can change it.

An interrupted seed retains `.data/demo-seed-plan.json` with stable ticket IDs, nonces and deadline. Rerun the command: the script skips completed mints, deposits, approvals and commits by checking chain state. Expired or mismatched pending plans stop for inspection. Do not delete a pending plan blindly after a partial broadcast.

Foundry traces and broadcast journals stay in ignored `.data/` and `broadcast/`; inspect `.data/demo-seed-forge.log` locally if a broadcast fails. Treat traces as private because they may contain signing inputs. Never attach them to a public issue.

For a read-only readiness check:

```bash
npm run demo:prepare -- --check
```

The shared round is consumed by a successful settlement. Refresh shows its actual state; the demo does not silently reset or claim another ready round. On a local server, the API reads an updated manifest on refresh. On an immutable host, reseed locally and redeploy the updated public manifest. Automatic public reseeding or a server-side signing wallet is not enabled.
