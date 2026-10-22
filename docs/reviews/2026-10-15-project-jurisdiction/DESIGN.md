# Keep project jurisdiction separate from study geometry

October 15, 2026. Read-only implementation design for the Stage A project journey.
Source baseline: `1b2fefe0f0e98f99700fc77e99146fe697b43ee7` (`origin/main`).
Owner: research child in `t3/project-jurisdiction-boundary-design`, assigned
worktree `/home/nathaniel/.t3/worktrees/openplan/t3-cbd4a98f`. This report is its
only owned file. The parent owns implementation and integration; the other child
owns project map components. No application, database or hosted change occurs here.

## Finding and recommended home

Add an independent, human-declared jurisdiction context to the existing project.
Keep `place_*` as the study area's capture identity, extent and exact geometry.
Changing jurisdiction must write no `place_*`, site-location or corridor fields.
Changing or clearing study geometry must preserve the separate declaration.
Neither operation establishes adopting authority or legal applicability.

The report supports Stage A3's retained project finding and M1/CORE-GEO-01. It
creates no new queue or module. The binding contract still covers all 50 states
and DC, California depth, explicit territories, tribal sovereignty, overlapping
authorities and worldwide extensibility. A successful county case cannot close
those broader obligations. Read `docs/ROADMAP.md`, the contract, requirement
ledger, capability matrix, October 6 direction review, architecture and known
issues alongside this bounded recommendation.

## Source trace

Paths below are relative to the repository root and refer to the baseline above.

1. **Observed defect.** Private retained journey
   `~/.local/state/openplan/first-week-sol-20261015/02-project-end-to-end/findings.json`,
   finding `f5`, records selecting Mendocino County, uploading the requested
   boundary, then losing country identity. The separate `f4` is a map-display
   defect. Public diagnostic status lives in the parent's evidence checkout at
   `docs/reviews/2026-10-15-first-week-restart/STATUS.md`, commit `ca08137e4`.
   The retry's `artifact-review.json` and `evidence/bundle-readiness.json` retain
   matching readiness JSON/bundle content with `unassessed` status. Fixture
   Storage repair did not fix jurisdiction. No private captures belong in Git.
2. **Create and edit.** `openplan/src/components/projects/project-workspace-creator.tsx`
   and `openplan/src/app/api/projects/route.ts` create basic identity fields,
   without geography or jurisdiction. In
   `openplan/src/components/projects/project-identity-editor.tsx:219`,
   `handleSavePlace` selects either a resolved place or uploaded/drawn geometry.
   The upload callback at line 563 explicitly clears `pickedPlace`. This is
   correct protection against attributing a county name to a different shape.
3. **Picker and file storage.**
   `openplan/src/components/models/study-area-picker.tsx:173` emits selected
   boundary geometry, then its resolved identity. External geometry clears its
   displayed selected label. `openplan/src/components/corridor/CorridorUpload.tsx`
   reads bytes locally through `lib/geo/spatial-file-import.ts`, validates and
   combines polygon parts with disclosures, and emits geometry. This path does
   not retain a source-file document, file hash or feature-property jurisdiction.
   The project PATCH stores the GeoJSON on the row, not in a new Storage object.
4. **Persistence and API.**
   `openplan/src/lib/projects/project-place.ts:117` intentionally writes null
   kind, reference, country and subdivision for an unresolved area. In
   `openplan/src/app/api/projects/[projectId]/route.ts:228`, a `place` PATCH
   replaces the whole place record; searched places re-resolve server-side.
   `20260728000009_project_place_of_record.sql` owns these columns. The
   `projects_place_drawn_has_no_ref` SQL check only forbids a drawn reference;
   the stronger null-country/null-kind rule currently lives in application
   builders. Do not claim that SQL already enforces every upload invariant.
5. **No spare project metadata.** The project CREATE/ALTER migrations cover
   basic fields, aerial/RTP posture, location, budgets, estimates and `place_*`.
   No independent jurisdiction column or general project metadata exists.
   `project_corridors.geometry_geojson`, import review JSON, linked-plan context
   and geometry feature properties have different owners. Reusing them would
   hide the fact or corrupt another record's meaning. A small additive schema
   change is therefore justified for persistent independent declarations.
6. **One geography front door.**
   `openplan/src/lib/geographies/place-resolver.ts`,
   `lib/api/place-geographies.ts` and `/api/geographies/{places,place-boundary}`
   currently support county, city, CDP, metro and micro through the US adapter.
   They do not resolve sovereign or worldwide authority. Search carries outage
   and unavailable-kind states. `lib/workspaces/home-geography.ts:394` maps
   state-prefixed identifiers through `lib/geographies/state-fips.ts`, including
   DC and territory codes; metro/micro keep subdivision null. This is source
   behavior, not a fresh live-service coverage test.
7. **Readiness consumers.**
   `lib/jurisdiction-readiness/registry.ts:65` matches country and subdivision,
   not county, sovereign body, source reference or authority role. The sparse
   registry currently names California, Oregon and Puerto Rico; other cells
   stay unassessed. Registry authorities are cited statutes, data sources and
   program catalogs, not project adopting bodies. The project panel,
   `/api/projects/[projectId]/jurisdiction-readiness`,
   `lib/jurisdiction-readiness/evidence-bundle.ts` and
   `/api/reports/[reportId]/generate/route.ts:1768` all read `place_*` today.
8. **Retained exports and existing authority home.**
   `lib/project-evidence-bundles/generated-records.ts:258` reads the full project
   row, checks `updated_at`, and freezes project JSON, readiness and GeoPackage.
   `lib/projects/project-geopackage.ts:937` exports `place_*` on `project_area`;
   those attributes describe the geometry, not separately declared jurisdiction.
   `lib/reports/geography-figure.ts:349` likewise describes study geometry.
   Land Use Plans already separates geometry from named responsible bodies,
   roles, source URLs and unresolved/staff-assessed applicability in
   `lib/land-use-plans/plan-context.ts` and `components/land-use-plans/plan-authority-fields.tsx`.
   Its retained context has its own database command path and frozen snapshots
   (`context-snapshot.ts`, `api.ts`). The land-use decisions route includes
   `planContext` and its custody state in the adoption manifest; `public.ts`
   returns the retained snapshot as content. Project readiness is not a
   substitute for that evidence. Generic `linked-plan.json` is not proof that
   every land-use authority record enters a project archive or readable PDF.
9. **CSV and workbook intake.** `lib/projects/portfolio-import.ts:263`,
   `/api/projects/import/route.ts` and migrations
   `20260825000001_reviewed_portfolio_import.sql` and
   `20260825000002_direct_workbook_portfolio_import.sql` retain source-location
   text only. Create-only import does not populate geography. Mapping/default
   schemas are strict; rows require human review and the exact preview hash.
   `lib/projects/portfolio-export.ts` exports existing place identity as
   inspection columns; `portfolio-round-trip-contract.ts` does not import them.
10. **Authorization.** Project PATCH uses the caller's RLS client,
    `loadProjectAccess(..., "programs.write")`, writer roles and audit logging.
    `lib/programs/api.ts:171` selects only basic project fields, so additional
    context reads need explicit projections. The action registry has no project
    jurisdiction write. Its misleadingly named `create_project_record` creates
    a submittal through `/records`; it does not edit the project. Read
    `lib/runtime/action-registry.ts`, `action-metadata.ts` and
    `lib/assistant/action-approval-server.ts` together. Existing executable
    refusals cover workspace jurisdiction and bulk portfolio import, not a
    future project-jurisdiction action.

Unless otherwise prefixed, items 7 through 10 use paths under `openplan/src/`;
migration filenames use `openplan/supabase/migrations/`.

## Proposed bounded implementation

1. **Persist one separate versioned context.** Add nullable
   `projects.jurisdiction_context` JSONB, with a bounded strict schema and SQL
   shape checks. Store explicit unresolved versus declared state and an array
   of jurisdiction descriptors. Each descriptor carries a label, optional
   country/subdivision, source-defined kind, optional namespaced reference, and
   whether staff declared it or the server resolved its identity. No FIPS field,
   fixed state enum or required county belongs in the core type. Multiple
   entries must remain possible for multistate, tribal and overlapping cases.
   Store actor/time from trusted server/database context if exported as
   provenance; never accept client-supplied authorship as verified. Do not
   rewrite existing rows or relax unresolved-geometry rules.
2. **Use the current project edit home.** Put a separately labelled jurisdiction
   editor beside Study area, with save, clear-to-unresolved and cancel. Extract
   or add a search-only mode to the existing picker, retaining the same APIs,
   resolver and search-coverage disclosures. Its geometry response stays local
   to jurisdiction selection and never calls `savePlace`. A named staff-entry
   option preserves unsupported sovereign, regional or international context,
   explicitly unverified by a resolver. This is a mode of the existing geography
   home, not another search service. Keep creation short; route new/imported
   projects to this same editor instead of duplicating setup logic.
3. **Keep writes narrow.** Extend the existing PATCH with a strict independent
   `jurisdiction` payload. Re-resolve supported references and discard any
   client claim of trusted bbox, codes or identity. Validate exact returned
   kind/reference. Update only jurisdiction storage. Use an expected project
   revision and return 409 on stale writes; preserve the draft. A failed lookup
   writes nothing. Explicitly reject malformed or unsupported modes instead of
   stripping fields and reporting success. Do not replace upload geometry,
   change workspace home, bind a stage-gate template or alter a linked plan.
4. **Resolve readiness once, with honest scope.** Add one shared project-context
   reader used by panel, API, reports and archive. A null legacy context may
   retain existing searched-area behavior, visibly labelled as study-place
   context; explicit unresolved suppresses that fallback. Invalid stored
   context/read failure is an error, not unassessed. Never use workspace home
   as an implicit legal substitute. Preserve each declaration separately.
   State-level registry evidence can be shown as state-level guidance for an
   administrative declaration. It cannot claim county-specific, sovereign or
   overlapping-authority support. Unmatched/non-administrative contexts remain
   unassessed. Do not choose the first entry, average statuses or broaden claims.
   Keep the existing single-place v1 payload compatible; add an explicit
   multi-context envelope before exposing multiple assessed entries.
5. **Retain the distinction in artifacts.** Freeze the declared context with
   project JSON and the same readiness payload/hash in API, ZIP and generated
   report. Keep `project_area` source/ref/country tied to the study shape. Add
   separate jurisdiction attributes/record if the standalone GeoPackage claims
   to carry complete project context. Report prose must distinguish uploaded
   study geometry, declared jurisdiction and unresolved adopting authority.
   Existing frozen reports and ZIPs remain unchanged after an edit; new exports
   use the new revision. Their review must become stale after a context change.
6. **Preserve human control and intake limits.** Keep this write outside agent
   actions and add an executable project-specific refusal. Also reject assistant
   execution headers on the write path, using the human-origin/account/workspace
   checks in `/api/land-use-plans/[planId]/context/route.ts` as a reference. Header
   refusal alone cannot identify every automated caller. A later agent action
   needs its own exact-payload approval, authorship and route-local verification.
   CSV location strings, labels, workbook place columns and uploaded feature
   properties remain provenance only. Do not auto-geocode them or infer legal
   authority. Bulk reviewed jurisdiction intake needs its own future exact-row
   mapping and refusal review; it is not required to repair this edit workflow.

## File join and proof required from the parent

Implementation code paths in this section start under `openplan/src/`.
The implementation lane should own `components/projects/project-identity-editor.tsx`,
`app/(app)/projects/[projectId]/page.tsx`, project PATCH and readiness route,
`lib/projects/project-jurisdiction.ts` (new), shared picker extraction/mode,
`lib/jurisdiction-readiness/{contracts,payload,evidence-bundle}.ts`, the project
readiness component, report generation/prose and generated-records adapters.
Reserve an additive migration number through coordination before writing SQL.
Do not touch the other child's `components/projects/project-map-presence.tsx`,
project `project-map-presence-panel.tsx` or map rendering files.
Changes to shared geography consumers require a deliberate join with that child.
Add standalone GeoPackage/workbook export work only where their declared scope
requires it, preserving existing import headers or versioning that contract.

Extend `src/test/project-identity-editor.test.tsx`, `project-record-route.test.ts`,
`jurisdiction-readiness-{routes,registry,evidence-bundle}.test.ts` and
`project-evidence-bundle-route.test.ts` under the nested application. Add
`project-jurisdiction.test.ts` and `refused-project-jurisdiction-action.test.ts`;
extend the existing report tests where generation/rendering changes.
Assert query projections, exact upload coordinates, untouched place/site/corridor
updates, explicit clear/cancel, failed resolution, stale revision, reload and
old-archive immutability. Challenge administrative California and another state,
DC, Alaska/Hawaii, territory, multistate, sovereign/overlap and non-US descriptors;
these are behavior fixtures, not proof of nationwide service or legal coverage.
Retain CSV/workbook tests proving source-location text cannot author jurisdiction.
For every changed guard/test, run a harmless survivor and a targeted defect that
fails its intended assertion, then restore source in `finally` without resets.

The parent coordinates isolated live RLS with owner/admin/member/viewer,
nonmember, cross-workspace, direct SQL writes and stale concurrent updates.
If actor provenance is stored, challenge forgery through direct database access.
Schema upgrade must preserve legacy/null rows and exact geometry. Mocked route
tests cannot prove these database boundaries. No migration is applied here.

The parent also coordinates an identified-build T3 journey from Projects:
upload boundary, independently select jurisdiction, save/reload, change each
fact separately, cancel/clear, then download readiness, report, ZIP and GeoPackage.
Compare actual geometry and same-revision context across artifacts. Capture
desktop and genuine 390px views, console and failures. Preserve the original
journey and the retry's recorded 390px screenshot-metadata mismatch. This report
claims no new browser, practicing-planner, legal, scientific or hosted acceptance.

## Decisions and verification boundary

The technical lead must settle the exact descriptor schema, actor provenance
enforcement, multi-context response version, conflict/retry protocol and standalone
export scope before implementation. The existing project and land-use context
patterns inform those decisions; do not build a second authority registry or
copy the whole plan-command system for a plain jurisdiction declaration.
Which body actually adopts the plan, whether authorities overlap, applicable
rules and sources, and permission to export sensitive authority context remain
responsible-human facts. None is inferred from a boundary or office location.

`npm run product:direction:check` exits 0 on this baseline. It warns that the
readiness registry, capability matrix and capability registry reviews have
expired, and that the latest direction review covers v0.66.0 rather than 0.68.0
and predates substantive changes. Those reminders remain; dates are not repaired
here. This command checks direction records, not product correctness or current
legal coverage. Source inspection and retained diagnostic artifacts support this
design. No application tests, full suites, builds, services, database probes,
live source lookups or browser sessions run in this research lane.
