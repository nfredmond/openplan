---
title: 2026-04-18 Command Center lane — composition proof
date: 2026-04-18
phase: Phase H (forward-motion plan)
status: landed
---

# 2026-04-18 Command Center lane — composition proof

## What this proves

`/command-center` is a standalone operational cross-domain route that
composes the existing workspace operations summary. It introduces no
new data fetchers, no new types, and no duplicated widgets.

The dashboard remains the workspace home; Command Center is the
operational cut of the same state.

## What shipped

### Route

- `src/app/(app)/command-center/page.tsx` — server component. Redirects
  to `/sign-in` when unauthenticated; renders
  `WorkspaceMembershipRequired` when the user has no workspace.
- Data source: `loadWorkspaceOperationsSummaryForWorkspace()` — the
  same aggregator that backs the Dashboard, project, report, and plan
  surfaces. No new query paths.

### Composed widgets (all pre-existing)

- `WorkspaceRuntimeCue` — single next-action banner off the summary.
- `WorkspaceCommandBoard` — cross-domain 4×2 counts grid + command
  queue. Rendered with a short contextual note (Command Center shares
  the Dashboard's source of truth).
- Domain list — sectioned worksurface listing RTP, Grants, Aerial,
  Projects, Reports with live count context and a caret link out.
- Trailing `StateBlock` — pins scope: "Command Center composes
  existing widgets; it does not introduce new data sources or
  derivations."

### Nav surfaces

- `src/components/app-shell.tsx` — added `/command-center` link under
  the Operate group (between Overview and Projects) with a new
  `command` icon slot.
- `src/components/nav/app-sidebar-link.tsx` — added `command: Radar`
  to the icon map.
- `src/components/nav/app-secondary-nav.tsx` — added Command Center
  to the Overview section; section now matches both `/dashboard` and
  `/command-center`.

## Counts surfaced

Each domain row reports live count context pulled straight from the
operations summary, so Command Center never re-derives state:

| Domain     | Source field                                     |
| ---------- | ------------------------------------------------ |
| RTP        | `counts.rtpFundingReviewPackets`                 |
| Grants     | `counts.openFundingOpportunities`                |
| Aerial Ops | `counts.aerialReadyPackages`                     |
| Projects   | `counts.projectFundingReimbursementActiveProjects` |
| Reports    | `counts.reports` + `counts.reportPacketCurrent`  |

## Design-constitution check

- Sectioned worksurface layout, not a card grid.
- Single primary intent per area (runtime cue → command board →
  domain list).
- No chip clusters, no floating badge noise.
- `StatusBadge` used only for tone-neutral identifiers (workspace
  name, cross-domain view label).

## What this does NOT do

1. **Does not rebuild any dashboard widget.** `WorkspaceCommandBoard`
   and `WorkspaceRuntimeCue` are imported, not duplicated.
2. **Does not introduce new data fetchers.** The aggregator is reused.
3. **Does not add new types.** `WorkspaceOperationsSummary` carries
   every count surfaced here.
4. **Does not compete with the Dashboard.** Dashboard is the
   workspace home; Command Center is the operational cut.

## Artifact pointers

- Route: `src/app/(app)/command-center/page.tsx`
- Aggregator: `src/lib/operations/workspace-summary.ts`
- Widgets: `src/components/operations/workspace-command-board.tsx`,
  `src/components/operations/workspace-runtime-cue.tsx`
- Nav: `src/components/app-shell.tsx`,
  `src/components/nav/app-sidebar-link.tsx`,
  `src/components/nav/app-secondary-nav.tsx`

## Verification

- `pnpm tsc --noEmit` — clean.
- `pnpm test --run` — 725/166 green.
- Route renders runtime cue + command board + domain counts + scope
  note against the live workspace operations summary.
