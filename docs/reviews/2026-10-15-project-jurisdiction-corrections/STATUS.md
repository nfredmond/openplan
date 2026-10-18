# Three jurisdiction corrections, local candidate

October 15, 2026. This correction owns only the assigned checkout
`/home/nathaniel/.t3/worktrees/openplan/t3-06d1c54c`, branch
`t3/fix-project-jurisdiction-review-findings`. It starts clean at
`05dd3e8da4a4572437f06e771b0a2477873e681f` and advances with the requested
`git merge --ff-only` to exact candidate
`53485a708512de34443e63ee38132a4f5991f36e`. No reset or other checkout changes.

Read authority includes AGENTS.md, the first external COORDINATION entries,
parent decision JSON, accepted DESIGN.md, candidate implementation STATUS and
provenance, the binding contract, sole roadmap, capability matrix, direction
review, architecture and known issues. Planner-writing, prove-it and any-place
apply. Product direction exits zero with the existing expiry and release-age
reminders. This does not refresh registry evidence or establish coverage.

The independent report at review commit
`3ff9808bc7b8102b5854ce5a634c1b29086b9cb9` is preserved verbatim in
[original-review/REVIEW.md](original-review/REVIEW.md). Its SHA-256 is
`e38429cc09f01c6b7fd373cc7d6c10e4c25411943215510bcab9bdd9b4f1eb62`.
Both temporary probes are preserved with their original hashes. They remain
historical reproductions against candidate source and temporary paths, not
runners for this replacement candidate. Their original observations and limits
are unchanged. No disagreement with the three P2 findings remains.

## Retained drafts keep their original scope

Editing captures project, authenticated account, workspace and project revision.
A committed change to any scope field, revision or write permission invalidates
the draft for submission. The editor shows its original scope and preserves its
entries. It offers comparison against current saved context and an explicit
restart from that context. It does not silently transfer or discard intent.
An intervening account change remains invalidating even after switching back.

Request URL, expected-user/workspace headers and expected revision come from the
captured scope. In-flight responses cannot close the retained draft or refresh
another scope. The editor checks scope again after asynchronous error parsing.
These are retained React DOM tests and handler assertions, not login, network,
permission-enforcement or browser evidence. Existing route and database checks
still govern actual writes. A response may reflect a write that already reached
the original project; the editor does not claim it rolled back that write.

## Internal custody and external hashes have different versions

The trusted stored context remains strict internal version 1, including
`recordedBy` and database/server recorded time. Ordinary authenticated readiness
reads retain `openplan.project-jurisdiction-readiness-response.v2`. Workspace
readiness remains v1. These internal reads are not promised byte parity with
minimized external exports.

New external files use `openplan.project-jurisdiction-readiness-export.v3`, with
`scope: external_handoff`, explicit attribution policy, project ID/revision,
registry version and exact registry SHA-256. Their context uses
`openplan.project-jurisdiction-context-export.v1`. It retains recorded time,
source references, labels, declared identity and individual assessments, while
omitting the internal actor UUID. Strict internal validation runs before this
conversion. Export-safe context is not passed back through the internal parser.

The hash is SHA-256 over `canonicalizeActionPayload` of this external object
without `payloadSha256`. It excludes the file-generation clock. New report
metadata, report hash text, `?download=1` readiness JSON, bundle readiness JSON
and standalone/bundle GeoPackages all use that representation. Report HTML
also discloses schema, scope, registry identity and recorded time. The report
renderer still accepts existing internal v2 payloads for compatibility. Retained
reports and archives are not rewritten.

The API distinction is deliberate. Previously all project readiness outputs
used internal v2 bytes. The download query now selects external v3; ordinary
reads retain internal v2 custody and its own hash. Comparing the internal v2
hash directly to an external v3 hash is invalid, even at the same revision.
Use the download representation to compare external artifacts. This is a new
unshipped candidate contract, not silent reinterpretation of a retained hash.

Generated records preserve the raw trusted row for strict readiness/GeoPackage
builders. The exported project JSON gets the versioned external context. The
existing identifier sanitizer also recognizes `recordedBy` and `recorded_by`
where they appear elsewhere in external record metadata.

## GeoPackage carries the shared material separately

The registered `project_jurisdiction_context` attribute record retains project
and revision, context scope, export-safe context JSON, readiness schema,
registry version/hash, complete canonical readiness JSON and payload hash.
The shared reader derives its assessments. No separate assessment algorithm,
geometry transform, source coordinate change or WKB change is introduced.
Callers without a jurisdiction projection retain an explicit geometry-only
scope and null readiness columns. Null legacy and explicit unresolved remain
different. Invalid trusted context still refuses export.

The actual generated-file adapter uses a non-null sovereign/international
synthetic declaration. A report-route check also generates its HTML and metadata
in 2028, then compares the actual bundle JSON and both GeoPackages generated in
2030 against that report material and hash. Both dates are synthetic clocks. Real `better-sqlite3` reads both standalone and generated
bundle files. The checks compare canonical material, hashes, registry identity,
source attributes and WKB across different generation clocks. These are actual
file-builder checks with synthetic database query results. They do not establish
authenticated delivery, ZIP transport, real source coverage or GIS-recipient use.

## Checks and retained failed trials

`final-01` runs 138 passing tests across 11 relevant files, zero failures,
scoped TypeScript and changed-file ESLint with zero warnings. TypeScript covers
jurisdiction roots and transitive imports; it does not include the report-route
test's full dependency graph or the whole application. Runtime report tests
exercise that adapter. Final source bindings match all 15 changed TypeScript
files exactly. Source-only `git diff --check -- openplan/src` reports no
whitespace errors. Raw terminal logs retain their original trailing whitespace;
the two staged-log whitespace diagnostics are retained separately.

`controls-04` records 21 harmless survivors and 41 intended assertion faults.
`controls-05 supplemental` records five harmless survivors and five intended
faults, including the new permission round-trip scenario. Together they cover
22 distinct changed assertion groups, with both kinds of control for each.
[Assertion coverage](assertion-coverage.json) maps the exact tests and named
diagnostics to raw receipts. Both campaigns' classifier rejection controls pass.
The extra genuine survivor in controls-04 remains visible and excluded from
intended-fault counts. Source restoration matches every bound file in both
campaigns and final checks.

Every check runs serially with one Vitest worker inside an owned transient
command scope capped at 1,073,741,824 bytes memory and zero swap. Final checks
peak at 799,895,552 bytes (762.8 MiB), with zero cgroup OOM events. The two retained
control scopes peak at 330,285,056 and 334,221,312 bytes. Dependencies are read
through the existing canonical node_modules symlink; Vite caches are private to
this assigned checkout under ignored `.tmp/`. No install occurs.

The synthetic sample in [sample-payload.json](sample-payload.json) has external
SHA-256 `227a1a48160cbd34fd55fb2bb1c742ee967b1a81c710b9f0e1d6ae60db443e61`.
Its distinct internal v2 hash is
`e4cc21e6b9e685e51f0f6b35b7c4677521adcd6d3cb1414128d27111067683ad`.
Both use registry `2026-10-11.1`, SHA-256
`531dca87cc6621786d4cff27b0fb52dd5b99105c3a78c6307a9a35322201c158`.
These hashes describe the retained synthetic fixture, not a live project.
[Provenance](provenance.json) binds source, limits, versions and diagnostics.

The mutation controller runs one selected test at a time. Each changed assertion
group gets a harmless comment survivor and a named intended assertion fault.
Its classifier requires exactly one executed named test, exit 1 and the expected
AssertionError diagnostic for a fault. It rejects setup errors, wrong assertions,
wrong tests, crashes and empty/skipped selections. Source restores in `finally`.

Baseline-01 fails before tests because the copied config has one extra parent
path. Baseline-02 corrects that path and executes tests. Controls-01 refuses its
harmless result because Vitest reports excluded tests as `skipped`; the corrected
classifier counts executed `passed`/`failed` assertions and keeps all rejection
checks. Controls-02/03 also refuse real assertion failures whose default Vitest
messages abbreviate the differing objects or schema strings. Explicit assertion
labels identify those diagnostics without broadening the classifier. Types-01 exceeds a 640 MiB V8 heap while including the large report-route
test dependency graph. Types-02 narrows roots and finds a local inferred-type
issue in the editor's restart closure. An explicit reader return type corrects
that issue. Controls-04 records one genuine survivor: removing permission-change
tracking still refuses a response while permission remains revoked, because a
second current-permission check holds. A new revoke-and-restore test exposes the
intervening-scope requirement; the targeted control then tests that scenario.
These trials are preserved, not counted as successful checks.

## Parent verification remains open

No new migration is needed. Candidate migration 16 remains unchanged and
unapplied. Its SHA-256 remains
`1384e6a2767827c2b756d978bd6e76f6fea364e4e1263e953c0358364341267f`.
No full suite, production build, native PostgreSQL/role/SQL, live RLS, database,
browser, demo, hosted setting, service, PR, push or main integration occurs.
Only resource-bounded transient command scopes run; no application service starts.
No nested delegation or process termination occurs.

The parent still owns native SQL/authorization/upgrade/restore proof, independent
review of this replacement head, and identified-build desktop/390px/account/
permission journeys. Actual downloaded report, JSON, ZIP and GeoPackage should
be compared at one revision and registry identity. Frozen Storage custody,
practitioner/public usefulness, complete accessibility, legal/scientific and
native GIS interoperability remain unproved.

M1/CORE-GEO-01 remains partial. The 12-declaration cap is now labelled a development
limit in the editor; it is not the v1 destination. The parent can link this record
into the existing requirement evidence mapping without creating another queue.
All-state/DC, territory, sovereign/overlap and worldwide obligations remain.
