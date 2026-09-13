# AI, source and asset provenance

Prepared 13 September 2026 from the repository and this conversation. **Team attestation is
incomplete.** A user supplying a file establishes how it reached this session, not its author,
license or production date. Git addition times are not proof of when original work began.

## Human and AI contribution

The user supplied the product objective, enforceable outcome requirements, demo requirements,
Graph plan, UI prompts, screenshots, artwork files and iterative acceptance corrections.
Codex assisted with implementation, debugging, regression checks and documentation under
those instructions. This conversation confirms assistance in these groups:

| Area | Files / evidence |
| --- | --- |
| Market UI and supply | `component/market/Market.tsx`, `lib/section-supply.ts`, `server/market.ts`, inventory scripts and UI regression checks |
| Graph pagination | `shared/graph/pages.ts`, `shared/graph/queries.ts`, pool/market adapters and `server/__tests__/graph-pagination.mts` |
| Agent integrity | `server/agent/`, `server/solve-hypothetical.ts`, Agent API handlers and guard, request, block and integrity tests |
| Drawer evidence | `lib/agent-evidence.ts`, `component/market/AgentDrawer.tsx`, `component/market/AgentToolEvidence.tsx` and drawer tests |
| Acceptance tooling | `scripts/check-agent-model.mts`, `scripts/lib/agent-model-transport.mts`, Graph/Arc check scripts and saved verification records |
| Teammate / submission setup | `scripts/setup-env.mjs`, `scripts/judge-setup.mjs`, `scripts/check-docs.mjs`, README, submission/readiness documents and architecture export labels |

The table identifies known assisted areas; it does not assign authorship of every line or
claim that no other tools were used. Team members must add Claude Code, Cursor, Copilot,
image tools or other assistance used outside this conversation, with affected paths and scope.
Claude via Anthropic's API is also used **at runtime** for tool selection and evidence-bound
narration. That usage is separately documented and does not establish coding authorship.

[Supplied specifications, instruction snapshots and original UI prompts](PLANNING_ARTIFACTS.md)
are included in the repository. Their original authors and any additional private planning
artifacts remain a team declaration.

## Artwork inventory

| Files | Known source / use | Missing confirmation |
| --- | --- | --- |
| `lib/sarah_concert_poster.jpg`, `lib/mayday_concert_poster.jpg`, `lib/taylor_concert_poster.png` | User explicitly supplied these three files as concert posters; imported by the market UI | Original creator, source URL, permission/license and when obtained |
| `lib/mayday_ticket.jpg` | Repository ticket image | Creator/source/license; whether part of the published demo |
| `public/logo.png`, `public/logo-user-upload.png`, `public/logo-user-new.png`, `public/logo-orig.png` | Logo and stored variants; market imports `public/logo.png` | Which version is original, creator, any AI tool/prompt and rights |
| `public/ticket-mask.png`, `public/ticket-darkblue.png`, `public/ticket-ribbon.png`, `public/ticket-ribbon-transparent.png` | Ticket visuals; animated ticket UI loads the mask | Creator/source, AI or manual production, license |
| `lib/ticket-mask.png`, `lib/ticket-mask-padded.png`, `lib/ticket-darkblue.png`, `lib/ticket-ribbon.png`, `lib/ticket-ribbon-transparent.png` | Related ticket artwork variants | Source relationship and permission for each original |
| `public/wave_frame_0.png`, `public/wave_frame_1.png`, `public/wave_frame_2.png` | Stored frame images | Creator/tool/source and whether used in published output |
| `app/favicon.ico` | Browser icon in the app tree | Original source/creator; confirm whether retained from a starter |
| `docs/diagrams/architecture.png`, `docs/diagrams/architecture.svg` | Repository architecture export from project source; labels updated with Codex assistance | Team confirms any earlier contributions to the source diagram |
| `docs/diagrams/offline-authorized.png` | App screenshot written by `scripts/lib/offline-browser.mjs` | Visible UI artwork keeps its separate provenance requirements |
| `docs/checks/graph-budget/*.png`, `*.webm` | Recorded local app evidence described in `GRAPH_APPLY_BUDGET.md` | Retain the original evidence; these are not proof of ownership of artwork visible in the app |

No artist, ticket issuer or event endorsement is asserted. Sources and permissions still need
to be supplied; this file does not label unknown images as original or licensed. Keep the
existing files while the team resolves those facts; any replacement is a separate UI change.

## Reused software and fonts

Two copied/adapted visual components are attributable to **React Bits, David Haz**:

| Local file | Upstream source | Check on 13 September 2026 |
| --- | --- | --- |
| `component/market/ShinyText.tsx` | [TypeScript/Tailwind ShinyText](https://github.com/DavidHDev/react-bits/blob/main/src/ts-tailwind/TextAnimations/ShinyText/ShinyText.tsx) | Matches the downloaded source after removing whitespace and the local `use client` directive |
| `component/market/SpecularButton.tsx` | [TypeScript/Tailwind SpecularButton](https://github.com/DavidHDev/react-bits/blob/main/src/ts-tailwind/Components/SpecularButton/SpecularButton.tsx) | Adapted implementation with matching shader and component structure; not byte-identical to current upstream |

The upstream [license](https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md) names
MIT + Commons Clause License Condition v1.0. Its notice is retained in
[docs/licenses/REACT_BITS.md](licenses/REACT_BITS.md). These components are reused work,
not claimed as team-original code. The original import revision/date remains a team fact;
the comparison above identifies the source checked today, not the historical import version.

The project uses Next.js, React/React DOM, viem, Motion, ogl and the Anthropic TypeScript SDK,
plus the build/test tools listed in the root and solver package manifests/lockfiles. These are
dependencies, not project-original code. Preserve their upstream license notices when
redistributing. The lockfiles record the installed versions.

Foundry dependencies are declared in [`.gitmodules`](../.gitmodules):
[OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) and
[forge-std](https://github.com/foundry-rs/forge-std). The UI imports the Basic font stylesheet
from Google Fonts in `app/globals.css`. The upstream [Basic font license](https://raw.githubusercontent.com/google/fonts/main/ofl/basic/OFL.txt)
identifies Sorkin Type Co and SIL Open Font License 1.1; this was checked on 13 September
2026. Retain the font's notices if redistributing its files.

No root project-wide license was found during this check. Choosing an open-source license
for team-owned code requires the team's agreement and does not license third-party artwork.
Add the selected license only after ownership and scope are confirmed.

## Eligibility evidence

The first reachable commit is `8b42a57` (`initialise`), with author timestamp
`2026-09-06T16:26:56+08:00`. That establishes the visible history boundary only. The team
must confirm whether the project was started during the event and disclose any earlier
project-specific source, designs or assets. See [submission status](SUBMISSION_STATUS.md).
