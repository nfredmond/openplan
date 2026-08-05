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

**Half of it is a build gate; half of it is still a report.** Since 2026-08-04
`npm run deadcode` runs inside `qa:gate` — see "The ratchet" below for exactly
which findings fail the build and which only print.

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

### Unlisted dependencies — FIXED, and the record of why they mattered

`server-only` (`src/lib/models/run-reconcile.ts`) and `jszip`
(`src/test/knowledge-base-extract.test.ts`) were imported but not declared in
`package.json`. They resolved because something else hoisted them — a build that
works by accident and breaks silently when a transitive dependency changes.

**Both are declared as of 2026-08-04** (`server-only` in `dependencies`, `jszip`
in `devDependencies`), each still with exactly one importer, and knip reports no
unlisted dependency. The `unlisted` rule is now at error severity, so this class
fails the build rather than waiting for someone to read a report.

## The ratchet — 2026-08-04

`qa:gate` runs `npm run deadcode` (about two seconds). The severities in
`knip.json` decide what a finding costs:

| Finding | Severity | Why |
|---|---|---|
| unused **files** | **fails the build** | the shipped-invisible defect class, in its cheapest form to catch |
| unused **dependencies** / **devDependencies** | **fails the build** | small, stable list; a new one is nearly always real |
| **unlisted** / **unresolved** / **binaries** / **catalog** | **fails the build** | a build that works by accident |
| unused **exports** and **exported types** | printed only | 635 of them today — see below |

**The export backlog is deliberately not gated, on evidence, not on nerve.**
Two things make a gate there cry wolf, and a gate that cries wolf gets
overridden — and then so does the real one. First, the count moves under you:
two runs four minutes apart on 2026-08-04 differed, because another lane was
editing the tree at the time. Second, knip is right about the symbol and wrong
about the defect: every re-export in `src/lib/aerial/public.ts` is reported
unused, and that file is the aerial module's deliberate separability boundary,
documented as such at the top of the file. Failing the build on a designed
architectural surface teaches people the gate is noise. Revisit if the list is
ever triaged down to something small enough to enumerate.

**Only the dependency half of the baseline prunes itself. Do not read the file
half as ratcheted — it is not.**

`treatConfigHintsAsErrors` is on, which covers `ignoreDependencies` and only
that: a stale entry there is a build failure, whether the package went back into
use or left `package.json` entirely. Measured 2026-08-04 against knip 6.29.0 by
running it on copies of `knip.json`: adding `zod` (imported all over `src/`) and
adding a package name absent from `package.json` each produced
`Configuration hints (1) … Remove from ignoreDependencies` and exit 1. So the
three dependency entries below can only shrink, and nobody has to remember them.

**`ignoreIssues` gets no such check.** In the same measurement, an
`ignoreIssues` key naming a live imported file (`src/lib/geographies/place-resolver.ts`,
which knip would never report unused) and an `ignoreIssues` key naming a path
with no file behind it were both accepted in silence — exit 0, nothing printed,
no hint. Deleting the ignored file does not retire its exemption; neither does
wiring it back up. The file entry below is therefore **known debt with no timer
on it**, and so is the `src/components/ui/**` block: pruning them is a manual
act, and if a future session wants that half ratcheted it has to build the check
itself rather than assume knip is doing it.

### The baseline — three dependencies and one file

Each entry is a claim you can check by reading the code. **Shrinking this list is
the work; adding to it needs a reason written here.**

- **`supabase`** (devDependency) — a CLI, not an import. It is run as
  `npm exec -- supabase start`, which knip cannot see. Keep.
- **`sonner`** — **a real orphan, and the earlier note calling it a knip false
  positive was simply wrong.** Its only importer is
  `src/components/ui/sonner.tsx`; nothing imports that component and `toast(`
  appears nowhere under `src/app` or `src/components`. Neither ever did:
  `git log -S"ui/sonner"` and `git log -S"toast("` over those paths return no
  commits. It was excused because `src/components/ui/**` was ignored wholesale,
  which is the failure mode this config change is meant to end. Removing the
  dependency means deleting the unmounted component with it.
- **`next-themes`** — zero references in `src/` or `scripts/`. A genuine
  removal, held only because dropping a dependency also rewrites
  `package-lock.json`, which is not a change to make in passing.
- **`src/lib/api/county-geographies.ts`** (unused file) — the zod schemas left
  behind when the county-search client was deleted in the 2026-08-03 triage
  above. Its sibling `place-geographies.ts` is the live front door. Delete it
  after confirming nothing reaches for these schemas by name — **and delete its
  `ignoreIssues` entry in the same change, because nothing will notice if you
  do not.**

`src/components/ui/**` is exempted from file/export findings rather than removed
from the project entirely, so a dependency imported only by a shadcn component
still counts as used. Under the old blanket `ignore` it would have been reported
unused — which is precisely how a real finding gets dismissed as noise.
