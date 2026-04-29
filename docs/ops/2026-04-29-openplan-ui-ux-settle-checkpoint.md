# OpenPlan UI/UX Settle Checkpoint

**Date:** 2026-04-29
**Owner:** Bartholomew Hale
**Sponsor:** Nathaniel Ford Redmond
**Status:** QA planning checkpoint; no app/runtime implementation authorized by this memo.

## Purpose

Let the current OpenPlan UI/UX overhaul settle before more implementation. The next lane should prove whether the product now reads as a civic planning workbench instead of a generic AI-SaaS dashboard, then queue only the smallest follow-up corrections needed to preserve that direction.

Canonical inputs:
- `docs/ops/2026-04-08-openplan-frontend-design-constitution.md`
- `docs/ops/2026-04-08-openplan-frontend-master-packet.md`
- `docs/ops/2026-04-08-openplan-frontend-execution-checklist.md`
- `docs/ops/2026-04-16-openplan-integrated-deep-dive-review.md`

Current posture: OpenPlan is a supervised-pilot Planning OS with real lane surfaces and visible UX coherence debt. The next UI work should be evidence-led QA and small guardrails, not a new design wave.

## Operating Boundaries

- Do not mutate live data, credentials, billing, email, auth sessions, or external services.
- Do not start a broad frontend refactor until the proof pack below exists.
- Do not add new visual language. Use the existing constitution: worksurface with rails, cardless by default, pill-light, dense but calm.
- Implementation is allowed only after a concrete screen fails one of the rejection criteria and the correction is narrowly scoped.

## Prioritized Next-Action Checklist

### P0 - Build the UI Proof Pack

Acceptance criteria:
- Capture populated-state screenshots for the app shell plus the highest-risk routes: dashboard, projects, plans/programs, reports, scenarios/modeling, data hub/map, engagement, grants, RTP, and admin/pilot readiness if reachable locally.
- Capture each priority route at desktop and mobile widths; add tablet only where layout changes materially.
- Record route URL, viewport, seed/demo state, auth/workspace context, and any missing local dependency.
- Store proof under a dated folder such as `docs/ops/2026-04-29-test-output/ui-ux-settle/`.

Proof expectation:
- Each screenshot must show the actual usable work surface, not a cropped hero, loading shell, empty placeholder, or marketing-only state.

### P1 - Run the Anti-Generic Review

Acceptance criteria:
- For each captured route, answer the execution checklist's core questions: workbench vs widget board, cards justified, pills reduced, one primary action, inspector/detail flow clear, hierarchy carried by layout/type/spacing/separators.
- Mark each route as `pass`, `watch`, or `fail`.
- Any `fail` must cite the specific visible problem and the smallest correction needed.

Proof expectation:
- A short route-by-route table is enough. Avoid broad redesign prose.

### P2 - Inventory Card/Pill/Badge Residue

Acceptance criteria:
- Inspect visible UI and code hotspots for default card grids, chip-heavy filters, badge farms, and repeated boxed wrappers.
- For remaining card-like containers, classify each as `interaction unit`, `summary block`, or `unjustified`.
- For pills/chips/badges, classify each as `status-critical`, `filter control`, `metadata noise`, or `unjustified`.

Proof expectation:
- Include file references only for items that need follow-up work. Do not generate a full component census unless a route fails.

### P3 - Confirm Worksurface + Inspector Behavior

Acceptance criteria:
- Where a route supports selection or review, selected-object detail should live in a rail, inspector, split pane, or document-like detail flow instead of scattering metadata boxes through the main surface.
- Primary actions must be visually singular per major area; secondary actions must be subordinate.
- Map and analysis surfaces must feel like instrumentation, not disconnected dashboard tiles.

Proof expectation:
- Screenshot annotations or concise notes should identify the selected object, primary action, and inspector/detail region.

### P4 - Queue Only Bounded Follow-Up

Acceptance criteria:
- Convert QA findings into at most five next actions.
- Each action must name one route or component family, the visible failure, the acceptance condition, and the smallest validation gate.
- Defer broad refactors, theme rewrites, and new feature work until the settle proof pack is reviewed.

Proof expectation:
- Follow-up list should be ready for a single-agent implementation lane without rediscovering the design doctrine.

## Explicit Rejection Criteria

Reject and rework a proposed UI change if the first rendered impression is any of the following:

- A generic SaaS card grid is the dominant page structure.
- Filters, actions, statuses, or metadata are mostly expressed as pill/chip clusters.
- Floating badges or micro-labels create decorative noise instead of clear status hierarchy.
- Multiple equal-weight CTAs compete in the same area.
- The screen is made of isolated dashboard boxes rather than a continuous worksurface.
- A map, report, scenario, or engagement surface is wrapped into decorative cards that make the core work feel secondary.
- The page looks polished but is slower to scan, compare, inspect, or act on than the prior version.
- Visual hierarchy depends primarily on shadows, gradients, rounded containers, or color accents instead of layout, typography, spacing, alignment, and separators.

## Definition Of Settled

The UI/UX overhaul is ready for the next implementation wave when:

- The proof pack exists for the priority routes.
- No priority route fails the explicit rejection criteria.
- `watch` items have named, bounded follow-up actions.
- The app still preserves feature parity and operational workflows.
- Any new implementation lane starts from the frontend master packet and this checkpoint.

## Smallest Meaningful Local Gate

For documentation-only updates to this checkpoint, run:

```bash
git diff --check
```

If a tiny test-only guardrail is added later, also run the focused test command for that guardrail.
