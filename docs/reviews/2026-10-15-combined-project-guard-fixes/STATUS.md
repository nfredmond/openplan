# Two combined-candidate guard failures

## Source and ownership

The assigned branch is `t3/fix-combined-project-guard-failures` in
`/home/nathaniel/.t3/worktrees/openplan/t3-af1c3fc7`. It started clean at
`05dd3e8da4a4572437f06e771b0a2477873e681f` and fast-forwarded locally to
`b4dbcac21a58f61bd480ccade4dec69383dacbc7`. This work does not use newer
`origin/main` as its source. The parent and source-owner checkouts remain untouched.

Scope is four project-copy components, the copy baseline, the reference guard
and its scanner, and this review directory. No production query, model,
jurisdiction payload, migration, CSV import/export, saved geometry, worker
journal test or preview launcher changes belong to this checkpoint.

## Both failures come from the combined candidate

The two original files fail with two failures and eight passes on exact `b4`.
The same files pass all ten cases against a private `git archive` snapshot of
`b259d73e56d22d4935ef2789874cf69901786b33`, using the same borrowed dependencies.
The package manifest and lockfile are identical between these commits.

The copy assertion is an equality. Five terms increase and one decreases.
The source comparison explains each change.

| Term | Recorded baseline and b259 count | b4 count | Corrected count |
| --- | ---: | ---: | ---: |
| basemap | 2 | 3 | 2 |
| geometry | 10 | 11 | 10 |
| readiness | 30 | 35 | 30 |
| record | 230 | 231 | 230 |
| study area | 20 | 22 | 20 |
| workspace | 137 | 136 | 136 |

`39f284610` adds the saved-map caption and project-map introduction. Its caption
adds basemap, geometry, record and study area. Its introduction adds study area
and removes workspace. `ab0f3d3d7` adds four readiness occurrences in the project
jurisdiction editor and panel; `374250405` adds the fifth in the declaration
limit disclosure. The correction uses shapes, project boundary, map sources
and jurisdiction assessment. It banks `workspace: 136`; no baseline increases.
The warnings about jurisdiction, surveyed boundaries, invalid saved information,
legacy fallback and separate assessments remain present.

The reference assertion fails with `expected 250 to be less than 250` in
`guards the guard`. The scanner finds 2,007 selects and 249 unknown projections
on b259; b4 has 2,008 selects and 250 unknown projections. The added unknown is
`src/app/api/projects/[projectId]/jurisdiction-readiness/route.ts`, whose select
changes from a literal to imported `PROJECT_JURISDICTION_COLUMNS` in
`ab0f3d3d7`. The report generator's existing unknown template adds
`jurisdiction_context`, but remains one unknown site and causes no count growth.

## The scanner checks direct exported literals

The scanner parses directly imported, named `const` string literals from local
TypeScript modules. It follows relative and `@/` imports and import aliases,
without executing those modules. Computed values, interpolated templates,
mutable exports, private bindings, packages, missing modules and re-exports
remain unknown. A name that also has a local binding remains conservatively
unknown, including untyped parameters and declarations before initialization.

This makes 69 previously unknown projections checkable, including the actual
jurisdiction reader. All 2,008 selects remain in the census; unknowns fall to
181. The unknown ceiling falls from `< 250` to `< 182`, retaining one-site
growth sensitivity. The view exemption list, schema checks, dynamic-table
registry, delete-helper checks and existing query-field tests remain intact.

Production query fields do not change. The new test pins the jurisdiction
reader to `projects` and to these exact fields, then checks the migration schema:

`id, updated_at, jurisdiction_context, place_label, place_country_code, place_subdivision_code`

The source inventory and hashes accompany the review evidence. Raw logs and
the comparison snapshot stay private under
`~/.local/state/openplan/combined-project-guard-fixes-20261015/`.

## Verification and limits

Every test run uses the actual nested application cwd, one Vitest worker,
a private Vite cache, a 1 GiB cgroup memory limit and zero swap. The borrowed
canonical `node_modules` is mounted read-only with systemd `ReadOnlyPaths`.
The product-direction check passes, with existing age and version reminders.

Final checks pass: 175 tests in nine focused files, scoped TypeScript, and lint
for all seven changed source/test files. The tests include both failing files,
saved-map and jurisdiction cases, the write-policy guard, and both GTFS guards
that share the select scanner. The final check scope peaks at 572,157,952 bytes
(545.7 MiB), with no swap or OOM events. All 2,008 select sites remain scanned;
1,802 now meet the existing table/projection/view criteria for column checking.

The mutation runner saves source bytes, restores them in `finally` after each
trial, checks restoration and writes hashes. It requires each fault to produce
an assertion failure in its named test, with exit code 1. Baseline and harmless
edits must exit 0, so a broken test-runner invocation cannot count as a kill.

The controls cover added jargon, return of the banked workspace word, removal
of the actual reader, omission of its jurisdiction field, a nonexistent imported
column, disabled literal resolution, acceptance of mutable/private/template
values, missed parameter shadowing and one new unknown projection. All 11 faults
fail their named assertions. Baseline, harmless and restored runs pass. The
control scope peaks at 386,527,232 bytes (368.6 MiB), with no swap or OOM events.
Results, source bindings, exact restoration and resource limits are recorded in
`evidence/`. A final diff confirms no production API, library or migration changes.

The copy guard cannot see every prop, concatenated sentence, wording judgment
or visual layout. The projection scanner cannot resolve computed imports or
embedded-resource fields. The schema inventory does not prove installed schema,
RLS, view columns, query results or live recovery. Conservative shadow handling
can leave a resolvable import unknown. The mutation harness proves its listed
cases, not all scanner syntax or production behavior.

No full suite, build, browser, database, service, dependency installation,
provider operation, hosted change, PR, push or main merge runs in this lane.
The parent owns combined QA, browser evidence, build and landing. This checkpoint
does not establish visible-workflow acceptance or full-candidate acceptance.
