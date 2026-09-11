# RESHUFFLE — document set

Every file here is consistent with every other. `RESHUFFLE_BRIEF.md` from the earlier bundle
has been **deleted**, not updated — it carried retracted claims and an Intent struct with
`minCount`, and everything worth keeping in it now lives in the PRD.

| File | Purpose | Read when |
|---|---|---|
| `README.md` | Public face. Problem, solution, 26 Mermaid diagrams, tracks, Q&A, limitations | Judges read this. Keep it current |
| `docs/RESHUFFLE_PRD.md` | What the product promises, and what it explicitly does not | Before changing anything user-facing |
| `docs/RESHUFFLE_TRD.md` | How each promise is checked. Structs, V1–V8, tests, build order | Before writing contract code |
| `AGENTS.md` | Repository conventions for coding agents | Loaded every session |
| `skill/SKILL.md` | Claude Code skill: premise, order of work, traps, banned language | On any RESHUFFLE task |
| `skill/references/contracts.md` | Data structures, validation order, named errors | Writing Solidity |
| `skill/references/solver.md` | Search bounds, ranking rule, evidence chain | Writing the solver |
| `skill/references/demo.md` | Scenes, embedded proofs, integrity rules | Building the UI or recording |

## Installation

```
your-repo/
  AGENTS.md                    ← repo root
  README.md                    ← repo root
  docs/RESHUFFLE_PRD.md
  docs/RESHUFFLE_TRD.md
  .claude/skills/reshuffle-build/
      SKILL.md
      references/{contracts,solver,demo}.md
```

## Status

**Specification frozen.** Anything found from here is an implementation or test finding, not a
reason to reopen the design. The thesis is settled:

> Users authorise an acceptable settlement outcome once, rather than approving a specific
> proposed trade. Future inventory and counterparties can satisfy that persistent intent, while
> the contract independently enforces the signed ticket-bundle and cash constraints.

## The two sentences that generate everything else

**Outcome authorisation, not proposal authorisation.** The user signs once and leaves. They
never see the trade that executes.

**No promise without a check.** Every guarantee in the PRD is enforced in `Settlement`, or it
is removed from the PRD. A frontend promising adjacent seats while the contract accepts any
seats is the worst failure available to this project.

## Open items — resolve before or during day one

1. Arc Testnet RPC, chainId, USDC address, faucet.
2. What Arc accepts as *deployment-ready* — ask in their Discord. It decides whether the Launch
   prize is a target.
3. Whether one project may receive multiple Arc bounties.
4. Gas cost of settlement at realistic participant counts — measure, never estimate.

**Submission deadline: Sunday 13 September, 12:00 EDT.** The 16th is the event close and Arc's
public mainnet launch, not the submission cutoff.

Items 3 and 4 are one Discord message, and asking also puts the project in front of Arc before
judging.

## Known environment traps

- `foundry.toml` must set `evm_version = "paris"` — a current workaround for the documented
  open PUSH0 compatibility issue on Arc Testnet. Arc's own chain docs describe the execution
  environment as Prague, so this is a present-state workaround rather than a permanent property.
  Re-test the assumption before any mainnet deployment.
- `eth_estimateGas` is unreliable on some Arc USDC writes. Pass explicit gas limits before
  suspecting your own contract.
- Circle's `arc-escrow` sample has open community issues around object-level authorisation and
  refund robustness. Reference the architecture; do not copy the code as production-safe.
