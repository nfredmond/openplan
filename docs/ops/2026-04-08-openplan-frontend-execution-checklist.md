# OpenPlan Frontend Execution Checklist

**Date:** 2026-04-08  
**Owner:** Bartholomew Hale  
**Purpose:** turn the frontend design constitution into a practical execution checklist for Iris, Mateo, Codex, Claude Code, or any other implementation lane.

## How to use this checklist

Use this before, during, and after any OpenPlan frontend redesign slice.

This is not a generic style checklist.
It is specifically meant to keep OpenPlan aligned with the **civic workbench / worksurface-with-rails** design direction and prevent regression into generic AI-SaaS UI.

Primary companion doc:
- `2026-04-08-openplan-frontend-design-constitution.md`

---

## 1. Pre-build checklist

### Product truth
- [ ] I can describe the screen’s real job in one sentence.
- [ ] I know what the user is trying to find, compare, review, edit, or launch.
- [ ] I am preserving feature parity with the existing backend and workflows.
- [ ] I am not inventing decorative UI that obscures actual operator value.

### Layout direction
- [ ] I have decided whether this screen is primarily:
  - [ ] navigation + list
  - [ ] worksurface + inspector
  - [ ] map + inspector
  - [ ] document/detail flow
  - [ ] table/compare workflow
- [ ] I am starting from layout and task flow, not decorative components.
- [ ] I am not defaulting to a card grid.

### Design-constitution compliance
- [ ] I reviewed `2026-04-08-openplan-frontend-design-constitution.md` before starting.
- [ ] I know what the primary action is for this screen.
- [ ] I know what should live in the inspector versus in the main worksurface.
- [ ] I have a reason for every visual container I introduce.

---

## 2. Structural checklist

### Worksurface quality
- [ ] The screen reads like a workbench, not a dashboard collage.
- [ ] The main content area is continuous enough to support real work.
- [ ] The scan path is obvious within 3 seconds.
- [ ] Related actions and metadata are grouped by structure, not by random box wrappers.

### Navigation rail
- [ ] The left rail helps with orientation, not just navigation chrome.
- [ ] Navigation labels are clear, sober, and operationally useful.
- [ ] Current location and surrounding context are obvious.

### Inspector / context rail
- [ ] Detail, metadata, and secondary actions are placed in an inspector when appropriate.
- [ ] The inspector reduces clutter in the main worksurface.
- [ ] The inspector helps with review/edit/trace tasks instead of duplicating the page.

---

## 3. Anti-generic guardrail checklist

### Cards
- [ ] There is no default card-grid structure.
- [ ] Any card-like container that remains has a specific interaction reason.
- [ ] I can explain why each remaining card should not become a row, section, or rail.

### Pills / chips / badges
- [ ] Filters are not expressed as giant chip bars.
- [ ] Metadata is not rendered as a pill farm.
- [ ] Status is integrated into hierarchy rather than scattered as decorative badges.
- [ ] Quick actions are not fragmented into many pill-buttons.

### Decorative drift
- [ ] Visual hierarchy is not being faked with shadows, gradients, and rounded boxes.
- [ ] The screen would still read well if saturation were reduced.
- [ ] The layout feels distinct because of structure, not gimmicks.

---

## 4. Interaction checklist

### Primary action discipline
- [ ] There is one clear primary action for the screen or current state.
- [ ] Secondary actions are visibly subordinate.
- [ ] The page does not have multiple equally loud calls to action fighting each other.

### Scan / compare / review workflows
- [ ] If users need to compare items, I used rows, tables, or aligned sections instead of cards.
- [ ] If users need to review evidence or provenance, the chain is visible and easy to follow.
- [ ] If users need to edit metadata, the editing surface is coherent and not scattered.

### Filters and controls
- [ ] Filter language is compact and readable.
- [ ] Filter editing happens through popovers, drawers, menus, or inspector controls when useful.
- [ ] Controls feel like instrumentation, not ornament.

---

## 5. Typography and density checklist

### Typography
- [ ] Typography carries meaningful hierarchy.
- [ ] Section headings are strong and useful, not decorative.
- [ ] Metadata styling is compact and readable.
- [ ] Body text is calm and operational, not splashy.

### Density
- [ ] The screen is dense enough for real work.
- [ ] The density does not become clutter.
- [ ] Spacing is deliberate and rhythmic.
- [ ] White space is used for grouping, not emptiness for its own sake.

---

## 6. Screen-type checklist

### Dashboard
- [ ] The dashboard feels like an operations surface, not a KPI card wall.
- [ ] Priority items are shown in rows, sections, ledgers, or timelines where possible.
- [ ] The first impression is not generic SaaS analytics chrome.

### Projects / Plans / Programs / Reports indexes
- [ ] The index supports fast scanning and triage.
- [ ] Columns/rows expose the most decision-useful metadata.
- [ ] Selection, sorting, and filtering feel operationally efficient.

### Detail pages
- [ ] Detail pages feel like working documents or review surfaces.
- [ ] Metadata is organized into rails, rows, or inline sections.
- [ ] Provenance, freshness, and linked records are easy to inspect.

### Scenarios / comparison
- [ ] Comparison views emphasize aligned deltas and contrast clarity.
- [ ] Layout supports side-by-side or baseline-vs-alternative thinking cleanly.
- [ ] Decorative boxing does not obscure comparison logic.

### Data Hub
- [ ] Dataset readiness, geometry status, and attachment context are obvious.
- [ ] Readiness states are readable without chip clutter.
- [ ] The screen supports triage and interpretation, not just catalog browsing.

### Engagement
- [ ] Public input and moderation flows feel coherent and traceable.
- [ ] Handoff readiness and reporting traceability are visible.
- [ ] Public-facing surfaces feel clear and civic, not gimmicky.

### County Runs / modeling / analysis
- [ ] The worksurface supports workflow sequencing and evidence review.
- [ ] Run status, artifact links, and validation posture are easy to inspect.
- [ ] Maps, manifests, and scaffolds feel like instrumentation panels, not boxed widgets.

### Auth / pricing / onboarding
- [ ] The page still honors the overall product tone.
- [ ] Marketing drift is controlled.
- [ ] Conversion clarity does not require generic marketing-site tropes.

---

## 7. Implementation checklist

### Component choices
- [ ] I used or created primitives that support the constitution:
  - [ ] row item
  - [ ] meta item
  - [ ] inspector panel
  - [ ] section rail
  - [ ] sticky filter/header
  - [ ] provenance/evidence block
- [ ] I did not reach for a generic `Card` component by reflex.
- [ ] I did not add chip-heavy controls where text/popover patterns would work better.

### Token discipline
- [ ] Colors, spacing, and type roles use semantic tokens consistently.
- [ ] Accent color is used intentionally, not everywhere.
- [ ] Borders/separators do more work than shadows.

---

## 8. Verification checklist

### Local verification
- [ ] I viewed the screen locally in the browser.
- [ ] I checked at least desktop + tablet + mobile widths relevant to the route.
- [ ] I checked a realistic populated state, not just an empty seed state.
- [ ] I checked hover/focus/selection behavior where relevant.

### Functional verification
- [ ] Critical flows still work.
- [ ] No feature parity was lost during layout cleanup.
- [ ] Important actions are still reachable and understandable.

### Visual verification
- [ ] The screen does not read as generic AI SaaS.
- [ ] The first impression is not “stack of cards.”
- [ ] The page remains calm under real data load.
- [ ] The inspector and worksurface feel like one system.

---

## 9. Rejection checklist

Stop and rework the screen if any of these are true:
- [ ] The page’s first impression is a generic SaaS card grid.
- [ ] Filters/actions/statuses are mostly pills or badges.
- [ ] There are too many isolated boxes competing for attention.
- [ ] The page has more than one primary action shouting at the user.
- [ ] Scanability got worse than before.
- [ ] The design is relying on chrome instead of structure.
- [ ] The screen looks polished but less operationally useful.

---

## 10. Definition of done for a frontend slice

A frontend slice is done when:
- [ ] the route is functionally intact,
- [ ] the new layout is clearly more workbench-like,
- [ ] card/pill regression is materially reduced,
- [ ] hierarchy is clearer under real data,
- [ ] the primary workflow is faster to scan and act on,
- [ ] local validation passed,
- [ ] and the result is strong enough to survive comparison against the previous screen.

---

## Suggested handoff note format

When a redesign slice is ready, summarize it like this:
- route(s) touched
- main structural change
- card/pill reduction achieved
- primary workflow improved
- remaining rough edges
- validation run (`lint`, `test`, `build`, screenshots, smoke)

## Bottom line

If a redesign still feels like a dashboard made of boxes, it is not done.

If it feels like a calm planning workbench where the user can quickly scan, compare, inspect, and act, it is on the right track.
