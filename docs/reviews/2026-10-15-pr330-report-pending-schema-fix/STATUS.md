# Report generation with pending jurisdiction schema

October 15, 2026. Local corrective implementation for
[PR330 finding P2](https://github.com/nfredmond/openplan/pull/330#discussion_r4285653407).
The integration owner remains `/home/nathaniel/.t3/worktrees/openplan/t3-e33fc359`.
This lane does not push, update PR330, merge or release.

## Finding and correction

Confirmed within the real report POST handler under database and Storage test
boundaries. Before the correction, missing `jurisdiction_context` produces HTTP
500 for both PostgreSQL and PostgREST missing-column messages. The existing
fallback selects the older project fields, then passes that row to the strict
jurisdiction reader. The reader correctly rejects an omitted projection.

The corrected route removes only the optional field group named by a recognized
missing-column message. Jurisdiction and study-place columns have independent
read states. A missing jurisdiction column preserves readable place, cost and
site fields. A missing place column preserves a readable jurisdiction, including
its strict validation. If each optional group is actually missing, the route can
still reach the documented core projection in at most four retries. Estimate
and site groups preserve that existing compatibility path; they are not removed
just because jurisdiction or place is unavailable.

Unknown fields, unclassified schema-cache failures and non-schema errors refuse
generation. A failed fallback also refuses generation without writing an
artifact. A malformed existing jurisdiction remains an error. The ordinary
strict reader, ordinary readiness/export builders and their existing schemas
remain unchanged.

Unread jurisdiction uses a report-specific external object,
`openplan.report-project-jurisdiction-schema-pending.v1`. It contains project ID,
revision, registry SHA-256, independent jurisdiction/study-area read states and
the complete disclosure. It contains no context, human declaration, legacy
assessment, support claim or invented recorded time. The SHA-256 covers the
canonical object without its own hash and excludes the generation clock.

The generated HTML prints `SCHEMA-PENDING`, the full explanation, payload schema
and hash. It does not print an unset declaration, explicitly unresolved human
declaration or legacy study-place fallback for an unread jurisdiction. Missing
study geometry retains the existing missing-column explanation in the actual
geography figure. Artifact metadata freezes the same jurisdiction object and
records the study-geography read state separately. Readable jurisdiction retains
external v3, even when study geometry is pending.

## Ownership and checks

The assigned clean branch `t3/pr330-report-pending-schema-fix` starts at
`05dd3e8da4a4572437f06e771b0a2477873e681f` and fast-forwards only itself to exact
local parent `401c44a0f7bfe4b54740e2c3d07e30f8ed36f169`. No fetch occurs.
Owned source is the report generate route, its new report-specific payload
helper, HTML renderer type/markup and focused report-route tests. No project
page, workbook route, shared strict reader, migration or database changes.

Read authority includes AGENTS.md, current external coordination banners,
product contract, roadmap, capability matrix, October 6 direction review,
architecture, known issues, jurisdiction design, correction/export contracts and
[historical native report](../2026-10-15-project-jurisdiction-native/REPORT.md).
Planner-writing, prove-it and any-place apply. No place-specific production
literal or alternative geography resolver is introduced.

The nested direction check exits zero with existing registry/matrix expiry,
release-version and intervening-source reminders. It does not refresh those
reviews or registry evidence. The final restored-source run passes all 101
tests: 87 report-route tests and 14 existing HTML-renderer tests, with none
skipped. Scoped TypeScript and changed-file ESLint also exit zero with zero
warnings. Their largest measured peak is 782,708,736 bytes; all retained final
checks record zero OOM and OOM-kill events.

The accepted controls comprise 21 unique broken behaviors and the harmless
comment repeated in two campaigns. All 21 broken behaviors fail their intended
assertions; both harmless executions survive. These 23 accepted executions
exclude retained rejected attempts. Verification receipts, exact commands,
source bindings and each named control outcome are recorded in
[evidence.json](evidence.json).

All focused runtime, compiler and lint checks acquire
`/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock`.
Each owned transient check service has a 1,536 MiB memory cap, zero swap,
50 percent CPU quota and a 1,024 MiB Node heap. Vitest uses one worker and no
file parallelism. The host is mounted read-only inside the check sandbox, with
only this lane's private directory writable and the network isolated. The
existing donor dependencies are accessed through this checkout's ignored
`openplan/node_modules` symlink. Caches and temporary files belong to this lane.
No installation, download or donor write occurs.

Private receipts remain under
`~/.local/state/openplan/privatepr330-report-pending-schema-fix-20261015`.
The first config attempt fails before test discovery because Vite's runner does
not supply `__dirname` to the imported config. The private config now preserves
the application settings with explicit local paths. That startup error remains
retained and does not count as a failed-behavior control. The next pre-fix run
executes the two named tests and fails the intended HTTP 200 assertion with 500.

The first mutation campaign also remains retained. Its generation-clock mutation
exposes a test helper that compares the second artifact metadata with the first
uploaded HTML. The controller rejects the wrong assertion instead of counting
it as a successful control. The helper now selects the latest actual upload.
The fresh campaign repeats the harmless survivor and all behavior mutations;
the clock mutation reaches the intended clock-exclusion assertion.

A supplemental refusal control initially changes an identically worded campaign
error return rather than the project-load return. Its six project-error tests
survive. The controller rejects that result. The final mutation anchor identifies
the project branch, and a fresh campaign reruns the survivor and both refusal
controls. The unrelated campaign-return mutation is not counted as evidence
about the project guard.

## Controls and evidence limits

[The control driver](verify_controls.py) takes the shared lock across mutation,
execution and restoration. It runs a harmless comment first, requires a survivor,
and then requires the selected tests to fail with the named assertion rather
than accepting any nonzero runner exit. Every mutation restores exact source
bytes in `finally`. The final check uses restored source.

The new assertions inspect the actual route projections, generated uploaded
HTML, stored HTML snapshot, metadata object, canonical hash and two generation
clocks. They cover pending jurisdiction alone, both place/jurisdiction error
orders, missing place with valid or malformed jurisdiction, the older core
projection, unknown/schema-cache/permission/connection failures and a failed
fallback. They do not replace the route, strict reader, HTML renderer or
serializer with passing stubs.

Blind categories remain explicit:

- Projection tests use a database double. They do not establish actual installed
  columns, PostgREST behavior beyond the named message forms, live RLS,
  transaction consistency, membership enforcement or schema-cache recovery.
- HTML text/DOM assertions and uploaded synthetic bytes do not establish browser
  layout, 390px behavior, PDF typesetting, download usability or accessibility.
- Custody/hash assertions cover the emitted fixture object and synthetic Storage
  boundary. They do not establish live Storage persistence, real authenticated
  attribution, native downloaded-file provenance or recipient acceptance.
- Scoped TypeScript and changed-file lint cover these roots and their imports,
  not all application pages, generated build types, a build or the full suite.

Native/database, browser, build, full-suite, hosted and provider behavior on this
changed source are **not confirmed** because this lane is explicitly prohibited
from operating those boundaries. Historical SQL/native evidence and frozen V6
APP49 browser evidence retain their original source identities. They do not
accept this changed head. V6 APP49 runtime, database 6150036, old source/database
proofs, demo and unrelated canonical entries are outside this lane's writes.
The parent owns review, integration and any later checks of those boundaries.
