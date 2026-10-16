# Jurisdiction correction receives bounded source acceptance

October 15, 2026 UTC. Independent review of exact candidate
`f18ea8cd51d12168ec2766e1fc5cc34eeb775df2`, whose parent is
`53485a708512de34443e63ee38132a4f5991f36e`.

**No new P1 or P2 finding.** The three original findings are addressed within
this source and synthetic execution boundary. The parent can proceed to its
isolated native and joined-build verification. This report does not authorize a
main merge, migration application, deployment or acceptance claim.

## Review identity and authority

The assigned review tree is
`/home/nathaniel/.t3/worktrees/openplan/t3-b47cd02d`, branch
`t3/review-jurisdiction-correction-independent`. It starts clean at
`05dd3e8da4a4572437f06e771b0a2477873e681f`. Fetching `origin main` and
fast-forwarding only this review branch advances it to
`b259d73e56d22d4935ef2789874cf69901786b33`, the parent PR327 merge.
The implementation is not merged, checked out or cherry-picked here. Exact
candidate Git objects are extracted into a private temporary directory for
read-only source loading. The owner tree `t3-06d1c54c` remains untouched.

This reviewer owns only this report directory and temporary private probes.
Read authority includes current AGENTS.md; the first entries in
`~/.local/state/openplan/COORDINATION.md`; the parent decision JSON; the accepted
`f5b0ad4b` design; original implementation STATUS/provenance; the entire original
independent report at `3ff9808bc`; correction STATUS, provenance, coverage,
receipts and failed trials; the binding contract, roadmap, capability matrix,
requirements ledger, October 6 direction review, architecture and known issues.
Planner-writing, prove-it, any-place and Supabase guidance apply.

The nested `openplan/` product direction check exits 0 on the review baseline.
Its expired registry/matrix, release-version and intervening-change reminders
remain. This checks direction records, not current legal coverage or readiness.
The first coordination banner records the main merge hold, hosted schema
418/latest 15 and candidate 16 absent. Those are parent-recorded operational
facts, not this reviewer's live production queries.

[Provenance](provenance.json) records exact commits, environment and limits.
No nested agent, application edit, full suite, build, browser, PostgreSQL command,
live database, migration, application service, hosted operation, PR, push or
main merge occurs. Transient command scopes enforce 1 GiB memory and zero swap.
Dependencies are read from existing canonical node_modules. No installation,
shared dependency mutation or shared cache write occurs.

## The original findings remain preserved and are addressed

The correction's `original-review/REVIEW.md` matches the entire Git object from
`3ff9808bc` byte for byte. Its SHA-256 remains
`e38429cc09f01c6b7fd373cc7d6c10e4c25411943215510bcab9bdd9b4f1eb62`.
The original probes and disagreements remain historical evidence. In particular,
the GeoPackage hash finding applied a later review requirement. The original
design required a separate context record there, rather than the complete
readiness hash. This review does not rewrite that scope distinction.

### Retained intent stays with its captured scope

`openplan/src/components/projects/project-jurisdiction-editor.tsx:27–59`
captures project, account, workspace, revision and a committed-scope epoch.
`useLayoutEffect` records changes to those fields and permission. The draft keeps
its original capture. Submission checks both the current values and epoch, so a
switch away and back cannot silently rehabilitate old intent. A stale draft
remains inspectable, with explicit comparison/restart from current saved context.
The request URL, headers and expected revision use the captured scope.

The response path checks the epoch and current write permission before closing
editing or refreshing. It checks again after asynchronous error-body parsing.
A transport rejection retains the draft. These checks do not reverse a write
that already reached its original project. The original scope may therefore
need a saved-record read before restart, as the UI text states.

Independent React 19 DOM probes retain the real component across account,
workspace, project, revision, revoked-permission and missing-permission round
trips. Each refuses submission, retains the selected entry, and permits a new
submission after explicit restart. Additional probes cover an in-flight success
after an account round trip and a deferred error body after a workspace change.
Leaf picker/navigation controls and fetch are stubs. This is React reconciliation
in jsdom, not actual login, server authorization or browser navigation.

### Internal custody and external representation have explicit versions

`openplan/src/lib/jurisdiction-readiness/payload.ts:66–88` builds the strict
internal payload before converting it. Stored context still requires the actor
UUID and trusted recorded time. The external context has schema
`openplan.project-jurisdiction-context-export.v1`; it omits the internal actor,
retains recorded time and descriptors, and is not fed back into the internal
parser. Invalid storage cannot become valid merely by dropping attribution.

Ordinary authenticated reads retain internal response v2. The `download=1`
branch selects `openplan.project-jurisdiction-readiness-export.v3`, with explicit
`external_handoff` scope, attribution policy, project revision and registry
identity. The canonical hash covers that actual external material without its
own hash field. It excludes the file-generation clock. Internal and external
hashes deliberately differ. Their hashes cannot be compared as if they described
one representation. Workspace readiness remains v1.

The generated-record adapter keeps the trusted row for strict builders and
converts project JSON to the external context. Its recursive minimizer now
recognizes both actor-key spellings. The independent fixture includes nested
`recordedBy` and `recorded_by` metadata, plus a retained citation. The complete
adapter removes those UUIDs and retains the citation. Standalone readiness JSON,
bundle JSON and generated GeoPackages contain the external representation.

The readiness route still calls `getUser` and uses the caller client. Its
projection includes jurisdiction and revision. Independent route execution with
explicit synthetic transport stubs observes 401 without a user, 404 for an
invisible row, 500 for malformed context, internal custody on ordinary reads,
and minimized v3 on download. Download headers remain private/no-store and an
attachment. No service-role reader is introduced here. These probes do not prove
RLS, session revocation or real cross-workspace confidentiality. Supabase's
[current RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)
places enforcement in database policies and privileges; a mocked read is not
that enforcement. The changelog index was also fetched. Its recent HTTP/TLS
notice establishes no candidate authorization behavior.

### GeoPackage now carries the same external canonical material

`openplan/src/lib/projects/project-geopackage.ts:688–706` writes a separate
registered attribute record. It includes external context, revision, schema,
registry version/hash, canonical payload JSON and payload hash. It calls the same
reader as the other exports. No alternative assessment algorithm is added.
Callers without the jurisdiction projection receive an explicit geometry-only
scope and null readiness columns. The actual standalone route projects the
column, so normal export does not accidentally take that compatibility path.

Independent probes run the actual generated adapter and `better-sqlite3`
builders. They compare standalone and bundle GeoPackages with separate JSON,
bundle JSON and report HTML from one synthetic project revision. Every canonical
payload/hash matches across 2028 and 2031 file-generation clocks. Both SQLite
files omit the actor UUID. The complete `project_area` row, including WKB and
source attributes, matches the legacy-context comparison. Input objects remain
unchanged. The actual HTML builder prints the external hash, registry identity
and recorded time, escapes the source label, and omits this jurisdiction actor.

The report route itself is inspected, not independently executed by this
reviewer. It reads `jurisdiction_context`, builds external v3 once, passes it to
HTML generation and retains it in artifact metadata. The candidate's bound
report-route receipt additionally exercises its upload/metadata adapters with
synthetic transport results. Actual PDF rendering, Storage custody and delivery
remain separate work.

## Geography and authority claims remain bounded

The source-defined descriptor keeps optional namespaced references and country/
subdivision codes. The shared core has no fixed state or county list. Supported
resolved identities use the existing TIGERweb path. Unverified staff entries
preserve sovereign, overlapping, regional and international contexts without
inventing a resolver or legal finding. The independent mixed fixture preserves
all four declarations separately. Sovereign, overlap and international entries
remain unassessed; administrative guidance remains separately labelled.
Resolved administrative identity receives state-level guidance, not local,
sovereign or adopting-authority approval.

Legacy null permits labelled study-place context. Explicit unresolved has no
fallback. Missing projection and malformed storage refuse the export. Workspace
home does not substitute for these facts. The synthetic assertions establish
those semantics, not source-service availability or legal currentness. Registry
citations and dated review limits remain attached; no cited law is newly
validated here.

The editor now labels the 12-entry maximum a development limit. That is
consistent with a bounded increment. It does not complete M1/CORE-GEO-01 or
remove the all-state/DC, territory, sovereign/overlap and worldwide obligations.
The parent should retain this limit in its existing requirement evidence mapping.
No new queue or module is warranted by these corrections.

## Retained receipts support their stated claims

Independent comparison finds no mismatches in all 15 provenance bindings, nine
controls-04 bindings, five controls-05 bindings and 15 final bindings. The final
receipt has 138 passing assertions, zero failures or pending tests and 11 file
results. Its 22 nested suites are not 22 files. TypeScript and changed-file
ESLint receipts exit 0. They are inspected receipts, not reruns here. The scoped
TypeScript roots exclude the report-route test's full dependency graph and do
not prove whole-application compilation or a production build.

All 73 raw controls-04/05 receipts are checked against their selected test names.
Each executes exactly one assertion. Between one and 71 unselected assertions
remain excluded in those individual receipts. The classifier correctly counts
executed passed/failed assertions rather than treating exclusions as executions.
Coverage maps all 22 changed assertion groups to harmless and intended-fault
receipts. Counts are 26 harmless survivors and 46 intended assertion failures.
The additional genuine survivor stays separate. Removing permission epoch
tracking did not defeat a test where permission remained revoked, because the
current-permission check still refused it. The supplemental revoke-and-restore
test exposes that different behavior and fails the targeted mutation. That is a
preserved finding and correction, not a manufactured perfect score.

The controller requires a selected assertion and its named diagnostic. Its
rejection controls cover setup/type errors, wrong assertions/tests, crashes and
empty/skipped selections. Failed setup, skipped-selection accounting, truncated
diagnostics and earlier TypeScript trials remain explicitly retained. No failed
trial is counted as proof. Raw receipts and controller inspection support this
accounting; this reviewer does not rerun the entire retained campaign.

## Independent probes can distinguish a defect

The final private baseline executes 30 named checks from 82 exact candidate Git
modules, with zero source-binding mismatches. A harmless comment control also
passes all 30. Nineteen independent in-memory faults fail intended assertions:

- Remove each of account, workspace, project, revision or permission epoch
  tracking. The corresponding round trip emits a forbidden request.
- Keep the old entries during restart. The original draft remains instead of
  restarting from saved context.
- Accept every in-flight scope or omit the post-parse scope check. A stale
  refresh or prior-scope error becomes observable.
- Reintroduce the external actor, weaken strict actor validation, or remove the
  generated adapter's actor-key minimization. The respective custody/privacy
  assertions fail.
- Hash unrelated bytes or include the generation clock. Independent digest
  reconstruction or clock parity fails.
- Convert null to unresolved or treat every descriptor as resolved. The legacy
  distinction or sovereign-support assertion fails.
- Replace the GeoPackage hash, omit report context, skip authentication or serve
  internal v2 for download. The artifact, markup or route assertions fail.

The controller rejects generic exceptions, missing results, crashes and the wrong
assertion diagnostic. Full outcomes and diagnostics are in
[evidence/independent-controls.json](evidence/independent-controls.json).
The final unmutated run passes all 30 again. No candidate source bytes change.
The completed scope peaks at 225,566,720 bytes, with zero OOM events and zero swap.

Reviewer harness failures are also retained. A loader first selected a directory
instead of an index file. A harmless prefix first reached JSON and caused a parse
error. An early campaign ended with outer exit 143 after six completed cases;
its cause is not established. None counts as a product fault or successful
control. File selection, comment scope and explicit boolean DOM diagnostics are
corrected before the completed campaign.

Private source and execution files remain at
`/tmp/jurisdiction-correction-independent-xv06g8c7`. The durable `probe.cjs` and
`run.py` copies match the files used there. To reproduce, place those copies
beside a `candidate/` directory populated with the exact candidate's Git archive,
then run `run.py` serially in a 1 GiB/zero-swap transient scope. The loader reads
existing canonical dependencies and uses no application server. Retained JSON
records source bindings, resources, receipt accounting and failed trials.

## Parent prerequisites remain unchanged

Migration `20261017000016_project_jurisdiction_context.sql` is unchanged at
SHA-256 `1384e6a2767827c2b756d978bd6e76f6fea364e4e1263e953c0358364341267f`.
It remains an unapplied candidate according to parent custody. There is no new
native SQL enforcement proof in this review. The original report's detailed
native matrix still applies, including ordinary-role forgery, service actor/time,
membership-revocation locking, exact-revision races, populated upgrade, restored
provenance and actual PostgREST errors. SQL plausibility is not enforcement.

The parent owns joining this source with current main and the separate map work,
compilation, native RLS/upgrade/restore, and identified-build desktop/390px
journeys. Exercise actual account/workspace/permission transitions, conflicts,
save/reload, explicit restart and failure recovery from Projects navigation.
Inspect console and keyboard operation. Download report, JSON, ZIP and standalone
GeoPackage at the same revision and registry identity. Compare external v3
material, not internal v2 hashes; verify exact geometry and that older retained
objects stay unchanged after edits. Native GIS-recipient, practitioner/public,
complete accessibility, legal and scientific acceptance remain unproved.
