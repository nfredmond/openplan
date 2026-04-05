# OpenPlan Four-Priority Acceleration Plan — 2026-03-21

## Origin / grounding
Nathaniel's original OpenPlan thesis: a transportation + land use planning suite with community feedback, chained activity-model / transportation-demand modeling, external/public use, and AI integration with dashboards and reports. Source: `memory/2026-02-24-planning-saas.md#L56-L75`.

Current reality before this push:
- pilot-ready planning-domain v1 confidence ~85%
- original-plan coverage ~35%
- still early on community engagement, chained demand-model posture, AI-assisted workflow layer, and compliance/implementation tracking. Source: `openplan/docs/ops/2026-03-15-openplan-v1-command-board.md`.

## Immediate CEO directive
Finish these four priorities as aggressively as possible, using the full team, without stepping on each other's toes:
1. Social Pinpoint-like engagement module
2. AequilibraE / ActivitySim combo
3. LAPM-style project management + invoicing posture
4. AI chatbot / data-analysis integration

## Lane split (hard boundaries)
### Lane A — Engagement / public-input system
Worktree: `/home/nathaniel/.openclaw/workspace/openplan-worktrees/engagement-socialpinpoint`
Goal: extend current operator-facing engagement module into a more complete campaign/public-intake/reporting workflow.
Avoid touching modeling, LAPM/billing, or assistant internals.

### Lane B — Modeling stack
Worktree: `/home/nathaniel/.openclaw/workspace/openplan-worktrees/modeling-aeq-activitysim`
Goal: move from AequilibraE-only proof + architecture memo to working multi-engine stack scaffolding with real ActivitySim integration points and launch flow.
Avoid touching engagement/public portal or LAPM/invoicing UI.

### Lane C — LAPM / PM / invoicing
Worktree: `/home/nathaniel/.openclaw/workspace/openplan-worktrees/lapm-pm-invoicing`
Goal: create real project-controls surface and document/invoicing scaffolding aligned to Caltrans/LAPM-style operator needs.
Avoid touching engagement/public portal and modeling internals.

### Lane D — AI assistant / data-analysis integration
Worktree: `/home/nathaniel/.openclaw/workspace/openplan-worktrees/ai-assistant-integration`
Goal: create a real assistant surface integrated with OpenPlan records, runs, and report context.
Avoid touching LAPM billing details or engagement public portal.

## Acceptance standard
- Prefer real working slices over vague architecture.
- Every lane should produce code, validations, and at least one operator-visible working path.
- Keep claims honest: do not label anything complete if it is still doc-only.
- Minimize merge collisions by staying inside the assigned worktree and lane.
