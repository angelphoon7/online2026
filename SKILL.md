---
name: hackathon-execution-docs
summary: Generate hackathon-grade README.md, FULL_EXECUTION.md, sponsor mapping, and Mermaid diagrams for a build-from-scratch Web3 project.
description: Use this skill when the user asks for full execution docs, README.md, AGENT.md/agent.md, architecture diagrams, sequence diagrams, sponsor-track positioning, demo flow, or generated diagrams for a hackathon project. Optimized for AquaValve-style projects using 1inch Aqua/SwapVM with optional The Graph, World, Chainlink, Ledger, or Uniswap extensions.
---

# Hackathon Execution Docs Skill

## Mission
Create documentation that helps judges understand the project in one pass and helps builders execute without redesigning the idea.

The output must make clear:

1. **What the project is.**
2. **What problem it solves.**
3. **Which sponsor primitive is load-bearing.**
4. **What is implemented now vs planned later.**
5. **How to run the demo and tests.**
6. **What claims must not be made.**

For AquaValve, the core sentence is:

> Liquidity doesn't have to be all-in. AquaValve lets a maker decide how much goes live each block.

## First Actions
Before writing or editing docs:

1. Read project-specific instructions in `AGENT.md`, `agent.md`, `CLAUDE.md`, or `README.md` if present.
2. Read `PITCH.md`, `TEST_PLAN.md`, existing docs, and relevant contract names.
3. Inspect the repository tree.
4. Identify what is actually implemented.
5. Do **not** claim compile/test/deploy success unless logs or commands prove it.

If implementation status is unclear, label it explicitly as:

- `Implemented`
- `In progress`
- `Planned`
- `Stretch`
- `Not implemented`

## Required Outputs
When asked to create full project docs, generate or update:

```text
README.md
FULL_EXECUTION.md
PITCH.md
TEST_PLAN.md
SUBMISSION.md
FEEDBACK.md                 # only if a sponsor explicitly requires it
docs/diagrams/*.mmd         # Mermaid source of every diagram
public/diagrams/*.svg       # rendered diagrams, if mermaid-cli is available
scripts/render-diagrams.mjs # optional helper to render diagrams
```

Never embed only screenshots. The source `.mmd` files must exist so diagrams are reproducible.

## README.md Structure
Use this order unless the user asks otherwise:

1. Project name + one-line pitch.
2. The problem in plain language.
3. What the project does.
4. Why the sponsor primitive is load-bearing.
5. Architecture diagram.
6. Core execution flow.
7. Key contracts / files.
8. How to run tests.
9. Demo script.
10. Sponsor alignment.
11. Security boundaries / non-claims.
12. Current status.
13. Roadmap / stretch tracks.

The README must be judge-readable in under 5 minutes.

## FULL_EXECUTION.md Structure
This document is for builders and reviewers. Include:

1. System overview.
2. Actor list.
3. Contract responsibilities.
4. State machine.
5. Exact transaction flow.
6. Quote vs swap behavior.
7. Failure paths.
8. Test gates.
9. Demo sequence.
10. Deployment steps.
11. Known limitations.
12. Cut lines: what gets removed if time runs out.

## AquaValve-Specific Ground Rules
For AquaValve docs, preserve these claims exactly:

### Correct Claims
- AMMs made price programmable; AquaValve makes liquidity liveness programmable.
- `ACTIVENESS_XD` controls how much inventory is live for a block.
- Local `λ` controls per-position active reserves.
- Shared `Γ` / group envelope turns settlement-time overcommitment into quote-time deterministic capacity.
- Aqua's final ERC-20 transfer is still the hard payment constraint.
- AquaValve does **not** make an insolvent wallet solvent.
- Same-block exact-in trades may still execute; they continue on the consumed active curve.
- Same-block trades do not receive a fresh active slice.
- Exact-out must revert only when requested output is greater than or equal to the final effective output reserve after local λ and group coverage scaling.
- Coverage drops should shrink quotes, not brick quote calls.
- Decay controls how quickly price impact recovers; AquaValve controls how much inventory participates in repricing. They are orthogonal and composable.

### Forbidden Claims
Do not claim:

- AquaValve guarantees solvency.
- Selfie Check secures swaps or proves wallet ownership.
- Uniswap is required to make the Aqua project complete.
- A hard-coded opcode such as `0x92` is safe across deployments.
- Model tests equal Solidity integration tests.
- The project has passed compile/tests/deployment unless logs prove it.

## Sponsor Mapping Rules
Use sponsor integrations only when each sponsor owns a distinct structural layer.

Good mapping:

```text
1inch / SwapVM  -> execution primitive
Aqua            -> shared wallet position layer
The Graph       -> live capacity discovery layer
World           -> human step-up for exposure relaxation only
Ledger          -> hardware approval for exposure-increasing actions only
Chainlink CRE   -> private runtime headroom policy only
Uniswap v4      -> portability proof for local λ only
```

Bad mapping:

```text
World before every swap
ENS name badge only
Privy login only
Uniswap duplicate implementation with no shared state
Generic dashboard with no execution consequence
```

## Diagram Requirements
Every major README or FULL_EXECUTION document should include Mermaid diagrams. Use generated source files, not manually edited screenshots.

Recommended diagrams:

1. `01_architecture.mmd` — system architecture.
2. `02_execution_sequence.mmd` — transaction sequence.
3. `03_state_machine.mmd` — local λ and shared Γ state machine.
4. `04_failure_paths.mmd` — exactOut, coverage drop, group exceeded.
5. `05_sponsor_layers.mmd` — sponsor mapping.
6. `06_demo_flow.mmd` — 3-minute demo path.

### Mermaid Style
Use dark theme and clear colors. Prefer readable blocks over decorative complexity.

Default Mermaid header:

```mermaid
%%{init: {
  "theme": "dark",
  "themeVariables": {
    "background": "#0b0f14",
    "primaryColor": "#1f2937",
    "primaryTextColor": "#f8fafc",
    "primaryBorderColor": "#64748b",
    "lineColor": "#94a3b8",
    "secondaryColor": "#111827",
    "tertiaryColor": "#0f172a",
    "fontFamily": "Inter, ui-sans-serif, system-ui, sans-serif"
  }
}}%%
```

Use `classDef` for colored flowcharts:

```mermaid
classDef sponsor fill:#312e81,stroke:#818cf8,color:#ffffff,stroke-width:2px;
classDef core fill:#064e3b,stroke:#34d399,color:#ffffff,stroke-width:2px;
classDef risk fill:#7f1d1d,stroke:#f87171,color:#ffffff,stroke-width:2px;
classDef data fill:#164e63,stroke:#22d3ee,color:#ffffff,stroke-width:2px;
classDef user fill:#3f3f46,stroke:#d4d4d8,color:#ffffff,stroke-width:2px;
```

## Rendering Diagrams
If `@mermaid-js/mermaid-cli` is available:

```bash
npm install --save-dev @mermaid-js/mermaid-cli
node scripts/render-diagrams.mjs
```

If rendering fails, leave `.mmd` files and embed Mermaid code blocks directly in Markdown. Do not block the main submission on PNG/SVG rendering.

## Output Quality Bar
A document is complete only when:

- The first sentence is memorable.
- The problem is clear without jargon.
- Every sponsor integration has a removal test.
- All diagrams have Mermaid source.
- Test status is honest.
- Failure cases are documented.
- The demo can be rehearsed from the README alone.
- No sponsor is used as a sticker.

## Final Response Pattern
When done, summarize changed files and give the next execution command. Do not redesign unless asked.
