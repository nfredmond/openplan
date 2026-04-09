# OpenPlan Frontend Master Packet

**Date:** 2026-04-08  
**Owner:** Bartholomew Hale  
**Audience:** Iris Chen, Mateo Ruiz, Codex, Claude Code, and any OpenPlan frontend implementation lane  
**Purpose:** provide one canonical entry point for OpenPlan frontend redesign work so all agents and humans start from the same design truth, execution checks, and prompt language.

## Executive Summary

OpenPlan frontend work should now start from this packet.

The design direction is:
- **civic workbench**
- **worksurface with rails**
- **cardless by default**
- **pill-light**
- **dense but calm**
- **strong hierarchy through layout, spacing, typography, separators, and inspector logic**

Do not let the UI drift back into generic AI-SaaS patterns.

## Canonical packet contents

### 1. Design constitution
**Read first when deciding what the UI should feel like.**

- `2026-04-08-openplan-frontend-design-constitution.md`

Use this for:
- design posture
- structural guardrails
- card/pill rules
- hierarchy rules
- prompting constraints
- verification standards

### 2. Execution checklist
**Use while implementing and reviewing real screens.**

- `2026-04-08-openplan-frontend-execution-checklist.md`

Use this for:
- pre-build checks
- route-by-route structural review
- anti-generic regression checks
- scanability and interaction review
- definition of done

### 3. Agent prompt template
**Use to start Codex/Claude-style implementation lanes with the right constraints already loaded.**

- `2026-04-08-openplan-frontend-agent-prompt-template.md`

Use this for:
- copy-pasteable implementation prompts
- short prompt variants
- screen-type add-ons
- reviewer questions

## Required order of operations

For any substantial OpenPlan frontend task:

1. Read this master packet.
2. Read the design constitution.
3. Use the execution checklist to define the intended screen structure.
4. Start the coding lane with the agent prompt template.
5. Verify the rendered result against the checklist before calling the slice done.

## Current design doctrine

### What OpenPlan should feel like
- a planning operating system
- a civic workbench
- a serious professional tool
- a product built for scan, compare, inspect, and act

### What OpenPlan should NOT feel like
- a startup dashboard template
- a card-grid SaaS clone
- a badge-and-chip toy
- a decorative analytics board

## Hard non-negotiables

- Preserve backend feature parity.
- Do not break functional workflows while redesigning UI.
- Keep maps, reports, engagement, modeling, county runs, and billing/admin flows usable and intuitive.
- Prefer row/list/table/worksurface patterns over default card layouts.
- Use one clear primary action per major screen area.
- Treat pills/chips as exceptions, not default UI grammar.
- Verify real rendered states, not just code structure.

## Backend-truth note

OpenPlan frontend redesign work must stay grounded in the real app and real deployment/backing systems.

Operational reminder:
- Vercel and Supabase truth are available to validate real app behavior and reduce drift risk.
- Use those capabilities when needed to confirm deployment, environment behavior, schema-backed flows, and route reality instead of redesigning against assumptions.

## Recommended implementation sequence

When doing a large redesign wave, use this order:
1. app shell / frame / navigation rails
2. index surfaces (projects, plans, programs, reports, scenarios, data hub)
3. detail surfaces and inspectors
4. engagement and public-facing planning flows
5. county runs / modeling / analysis instrumentation surfaces
6. auth / pricing / onboarding trust surfaces
7. cleanup pass for remaining card/pill residue and inconsistent metadata patterns

## Suggested handoff language

When assigning frontend work, say:

> Start from `2026-04-08-openplan-frontend-master-packet.md`. Follow the constitution, implement against the execution checklist, and use the agent prompt template to preserve the civic workbench direction while keeping feature parity intact.

## Bottom line

This packet is now the canonical entry point for OpenPlan frontend redesign work.

If someone starts a UI task without using this packet, they are much more likely to reintroduce generic structure, miss workflow intent, or degrade feature usability.
