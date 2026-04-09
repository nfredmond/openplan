# OpenPlan Frontend Design Constitution

**Date:** 2026-04-08  
**Owner:** Bartholomew Hale  
**Purpose:** convert deep research on reducing generic AI frontend output into durable execution rules for OpenPlan.

## Executive Summary

OpenPlan should not look like a generic AI-generated SaaS dashboard.

The default target is a **cardless, pill-light civic workbench**:
- left rail for navigation,
- continuous central worksurface for real planning tasks,
- right inspector/context rail for detail and editing,
- hierarchy expressed through typography, spacing, row rhythm, and separators instead of stacked decorative containers.

The goal is to preserve backend capability while making the frontend feel distinctive, serious, and operationally useful.

## Core problem this memo solves

When frontend prompts are vague, models tend to fall back to high-frequency patterns from training data:
- card grids,
- chip/pill bars,
- floating badges,
- detached callouts,
- and boxed dashboard modules.

That output is often functional, but it makes the product feel generic, cluttered, and structurally "AI-made."

For OpenPlan, this is the wrong visual language.
The product should feel like a planning operating system, not a collage of dashboard widgets.

## Canonical design posture

### Primary metaphor
**OpenPlan is a worksurface with rails, not a pile of modules.**

Default frame:
1. **Left rail** — navigation, saved views, project context, switching
2. **Worksurface** — lists, maps, documents, tables, timelines, row-based content
3. **Right rail / inspector** — selected-object detail, metadata, editing controls, secondary actions

This should be the first layout instinct unless a screen has a stronger specific reason to do something else.

### Tone
- calm
- serious
- civic
- precise
- dense but readable
- minimal chrome
- high signal, low decoration

## Hard guardrails

### Cards rule
**Default: no cards.**

Allowed only when the card is the actual interaction unit, such as:
- a chooser,
- an explicit selectable object,
- a modal-like action surface,
- or a tightly scoped summary block that would be weaker as rows.

Not allowed as the default page structure for dashboards, indexes, or detail pages.

### Chips / pills rule
**Default: avoid pills/chips for filters, metadata, and actions.**

Do not use chip clusters as the main way to express:
- filters,
- tags,
- statuses,
- quick actions,
- or detached metadata.

Prefer:
- inline text filters,
- sentence-style filter bars,
- compact menus/popovers,
- row metadata,
- inspector fields,
- or plain text with separators.

### Badge noise rule
Avoid floating badge noise and decorative micro-labeling.
If a status matters, it should be integrated into the information hierarchy, not pasted on as visual confetti.

### CTA rule
Each major screen or area should have **one obvious primary action**.
Do not scatter many equal-weight buttons across the canvas.

## Preferred structural patterns

### For index screens
Prefer:
- vertical lists,
- row groups,
- compact tables,
- grouped sections with clear headers,
- saved-view rails,
- sticky filter/sort controls.

Avoid:
- card grids for scan/compare tasks,
- separate little summary modules for every concept.

### For detail screens
Prefer:
- document-like page flow,
- section headers with short explanatory copy,
- inline metadata rails,
- split views where useful,
- right-side inspector or action rail,
- visible provenance and evidence chains.

Avoid:
- stacks of isolated boxes,
- badge farms,
- metadata rendered as dozens of pill-shaped tokens.

### For filters
Prefer filter language that reads like a sentence, for example:
- `Showing: Active projects • Owner = Me • Updated in last 30 days`

Each clause can open a popover or drawer editor.

Avoid giant chip strips and segmented-control sprawl.

### For maps + analysis
Prefer:
- map as a first-class worksurface,
- surrounding controls that feel like instrumentation,
- inspectors for selected geometry or scenario context,
- explicit provenance and context near outputs.

Avoid:
- wrapping every control in its own floating card,
- breaking the map screen into too many dashboard tiles.

## Visual hierarchy rules

Express hierarchy in this order:
1. layout
2. spacing
3. typography
4. alignment
5. separators
6. color
7. container/background treatment
8. motion

That means backgrounds, borders, shadows, and rounded boxes should come late, not first.

## Typography and density

### Typography
Use typography as a primary differentiator.

Target:
- restrained but confident display/headline treatment,
- strong section labels,
- readable body copy,
- compact metadata styling,
- no novelty font chaos.

### Density
OpenPlan should feel **dense but calm**.
That means:
- more like a serious workbench,
- less like a marketing site,
- less like a fluffy BI dashboard.

Dense is acceptable if scan paths are clear.
Clutter is not acceptable.

## Distinctiveness rules

To feel less generic, prioritize choices that are structural rather than decorative:
- distinctive layout rhythm,
- stronger typographic hierarchy,
- deliberate inspector behavior,
- better information architecture,
- fewer but more intentional accent moments,
- serious row/list/table design.

Do **not** rely on:
- random gradients,
- glassmorphism,
- ornamental shadows,
- generic purple/blue startup palettes,
- or novelty for its own sake.

## Prompting rules for AI-generated frontend work

When asking GPT-5.4 or another model to generate or refactor OpenPlan UI:

### Always include
- the design posture,
- layout metaphor,
- component restrictions,
- rejection criteria,
- and the exact screen/task being redesigned.

### Good instruction pattern
Include guidance like:
- use worksurface + rails,
- avoid card-grid SaaS patterns,
- avoid chip/pill metadata systems,
- preserve feature parity,
- prioritize scan/compare workflows,
- use one primary action,
- keep the page dense but calm.

### Rejection criteria
Reject output that shows any of the following as the default structure:
- generic SaaS card grid,
- stacked dashboard boxes,
- chip/pill bars everywhere,
- floating badge clutter,
- multiple primary CTAs competing,
- decorative chrome doing the job of hierarchy.

## Implementation rules in code

### Preferred component direction
Build or reuse primitives that support this constitution:
- row items,
- meta items,
- section rails,
- inspectors,
- split panes,
- sticky headers,
- compact filter bars,
- provenance blocks,
- evidence chains.

### De-emphasize or retire where possible
- generic `Card` as the default composition primitive,
- chip-heavy multi-select UIs when a text/popover approach would work,
- badge-driven metadata systems,
- repeated boxed wrappers around every subsection.

### Tailwind / token rule
Keep a clear semantic token system for:
- background,
- surface,
- text,
- muted text,
- border,
- accent,
- spacing,
- radius,
- type roles.

Token discipline matters more than adding more utility classes.

## Verification checklist

Before calling a frontend slice done, verify:

1. Does the screen read like a workbench, not a widget board?
2. Are cards absent unless the card itself is the interaction?
3. Are chips/pills absent or materially reduced?
4. Is scanability better in real data states?
5. Is there one obvious primary action?
6. Does the selected-object / detail workflow feel clear?
7. Does the layout still work at real viewport sizes?
8. Is the hierarchy carried by type/spacing/layout rather than decorative boxes?
9. Does the page still feel distinct without gimmicks?
10. Would this still look credible if colors were desaturated?

If the answer to several of these is no, iterate again.

## OpenPlan-specific application notes

### High-priority surfaces for this constitution
Apply this posture first to:
- dashboard,
- projects,
- plans,
- programs,
- reports,
- scenarios,
- data hub,
- engagement,
- county runs,
- admin / pilot readiness,
- pricing and auth surfaces where relevant.

### Why this matters specifically for OpenPlan
OpenPlan users need to:
- find things,
- compare options,
- review evidence,
- trace provenance,
- take the next operational step.

That means scanability and structural clarity matter more than modular prettiness.

## Bottom line

OpenPlan should feel like:
- a calm planning workbench,
- a civic operating system,
- a serious tool for professionals.

It should not feel like:
- a template dashboard,
- a startup card collage,
- or a chip-and-badge toy.

Use this memo as the design constitution whenever frontend work risks drifting back toward generic AI output.
