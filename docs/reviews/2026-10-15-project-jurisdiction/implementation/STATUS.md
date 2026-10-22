# Separate project jurisdiction, candidate implementation

October 15, 2026. This is an implementation candidate, not a release or a database
rollout. No database receives migration 16 in this lane.

## Ownership and source

Assigned checkout: `/home/nathaniel/.t3/worktrees/openplan/t3-85a6a802`.
Branch: `t3/project-jurisdiction-context`. The clean assigned checkout started at
`05dd3e8da4a4572437f06e771b0a2477873e681f` and fast-forwarded to
`1b2fefe0f0e98f99700fc77e99146fe697b43ee7`, the fetched `origin/main`.
The only cherry-pick is the accepted design report from
`f5b0ad4b4db33ec20294bf3d3fa62e8b4a867737`, retained as `e211afedb`.
Read [the complete source audit](../DESIGN.md) alongside this record.
The parent decision record is
`~/.local/state/openplan/project-jurisdiction-decisions-20261015.json`.

T3 task: `sol-project-jurisdiction-implementation-20261015-round1`.
The implementation owner uses GPT-6.1 Sol high, without nested delegation.
The task ID and source hashes are retained in `provenance.json`.

This lane owns the independent project jurisdiction editor, its mount in the
identity editor and project page, the existing picker's search-only mode,
project PATCH/readiness and new-report adapters, shared context/readiness reader,
evidence/GeoPackage adapters, additive candidate SQL, focused tests and this proof.
One Unreleased changelog entry identifies the candidate migration and rollout limits.
Saved maps, camera helpers, map-presence components, canonical untracked files,
and the parent's immutable preview/account/database/browser remain outside this lane.

## Behavior

`projects.jurisdiction_context` is nullable, strict, versioned and bounded to 12
descriptors. Explicit unresolved state has no entries. Each declaration carries
its own label, source-defined kind, optional namespaced reference, optional ISO
country/subdivision and administrative, sovereign, overlapping or other scope.
The core has no fixed state, county or FIPS enumeration. Identity records whether
staff declared it or the server resolved it through the existing place adapter.
Neither identity mode establishes adopting authority or legal applicability.

The existing project home contains independent save, clear-to-unresolved and
cancel controls. Basic creation and reviewed import still open this same project
home. Search uses the existing picker/APIs/resolver, with no drawing or geometry
callback in search-only mode. Unsupported contexts accept an explicitly unverified
staff declaration. CSV/workbook labels and uploaded feature properties remain
source provenance. No intake mapping, geocoding or implicit jurisdiction is added.

The jurisdiction command is strict and separate from other PATCH fields. The
route checks current user access, browser origin and expected account/workspace,
refuses approved-agent execution headers, and requires the expected project
revision. Supported search identities re-resolve on the server and must match
kind/reference exactly. The service write contains only jurisdiction context,
with project/workspace/revision predicates. A conflict returns 409 and keeps the
editor draft. Study-area upload/clear still uses the caller's RLS client and
writes no jurisdiction. Jurisdiction writes contain no study place, site or corridor
fields. The executable agent-registry refusal remains project-specific.

The candidate SQL rejects ordinary authenticated INSERT/UPDATE authorship of the
column, including forged actor/time or resolved-identity metadata. The service
seam carries the authenticated actor, rechecks and locks current writer membership,
and stamps database time. Trusted postgres archive restoration preserves recorded
provenance and revision. These are source-level controls requiring native proof.
Browser-origin headers cannot identify every automated caller. The refusal
prevents registering this mutation as an approved Planner Agent action; it is not
an assertion that a program can never imitate a logged-in browser.

Project readiness uses `openplan.project-jurisdiction-readiness-response.v2`.
Each declaration has an independent assessment. Staff, sovereign, overlapping and
other unsupported declarations remain unassessed. Administrative state-level
registry guidance appears separately for unverified administrative declarations.
Resolved administrative identity receives only the registry's disclosed
administrative state-level assessment. No entry represents the whole list and no
statuses are averaged. Workspace readiness retains its single-place v1 payload.

An explicit database null permits labelled legacy study-place context. Explicit
unresolved suppresses that fallback. Missing projections, invalid stored metadata
and failed reads produce errors, not unassessed success. Workspace home is not an
implicit jurisdiction or legal fallback.

The shared project reader feeds the page, API, new reports and evidence JSON.
The project revision, context and canonical payload SHA-256 travel together.
New report HTML distinguishes context from study geometry and prints the payload
hash. Evidence generation reads one project row and verifies its revision against
the requested project. The existing freshness check refuses review after a project
revision changes. New exports retain context separately in the GeoPackage
`project_jurisdiction_context` attribute record. `project_area` attributes and WKB
continue to describe the study geometry. A caller that supplies no jurisdiction
projection receives an explicit geometry-only scope statement. Existing retained
report/ZIP objects are not rewritten by these builders.

## Bounded checks

- Product direction exits 0. Existing registry/matrix review-expiry and release-age
  reminders remain. This checks direction records, not product correctness.
- `final-checks-02/tests.json`: 173 tests across 16 relevant files pass serially, one worker,
  1 GiB cap and zero swap. The final serial type/lint/test service peaks at 749.4 MiB; resource output is retained in final-checks-02.log. These cover ordinary project
  edits, uploads, picker behavior, context editing, PATCH/readiness, report generation,
  bundle generation/revision checks and actual in-memory SQLite GeoPackage bytes.
- `controls-07/summary.json`: 30 harmless comment mutations survive, one for each
  selected assertion group; 49 targeted behavior mutations fail at their selected
  assertions. Source bytes restore exactly. The portable runner loader uses an
  owned cache. Oracle controls reject setup errors, empty selections and wrong-test failures.
- `final-checks-02/types.log`: the scoped TypeScript program passes. Its explicit roots and
  transitive imports are defined in `tsconfig.json`. It is not whole-application
  TypeScript or a production build.
- `final-checks-02/lint.log`: owned TypeScript files pass ESLint with zero warnings.
  Final checks and exact source bindings are recorded in `provenance.json`.

The controls test strict metadata and bounds, exact re-resolution, missing/invalid
stored context, unresolved fallback suppression, separate multistate/territory/
sovereign/overlap/international declarations, trusted actor/time construction,
query projections, account/origin/agent refusal, CAS, narrow writes, exact upload
coordinates, clear/cancel/conflict, retained hashes, WKB, report escaping and
stale-bundle review. Fixtures include California, Oregon, DC, Alaska, Hawaii,
Puerto Rico, a Canadian subdivision and sovereign/overlapping contexts. They
establish neither source availability nor geographic, legal or scientific coverage.

`prove.py` rejects runner/import failures, empty selections and failures in a
wrong named test as proof. It retains each result, exact assertion diagnostic and
source binding, and restores bytes in `finally`. The first campaign rejected an
async assertion diagnostic it did not yet recognize. The second rejected a DOM
query exception instead of a named assertion; the test now uses an explicit draft
retention assertion. Those failed campaigns remain. Campaign 06 also rejects an ambiguous harmless-comment anchor; the controller now uses a unique source prefix. Earlier ordinary failures
exposed an incomplete HTML fixture, an old v1 expectation and a nullable resolver
label; those remain in the dated logs with subsequent corrections. Loader setup
failures count as no tests. The portable runner loader and owned cache avoid
config-bundle temporary writes through borrowed dependency directories. No npm
install occurs in borrowed modules.

## Parent acceptance remains open

No full suite, production build, live stack, browser, hosted apply, deployment,
PR, push or main merge occurs here. No process is killed. The main hold remains.
The following evidence is still required before rollout:

1. Apply only the reviewed candidate SQL to a newly owned isolated predecessor
   schema. Confirm null legacy rows, exact geometry, site and corridor records
   survive. Challenge malformed keys/types, bounds and provenance. SQL parsing,
   trigger execution, permissions, function inventory and actual error codes are
   not established by TypeScript tests or source inspection.
2. Probe owner/admin/member/viewer, nonmember and cross-workspace behavior with
   real RLS. Attempt ordinary direct INSERT/UPDATE with forged actor/time and
   server-resolved identity. Verify ordinary geometry edits still work and retain
   context. Challenge service writes attributed to absent/read-only/wrong-workspace
   actors, concurrent membership revocation and two simultaneous revision saves.
3. Verify database-generated time and exact actor retention through the authorized
   route, then archive/restore context and geometry without rewriting provenance.
   Mutate each SQL guard in the isolated test stack and observe the intended failure.
4. Build the joined identified revision, including the separate map/camera fixes.
   Navigate from Projects, upload geometry, independently edit jurisdiction,
   save/reload/change each fact, cancel, clear and challenge failures. Inspect real
   desktop and 390px layouts, keyboard operation and console.
5. Download readiness, report, ZIP and GeoPackage at one project revision. Compare
   actual declaration/payload hashes and exact geometry. Edit context, verify old
   archive/report hashes remain unchanged, and verify review becomes stale.

The DOM tests do not prove visibility, accessibility, navigation or rendered
artifacts. The SQLite comparison does not prove GIS-recipient interoperability.
Mocks do not prove database authorization or direct-write protection. Neither
source checks nor agent journeys replace practicing-planner/public observation.
Registry dates and sparse coverage remain unchanged. This candidate closes no
whole-product geography, legal, scientific or Stage A acceptance obligation.
