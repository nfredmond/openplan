# OpenPlan Engagement Lane A — Planning / Content / Operator Support Package

**Date:** 2026-03-21  
**Owner:** Owen Park (Associate Planner)  
**Lane:** A — Engagement / public-input system  
**Acceleration-plan reference:** `openplan/docs/ops/2026-03-21-openplan-four-priority-acceleration-plan.md`

## Purpose

This package supports Lane A from the planning/content/operator side without stepping into the builder's UI/code lane.

It is intentionally grounded in the **current shipped engagement schema and UI posture**:
- campaign statuses: `draft`, `active`, `closed`, `archived`
- engagement types: `map_feedback`, `comment_collection`, `meeting_intake`
- item statuses: `pending`, `approved`, `rejected`, `flagged`
- source types: `internal`, `public`, `meeting`, `email`

That means the guidance below is immediately usable for:
- campaign setup,
- operator moderation consistency,
- public-facing copy drafting,
- clean report handoff preparation,
- demo/sample content seeding.

It does **not** require new enums, new migrations, or AI-specific workflow changes.

## Artifacts in this package

1. `docs/ops/2026-03-21-engagement-taxonomy-intake-moderation-guidance.md`
   - campaign taxonomy guidance
   - recommended category starter kits
   - intake-source decision rules
   - moderation-status usage rules
   - optional `metadata_json` guidance for future consistency

2. `docs/ops/2026-03-21-engagement-public-copy-and-guardrails.md`
   - draft public-facing campaign copy
   - outreach snippets
   - moderation/privacy language
   - client-safe guardrails for future public intake flows

3. `docs/ops/2026-03-21-engagement-closeout-handoff-runbook.md`
   - operator closeout sequence
   - handoff packet checklist
   - report creation guidance aligned to current `Create handoff report` flow
   - archived/closed record posture

4. `docs/ops/templates/engagement_operator_seed_safe_routes_v0.1.json`
   - docs-only sample content fixture
   - campaign seed with categories, sample items, and example metadata keys
   - safe for manual entry, builder reference, QA/demo setup, or future import work

## Recommended immediate use

### For the builder lane
- Keep the current enums.
- Use the taxonomy doc as the canonical source for helper text, labels, and defaults.
- Use the public copy doc for any public-entry or share-page language.
- Use the closeout runbook to guide any operator checklist or handoff UX cues.
- Use the JSON template as demo/fixture content if a low-risk seed path appears.

### For operator/testing lanes
- Stand up one realistic transportation-planning campaign using the sample JSON.
- Verify that source-type usage, moderation notes, and category coverage produce a cleaner handoff packet.
- Use the runbook as the definition of a “planning-ready” campaign closeout.

## Key operating recommendation

For the next slice, **do not expand enums first**. The current schema is already enough to prove a much more complete engagement workflow if operators use it consistently.

The fastest path to a stronger Social Pinpoint-like posture is:
1. consistent campaign naming,
2. consistent source typing,
3. consistent moderation decisions,
4. explicit public copy and expectations,
5. deterministic closeout and handoff.

That is what this support package is designed to enable.
