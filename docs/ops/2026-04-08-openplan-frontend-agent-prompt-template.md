# OpenPlan Frontend Agent Prompt Template

**Date:** 2026-04-08  
**Owner:** Bartholomew Hale  
**Purpose:** provide a reusable prompt template for Codex, Claude Code, or other coding agents so OpenPlan frontend work starts with the correct design constraints by default.

## How to use this template

Copy this prompt, fill in the bracketed fields, and use it as the opening instruction for any OpenPlan frontend redesign or UI refinement task.

Use it for:
- route redesigns,
- component refactors,
- UX polish passes,
- screen-level cleanup,
- auth/pricing surface cleanup,
- index/detail/layout refactors.

Primary companion docs:
- `2026-04-08-openplan-frontend-design-constitution.md`
- `2026-04-08-openplan-frontend-execution-checklist.md`

---

## Copy-paste prompt template

```text
You are working on the OpenPlan frontend.

Your job is to improve the UI without changing the backend product truth or breaking feature parity.

## Product posture
OpenPlan should feel like a serious civic workbench / planning operating system, not a generic AI-generated SaaS dashboard.

Default visual direction:
- left navigation rail
- continuous central worksurface
- right inspector/context rail when useful
- dense but calm
- strong typography and spacing
- hierarchy through layout, rows, separators, and alignment
- minimal decorative chrome

## Hard design guardrails
- Do NOT default to card-grid SaaS layouts.
- Do NOT rebuild the page as stacked dashboard boxes.
- Do NOT use chip/pill clusters as the main filter, metadata, or action pattern.
- Do NOT rely on floating badges, detached callouts, or decorative wrappers to create hierarchy.
- Use cards only when the card itself is the interaction unit.
- Prefer lists, rows, tables, section rails, and inspectors for scan/compare/review workflows.
- Keep one obvious primary action per major screen area.
- Preserve feature parity.

## Screen/task
- Route or component: [INSERT ROUTE / COMPONENT]
- User job to be done: [INSERT WHAT THE USER IS TRYING TO FIND / COMPARE / REVIEW / EDIT / LAUNCH]
- Current problem: [INSERT CURRENT UI PROBLEM]
- Success condition: [INSERT WHAT BETTER LOOKS LIKE]

## Structural preference
This screen should primarily behave like:
- [ ] navigation + list
- [ ] worksurface + inspector
- [ ] map + inspector
- [ ] document/detail flow
- [ ] table/compare workflow

Choose one and design around it.

## Required approach
1. Start from layout and information hierarchy, not decoration.
2. Remove or reduce generic cards/pills where possible.
3. Improve scanability under realistic data.
4. Make metadata placement more deliberate.
5. Keep the page operationally useful for planners.
6. Reuse or introduce primitives like rows, meta items, section rails, inspectors, sticky headers, and provenance blocks when appropriate.

## Deliverables
- Implement the UI changes in code.
- Briefly explain the structural changes you made.
- Note any remaining card/pill remnants that still have a valid reason to exist.
- Run the relevant validation commands.

## Validation
Before finishing:
- verify the route in a browser if possible,
- check realistic populated states,
- check desktop/tablet/mobile widths relevant to the route,
- confirm the result does not read like generic AI SaaS.

## Rejection criteria
Your solution is not acceptable if:
- the first impression is still a generic SaaS card grid,
- the screen still depends on pill/chip clutter,
- multiple primary CTAs compete for attention,
- scanability gets worse,
- decorative chrome is doing the job of information hierarchy.

Now redesign the specified screen accordingly.
```

---

## Short prompt variant

Use this when you need a smaller version for a quick iteration:

```text
Redesign this OpenPlan UI route as a civic workbench, not a generic SaaS dashboard. Preserve feature parity. Default to worksurface + rails + inspector when useful. Avoid card-grid layouts, pill/chip clutter, floating badge noise, and stacked dashboard boxes. Prefer rows, tables, section rails, inline metadata, and one clear primary action. Improve scanability, hierarchy, and operational usefulness under realistic data. Route/component: [INSERT]. User job: [INSERT]. Current problem: [INSERT]. Success condition: [INSERT]. Validate at real viewports and avoid regressing into generic AI SaaS structure.
```

---

## Prompt add-ons by screen type

### For index pages
Add:

```text
This is an index/triage screen. Prioritize fast scanning, sorting, filtering, and comparison. Prefer rows or tables over cards.
```

### For detail pages
Add:

```text
This is a detail/review screen. Make it feel like a working document with clear provenance, metadata rails, and coherent edit/review flow.
```

### For map/analysis pages
Add:

```text
This is a map/analysis screen. Treat the map as the primary worksurface and make surrounding controls feel like instrumentation, not floating widgets.
```

### For auth/pricing/onboarding
Add:

```text
This is a conversion/trust screen. Keep the product tone serious and distinctive without falling back to generic marketing-site tropes.
```

---

## Required reviewer questions

After the agent finishes, review the output with these questions:
- Does this feel like a planning workbench or a dashboard toy?
- Did cards become the default again?
- Did pills/chips creep back in as metadata or filters?
- Is there one clear primary action?
- Is scanability materially better?
- Would this still feel strong if color were toned down?

If the answer is weak on several of these, iterate again.

## Bottom line

The purpose of this template is to make strong OpenPlan frontend direction automatic.

If an agent follows this prompt and the companion docs faithfully, the output should move toward a serious, distinctive planning operating system instead of drifting back into recognizable AI-template UI.
