# Step 11-C submission status

Updated 13 September 2026. This is a preparation record, not confirmation of publication,
eligibility or form submission. Public URLs are identified; backend readiness and the
actual team declarations remain pending.

| Item | Current evidence | Remaining action |
| --- | --- | --- |
| Public repository | [GitHub](https://github.com/angelphoon7/online2026) returned anonymous API HTTP 200 and `visibility: public`; [discovery record](checks/submission-public-discovery.json) | Push the reviewed changes and check the final submitted revision |
| Public frontend | [Live app](https://online2026.vercel.app/) returned HTTP 200 and RESHUFFLE HTML | Complete browser interactions after backend readiness is restored |
| Public backend | [Health endpoint](https://online2026.vercel.app/api/health) is reachable but returns 503; API routes share the frontend origin | Correct production configuration and rerun acceptance |
| Hosted acceptance | [Actual anonymous HTTP run](checks/hosted-acceptance.json) failed at health readiness; no model call or transaction was reached | Resolve the failure, obtain a real public PASS and perform the separate restart/laptop-off checks |
| Bounty names | Official Arc and Graph prize pages checked 13 September | Team confirms pool; select Arc and The Graph in the dashboard and retain the selection receipt |
| Start Fresh | First reachable Git commit is `8b42a57`, dated 6 September 2026 | Team must confirm when project-specific code, designs and assets actually began |
| AI / asset attribution | [Inventory and known facts](PROVENANCE.md) | Team fills missing tools, creators, sources and permission details |

## Exact partner choices

For a team eligible for Start Fresh:

- **Arc — Best DeFi/Onchain Finance Application**.
- **The Graph — Best AI Tooling or AI Use Case with The Graph (From Scratch)**,
  AI Use Case path, Start Fresh pool.

If there was pre-event project-specific work, document it and use the applicable Continuity
registration. The listed alternatives are **Arc — Best DeFi or Agentic Application** and
**The Graph — Best AI Tooling or AI Use Case with The Graph (Continuity)**. Do not choose
both pools or claim event eligibility from Git timestamps alone.

[Official prize categories](https://ethglobal.com/events/ethonline2026/prizes) and
[submission / Start Fresh / AI rules](https://ethglobal.com/events/ethonline2026/info/details).
The form permits selecting partner prizes; naming targets in README does not submit them.
The separate old Arc “Launch” label has been removed from the active README targets.

## Deployment handoff

The root [Vercel configuration](../vercel.json) installs both root and solver dependencies
and builds the real Next.js backend. A deployment requires a hosting account; no project,
URL, paid service or public access grant was created by this preparation.

If using Vercel, import the repository with its root as the project directory and use Node
22 or newer. Configure production Redis, client-IP identity and the necessary server-only
settings from [JUDGING_SETUP.md](JUDGING_SETUP.md). On Vercel use `AGENT_IP_SOURCE=vercel`.
Add API and signer credentials individually in the provider's secret settings; do not upload
the local env files or signing journals. Production and previews must not sign concurrently
with the same wallets. Preserve/migrate existing shared data before switching writers.

The actual frontend is [online2026.vercel.app](https://online2026.vercel.app/). Its backend
lives at the same origin under `/api/market`, `/api/solve`, `/api/agent/diagnose/...` and
`/api/agent/ask`. The hostname was discovered through the repository's public `homepage`
metadata, then requested without authentication. The app's judge access-code controls
still apply to judge operations.

Use the [online acceptance command](JUDGING_SETUP.md#verify-before-handing-it-to-judges)
after deployment. Local tests and successful builds cannot close this line item.
The [preparation check record](checks/step-11c-preparation.txt) is explicitly local;
it is not a substitute for the real public acceptance result.

### Actual hosting failure and next configuration step

The public health response has `ready: false`, `storage: null`, `snapshotBlock: null` and
false checks. `/api/demo/scenarios` also returned HTTP 503. In the checked source, a failed
`storageMode()` exits the main health checks before Graph, signers or issuer checks run;
those false flags do not establish separate failures of every service.

**Inference to verify in Vercel:** missing/invalid production storage selection is consistent
with this response. This workspace has no authenticated hosting connection to inspect the
actual variables or logs. Open the existing Vercel project's **Settings → Environment
Variables → Production**, configure `STORAGE_BACKEND=redis`, `REDIS_REST_URL` and
`REDIS_REST_TOKEN`, plus `AGENT_RATE_LIMIT_STORE=redis` and `AGENT_IP_SOURCE=vercel`.
Use an actual HTTPS Redis REST endpoint and private token, not the template placeholders.
The full judge/issuer/Graph/model settings are listed in [JUDGING_SETUP.md](JUDGING_SETUP.md).
Redeploy after changing settings, then rerun the hosted check. Do not switch to local file
storage or disable admission checks to make health appear ready on Vercel.

## Team declaration to complete

Record the declaring team member and date with the final answers:

1. Actual project start date; any pre-event project-specific code, designs or assets.
2. The event pool registered in the dashboard and final partner/category selections.
3. Every additional AI tool, starter kit, reused module and design source, with paths.
4. Creator/source and permission or license for each artwork group in `PROVENANCE.md`.
5. Public repository and frontend/backend URL, followed by the hosted acceptance record.

Unconfirmed answers remain unconfirmed. This checklist does not create authorizations,
licenses, source attribution or claims about actions the team has not taken.
