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

### The six files, untriaged

Each needs the wire-it-up-or-delete decision, with the reason recorded:

- `src/components/engagement/location-picker-map.tsx`
- `src/components/nav/app-sidebar-link.tsx`
- `src/lib/api/county-geographies-client.ts`
- `src/lib/models/county-runtime-presets.ts`
- `src/lib/observability/operational-events.ts`
- `src/test/markdown-proof-helpers.ts` — likely residue of the deleted
  proof-packet lane; check before assuming

### Unlisted dependencies — fix these first

`server-only` (`src/lib/models/run-reconcile.ts`) and `jszip`
(`src/test/knowledge-base-extract.test.ts`) are imported but not declared in
`package.json`. They resolve today because something else hoists them. That is a
build that works by accident, and it breaks silently when a transitive dependency
changes. Declare them explicitly.
