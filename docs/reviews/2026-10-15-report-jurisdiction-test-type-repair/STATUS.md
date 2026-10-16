# Report jurisdiction test type repair

The report-generation test now narrows the captured insert metadata at runtime.
It keeps the mock payload optional and its source context unknown until named
assertions establish their presence and shape. The readiness value retains its
unknown type; the existing canonical equality assertion checks its runtime value.
No cast, default object, suppression or production change supplies a passing value.

## Source and ownership

- Assigned worktree: `/home/nathaniel/.t3/worktrees/openplan/t3-b3d69208`.
- Branch: `t3/report-jurisdiction-test-type-repair`.
- Base: `80e3035098159deb3127bbb277226ae6f5872870`, reached by a local fast-forward
  from the clean initial `05dd3e8da4a4572437f06e771b0a2477873e681f`. No fetch occurs.
- Changed source: `openplan/src/test/report-generate-route.test.ts`.
- Private copies, check controllers, caches and receipts:
  `/home/nathaniel/.local/state/openplan/report-jurisdiction-test-type-repair-20261015`.
- Dependencies: the existing
  `/home/nathaniel/.t3/worktrees/openplan/t3-0f743997/openplan/node_modules`,
  mounted through the read-only host. No install occurs.

The original readiness comparisons remain. They check actual report metadata,
actor exclusion, generated HTML hash and actor exclusion, bundle JSON across
2028 and 2030 clocks, and SQLite canonical bytes and hashes in both standalone
and bundled GeoPackages. The route, serializers and export fixture remain the
real test subjects. Database, Storage, authentication and PDF boundaries retain
the existing test doubles.

## Bounded verification

The unchanged direction checker exits zero with its existing review reminders.
Scoped TypeScript exits zero for the repaired test and route import graph.
The full report-generation file passes all 72 tests with none skipped. Focused
ESLint exits zero with zero warnings. Runtime versions are Node v24.22.0,
TypeScript 5.9.3, Vitest 4.1.11 and better-sqlite3 12.8.0.

The final control campaign runs a harmless comment first. Both compiler and
focused runtime checks report `SURVIVED`. Restoring the exact original test
then produces only six compiler errors: TS18048 and TS18046 at lines 4314,
4315 and 4328. This compiler control exits two for the original unsafe accesses.

Seven private mutations change the actual route's project-artifact insert.
Each executes the named readiness test alone and exits one with an
`AssertionError` for the intended reason:

- Absent metadata fails `Generated report includes metadata`.
- Missing, null or primitive source context, and an object without readiness,
  fail `Generated report metadata includes jurisdiction readiness source context`.
- Null readiness and a forged all-zero hash fail
  `Report metadata shares external canonical material`.

The controller requires exactly one executed named assertion, the correct exit,
status and diagnostic. It rejects a wrong diagnostic, runner exit and empty
selection. It does not replace the route or serializer with a mock. Its
`finally` block restores the private test and route exactly. The final full-file
run uses those restored bytes. The repaired test SHA-256 is
`82d22da865fdbc0e83feff2812d9869dbe289a73e9d847f53c31965e6b34444b`.
The unchanged route SHA-256 is
`c91d67548e4aa807be70af49c7fa2872d0b1129a6a41a8d51b9832474fcc61ca`.
Final comparisons also bind the unchanged export fixture, application config,
Vitest config and lockfile to the assigned base. Source diff checks report no
whitespace errors. [Evidence](evidence.json) retains commands, counts, hashes,
resource receipts and private evidence-file hashes.

The retained measured checks peak at 695,541,760 bytes, with zero cgroup
OOM and OOM-kill events. The final 72-test run peaks at 349,925,376 bytes.
These measurements do not replace the parent's larger build measurements.

Early attempts remain visible in private receipts. The first wrapper cannot
locate cgroup counters after unsharing the cgroup namespace; the corrected
wrapper keeps that namespace visible. The first scoped config misses ambient
GeoJSON types because its type-root lookup starts outside the application;
the explicit application type root corrects this setup issue. The first control
parser expects a JSON field absent from this Vitest version. The second expects
one failing suite, while this reporter counts both the enclosing describe and
file. The final parser checks the one executed test's status, counts and named
failure. Neither parser rejection counts as a successful behavior control.
Both rejected campaigns restore source bytes in `finally`.

The scoped TypeScript configuration extends the unchanged application config.
Its roots are the changed report test, the real generate route and a private
`next-env.d.ts` with the standard Next.js type references. It follows their
transitive imports, disables incremental output and resolves the application's
`node_modules/@types` explicitly because the scoped config lives outside the
application. It does not include all project pages or generated build types.

Each check runs inside a transient cgroup with `MemoryMax=1G`, no swap,
`CPUQuota=50%` and Node's 640 MiB heap limit. Bubblewrap mounts the host read-only,
allows writes to the assigned private directory and private temporary files,
and isolates the network. The recorded mount table establishes the dependency
write boundary. Subsequent compiler and Vitest checks acquire
`/usr/bin/flock /home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock`.
The already-running pre-steering compiler check finishes without interruption.
Vitest uses one worker and no file parallelism.

## Limits and parent handoff

These checks cover TypeScript's mock boundary and the real route/serialization
paths under synthetic fixtures. They do not establish live database projection,
RLS, deployed schema, native downloaded-artifact provenance, browser behavior,
legal applicability, scientific validity or practitioner acceptance. Opening
synthetic GeoPackage bytes with native SQLite proves those byte comparisons,
not a live export journey. The metadata source field remains unknown in the
mock until the runtime assertions narrow it.

The separate `ProjectRow.jurisdiction_context` compiler repair belongs to the
other child. No project types or page fixtures change here. Parent review and
join, whole-project TypeScript, a new binding and any later build remain open.
No full build, full QA, database, browser, application service, PR, push, main
integration or release runs here.

The parent's failed v2 build record remains outside this repair. Its supplied
failed exit, partial output, intents and lack of an accepted build identity are
not reclassified or rerun. This work does not write frozen v2 or earlier native
proof artifacts, source anchors, the canonical checkout, demos or hosted systems.
