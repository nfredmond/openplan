# Dead code — the work-list

`npm run deadcode` runs [knip](https://knip.dev): unused files, exports, types and
dependencies.

## Read this before acting on the output

**In this repo, orphaned code is usually UNFINISHED, not obsolete.** Of seven
orphaned API routes found on 2026-07-30, six were complete working capability
nobody had wired up and exactly one deserved deletion. **Treat the report as a
work-list, not a delete-list** — the first question is "should this be wired up?",
not "should this go?".

**Knip cannot see string references.** This codebase addresses Supabase tables by
name, builds route paths from template literals, and dispatches on registry keys.
Live code will be reported unused. Check before deleting.

**It does not cover the Python workers** in `workers/` (a separate stdlib-only
suite), **or the database**. Schema is deliberately out of scope: see
`CLAUDE.md`, and note that two of five billing-named tables are load-bearing.

**It is a REPORT, not a build gate.** It is deliberately not in `qa:gate` yet —
the first run has a long tail of exported types that are used internally, and
failing the build on those would train everyone to ignore it. Ratchet it in once
the list is triaged.

## First run — 2026-07-30, v0.2.0

| Category | Count | Assessment |
|---|---|---|
| Unused files | 6 | **triage needed** — the highest-signal finding |
| Unused dependencies | 3 | `next-themes` + 2; removable once confirmed |
| Unused devDependencies | 2 | `shadcn` + 1 |
| **Unlisted dependencies** | **2** | **real fragility** — see below |
| Unused exports | 253 | mostly internal-use exports; low priority |
| Unused exported types | 367 | same; low priority |

### The six files — triaged 2026-08-03, all DELETED, decisions recorded

Every one turned out to be residue of a superseded or dismantled era — none was
an unfinished feature, which bucks this repo's usual pattern (the commit that
deleted them records each supersession):

- `location-picker-map.tsx` — point-only picker superseded by
  `geometry-picker-map.tsx` (points, lines, polygons) in the "engagement full
  vision" commit, which removed the import and left the file.
- `app-sidebar-link.tsx` — command-center-era nav for the deleted `/admin` console.
- `county-geographies-client.ts` — county-search client superseded by the
  TIGERweb place-resolver front door.
- `county-runtime-presets.ts` — preset picker removed on purpose in April's
  "Simplify county run surfaces" (−884 lines); its ActivitySim-smoke preset is
  the capability CLAUDE-era notes record as deferred.
- `operational-events.ts` — pilot-workflow-spine residue.
- `markdown-proof-helpers.ts` — helper for the deleted proof-packet lane.

**The triage also caught a two-hop orphan the route guard could not see:**
`/api/geographies/counties`'s only "caller" was `county-geographies-client.ts` —
a file nothing imported. The route-caller guard credited the route via a string
in dead code. Deleting the dead client made the truth visible and the route went
with it. **Correction (2026-08-04): the deletion was NOT equivalent.** The
counties route was the only code wrapping county search in
`withWorkspaceIntegrationContext`, so deleting it silently broke workspace
Census keys on the live front door — a workspace that self-served a key was
told the deployment had none. The seam is restored in
`api/geographies/places/route.ts` and pinned by
`src/test/places-route-workspace-census-key.test.ts`, which asserts the search
runs INSIDE the context. Lesson: before deleting an orphan, diff its body
against its replacement for seams the replacement never carried, not just for
reachability. And `/api/csp-report`
turned out to be genuinely browser-called via the CSP header's `report-uri` —
now allowlisted with its real caller named.

### Unlisted dependencies — fix these first

`server-only` (`src/lib/models/run-reconcile.ts`) and `jszip`
(`src/test/knowledge-base-extract.test.ts`) are imported but not declared in
`package.json`. They resolve today because something else hoists them. That is a
build that works by accident, and it breaks silently when a transitive dependency
changes. Declare them explicitly.
