# Planning artifacts and provenance

These files describe how RESHUFFLE was directed and built. The supplied Graph plan is a
planning input, not proof that its sample paths, API shapes, measurements or future steps
were implemented. Follow the [README](../README.md#the-graph) for current executable setup.

| Artifact | Purpose / provenance |
|---|---|
| [RESHUFFLE_PRD.md](RESHUFFLE_PRD.md) | Product requirements and enforceable conditions |
| [RESHUFFLE_TRD.md](RESHUFFLE_TRD.md) | Technical design and validation order |
| [RESHUFFLE_BRIEF.md](RESHUFFLE_BRIEF.md) | Product brief |
| [AGENTS.snapshot.md](AGENTS.snapshot.md) | Copy of root [AGENTS.md](../AGENTS.md), captured for this submission package |
| [SKILL.snapshot.md](SKILL.snapshot.md) | Copy of root [SKILL.md](../SKILL.md); its relative reference paths resolve at the repository root |
| [Contract reference](../references/contracts.md), [solver reference](../references/solver.md), [demo reference](../references/demo.md) | Supporting project skill specifications |
| [UI_IMPLEMENTATION.md](UI_IMPLEMENTATION.md) | Implemented UI flow, controls and contract mappings |
| [UI_FLOW.original.md](UI_FLOW.original.md) | Unmodified original user-supplied UI flow prompt; later requirements supersede parts of it |
| [INTENT_STEPPER.original.md](INTENT_STEPPER.original.md) | Unmodified original user-supplied single-column stepper prompt; later requests changed step order and count |
| [RESHUFFLE_GRAPH_PLAN.md](RESHUFFLE_GRAPH_PLAN.md) | Unmodified user-supplied Graph integration plan copied from the supplied Downloads file |
| [DEMO_GRAPH.md](DEMO_GRAPH.md) | Working Graph rehearsal and recording plan |
| [STEP_11_REVIEW.md](STEP_11_REVIEW.md) | Checked implementation, evidence and differences from the supplied plan |

The snapshots preserve the submitted instructions; the root versions remain the working
instructions. This index does not claim that every historical prompt is present. The two
available original UI/stepper attachments are included above. Include any additional prompts or
design assets used by other team members before final submission. Never include `.env`,
private keys, deployment keys or private signing journals in that export.
