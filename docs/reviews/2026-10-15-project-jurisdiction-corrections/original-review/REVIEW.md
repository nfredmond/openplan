# Project jurisdiction candidate needs three bounded corrections

October 15, 2026, independent source review. Candidate
`53485a708512de34443e63ee38132a4f5991f36e`, branch
`t3/project-jurisdiction-context`.

**Changes requested.** Three P2 findings concern retained draft authorship,
external-handoff identifiers and the requested GeoPackage payload hash. The
separate context design remains suitable for this bounded increment. No whole
product reassessment is required to correct these findings. Native SQL, role,
upgrade, restore, build and browser acceptance remain unproved.

## Provenance and ownership

The review uses `/home/nathaniel/.t3/worktrees/openplan/t3-223449bf`, branch
`t3/review-project-jurisdiction-context`. Its initial clean head was
`05dd3e8da4a4572437f06e771b0a2477873e681f`. `git fetch origin` and
`git merge --ff-only origin/main` advanced only this assigned tree to
`1b2fefe0f0e98f99700fc77e99146fe697b43ee7`. No unrelated changes were present.
Candidate files were read with `git show` through this tree's shared Git object
store. The implementation owner's files in `t3-85a6a802` were not read or changed.

The reviewer owns only this review directory. Temporary source probes live in
`/tmp/jurisdiction-review-jfelat4k/`. No application edit, suite, build, browser,
live database, migration application, hosted operation, GitHub mutation, push,
process termination, branch deletion or nested delegation occurred. Dependencies
were read from the canonical package's existing `node_modules`; no installation
or shared cache write occurred. The review uses GPT-6.1 Sol high.

The T3 client request is
`sol-project-jurisdiction-independent-review-20261015-round1`. The corresponding
parent-owned taskId is
`node:delegated-task:command%3Amcp%3A3f015e30-501a-44ae-80ba-38a5ed25d5ba%3Adelegate-task%3Asol-project-jurisdiction-independent-review-20261015-round1`.
The runtime exposes its matching `thread:delegated-task:` wrapper. Reading task
status from inside this child returned `task_not_found`, explicitly saying that
the task does not belong to the child wrapper. The parent must retain and manage
its own task receipt. This report does not claim an independent task-status read.

Read authority includes AGENTS.md, current external COORDINATION.md and
`restart-continuation-20261015.json`, the parent decision JSON, the candidate's
DESIGN.md, implementation STATUS.md and provenance, the binding contract,
roadmap, requirements ledger, capability matrix, architecture, known issues,
October 6 direction review and development release policy. Planner-writing,
prove-it, any-place, Supabase and Postgres skills were read, including privilege
and transaction-lock guidance.

`npm run product:direction:check` ran from the nested `openplan/` package and
exited 0. It retained registry/matrix expiry, release-version and intervening
change reminders. This establishes record consistency, not current legal or
geographic coverage. Current coordination reserves candidate migration
`20261017000016_project_jurisdiction_context.sql`, unapplied. Its exact candidate
SHA-256 is `1384e6a2767827c2b756d978bd6e76f6fea364e4e1263e953c0358364341267f`.
The separate main merge hold and migration 15 rollout remain the parent's work.

All source paths below are repository-relative and refer to the exact candidate.

## P2: Bind the retained draft to its original account and workspace

Location: `openplan/src/components/projects/project-jurisdiction-editor.tsx`,
lines 18–36 and 53–54.

The editor captures `baseRevision` when editing starts, but reads `userId` and
`workspaceId` directly from the latest props when saving. A retained component
can therefore keep account A's draft across a refreshed render and send it with
account B's expected-user header. If B also writes the same project, its project
revision need not change. The route's checks then accept B and record B as the
actor. They cannot detect that the draft began under A.

A temporary probe transpiled the exact component, retained its hook state across
renders, opened an A draft, then supplied B props. Invoking the retained Save
handler emitted the original county reference with
`x-openplan-expected-user: B` and the original revision. A harmless comment
change preserved that result. An in-memory control capturing the original actor
changed the header to A. No candidate source bytes changed. The same mechanism
updates the workspace header. Permission loss also leaves the editing controls
mounted, although the route still checks permission and should refuse the write.

Capture project, account and workspace identity with the draft. Refuse submission
when any differs from the current context, preserve the old draft under its
original scope, and require an explicit comparison/restart. Do not merely remount
and silently discard the draft. Add a retained-component account-switch check,
a workspace/permission-change check, and an in-flight response scope check.

This is a source-handler reproduction with a small hook-state harness, not a
real React reconciliation, login, network or browser observation. The parent
must reproduce the retained-state case in its identified build. Existing tests
cover mismatched request headers and a static editor, not changed props carrying
the same draft.

## P2: The new recordedBy field bypasses external-handoff minimization

Location: `openplan/src/lib/project-evidence-bundles/generated-records.ts`,
lines 60–75, 400 and 660–670; `project-geopackage.ts`, lines 689–701.

The generated-record adapter explicitly removes internal user identifiers from
external handoffs. Its denylist includes `createdBy`, `approvedBy` and `userId`,
but excludes `recordedBy`. The new strict jurisdiction object carries the actual
authenticated user's UUID in that field. The adapter consequently retains it in
`project/project.json`, the readiness JSON and the GeoPackage. Standalone
GeoPackage exports also retain it. This newly links exported jurisdiction facts
to an internal account identifier despite the existing export policy.

The temporary probe evaluated the exact sanitizer on a synthetic project carrying
both `created_by` and `jurisdiction_context.recordedBy`. It removed the former and
retained the latter. The real GeoPackage builder produced the same UUID inside
`jurisdiction_context_json`. No account data or external upload was involved.

Resolve the export representation deliberately. Keep trusted internal actor
custody, but use an export-safe attribution representation and a versioned
canonical payload/hash contract for external files, or record a specific parent
scope decision changing this established minimization policy. Simply deleting
`recordedBy` before the current strict reader runs will invalidate the context.
Changing bytes after calculating the canonical hash would also break parity.
Add a non-null declaration fixture through the complete generated-file adapter,
with a meaningful assertion that the external representation follows the chosen
policy. Current generated-file coverage adds only a null legacy context.

This finding concerns a source-established minimization rule. It does not claim
that the UUID reveals credentials, that an unauthorized reader obtained a file,
or that every internal authenticated readiness response must hide authorship.

## P2: The GeoPackage omits the requested canonical readiness payload hash

Location: `openplan/src/lib/projects/project-geopackage.ts`, lines 689–701.

The new attribute table stores project ID, revision, scope and canonical context
JSON. It stores neither the v2 readiness payload nor its `payloadSha256` or
registry identity. The temporary probe ran the actual builder from 17 exact
candidate Git modules with real in-memory SQLite. Its manifest columns were:

```text
fid, project_id, project_revision, scope, jurisdiction_context_json
```

The API-equivalent payload hash was
`203fb89791a92a7035ead60c113ebe41066feccf6e52e96f10aa99997a77d7b8`.
Those bytes did not occur in the resulting GeoPackage. A downstream recipient
cannot compare this standalone file's readiness hash with the report and JSON
without obtaining the missing registry identity and rebuilding the payload.

Carry the shared same-revision canonical payload/hash into the independent
attribute record, including its schema and registry identity. Use the shared
reader instead of computing a separate assessment. Extend the SQLite check to
compare the exported hash and canonical material to the API/report/bundle payload
at the same revision and different generation times.

There is a scope distinction to preserve. The accepted DESIGN.md requires the
same readiness hash in API, ZIP and report, and only a separate context record
in standalone GeoPackage. This candidate meets that narrower GeoPackage design.
The review assignment explicitly also requires the canonical payload hash in
GeoPackage. This finding applies that later requirement; it is not a claim that
the implementation failed its earlier design wording.

## Source findings that support the design

The strict command accepts jurisdiction and expected revision separately from
ordinary project edits. The route checks authenticated access through
`loadProjectAccess`, which really selects `updated_at`, then checks origin,
expected account/workspace and assistant execution headers. Its service write
contains only `jurisdiction_context`, with exact project, workspace and revision
predicates. A zero-row write returns 409; a database error remains unavailable.
The UI keeps a same-scope draft after a conflict or transport failure. Successful
save acknowledgements are not independently validated by the editor; native
route/browser evidence still matters.

Server resolution checks exact returned kind and GEOID, derives codes through
the existing adapter and excludes geometry from the declaration. Staff input
cannot submit resolved provenance. Unsupported, sovereign, overlapping and
international entries remain staff-declared and unassessed. Administrative
guidance for an unverified declaration appears separately. The core descriptor
supports source-defined kinds and namespaced references; the current resolved
branch is explicitly tied to the existing TIGERweb adapter. Further providers
need adapter work, not fabricated server-resolved identities.

Legacy null permits labelled study-place context. Explicit unresolved has no
fallback. Missing projection, malformed stored context and failed reads do not
become successful unassessed results. Workspace home is not used as a replacement.
The v2 envelope preserves every entry without averaging status. It labels
state-level administrative guidance and retains separate sovereign/overlap scope.
Workspace readiness retains its v1 shape.

Search-only mode reuses the picker and suppresses its geometry callback. Upload
and clear continue writing only existing study-place fields through the caller
client. Neither the jurisdiction service write nor the new picker mode writes
site or corridor geometry. CSV/workbook and feature properties are not promoted
into declarations. Source tests and the actual SQLite probe support these
boundaries, not live source-service coverage or file-import usability.

Report markup escapes the new declaration fields and prints the v2 payload
hash. Report metadata retains the same payload. The bundle reads one project
row, checks its revision, and builds context and GeoPackage from it. Existing
freshness logic refuses later review after a changed project revision. These
builders create new bytes; they do not rewrite retained reports or ZIPs. That
source property is distinct from proving old Storage objects remain unchanged
through the complete authenticated workflow.

The SQLite probe confirmed unchanged project-area WKB when only jurisdiction
context changed, unchanged input objects, and identical readiness payloads when
the call clock advanced to January 1, 2030. It did not prove full GeoPackage
recipient interoperability, frozen Storage custody, complete layer selection or
public-report privacy.

## Retained checks are credible within their stated boundary

Independent hash comparison found zero mismatches across all 33 provenance
bindings, all 12 controls-07 bindings and all 26 final-checks-02 bindings. The
retained final receipt contains 173 passing tests, zero failed tests and 16 file
results. Its nested suite counter is not a file count. TypeScript and ESLint
commands exited 0 in the retained checks record. They were not rerun here.

Controls-07 contains 79 observed cases: 30 harmless survivors and 49 targeted
failures. Every selected failure includes an assertion diagnostic at the named
test, including the expected rejected-promise diagnostic. Examples include:

- Removing the account comparison produces `expected 200 to be 403`.
- Removing concurrent-write refusal produces `expected 200 to be 409`.
- Replacing the write projection fails the exact `select` call assertion.
- Clearing conflict draft state fails `The exact selected jurisdiction draft remains after a conflict: expected null to be truthy`.
- Dropping context from SQLite fails `expected null to deeply equal` the declaration.
- Removing HTML rendering fails the escaped-label assertion.

The portable Vitest runner loader uses the review-local cache and does not
bundle through borrowed dependencies. The controller restores exact bytes in
`finally` and records source bindings. Its oracle rejects import/setup failure,
empty selection and wrong-test failure. The classifier accepts broad assertion
text, so its adequacy depends on inspecting the actual named diagnostics, which
this review did. The retained campaign records support the candidate's claimed
sensitivity; they are not an independent rerun. This review changed no application
test or guard.

Blind categories remain native SQL parsing/permissions, live RLS, real concurrency,
restore procedures, whole-app compilation, real React reconciliation, source
availability, actual artifact delivery and human usefulness. In particular, no
control mutates the SQL guard and executes it in PostgreSQL. The source/mocks
must not be described as proving database enforcement.

## Native proof is the parent's next bounded prerequisite

The SQL adds one nullable column, a CHECK helper and an invoker trigger. It does
not add a service RPC. Service writes use ordinary PostgREST UPDATE plus this
trigger. The trigger rejects changed context for ordinary roles, permits
`service_role` with a current attributed writer membership held `FOR SHARE`,
stamps database time and permits trusted `postgres` restoration. The restored
CHECK helper remains active on normal inserts. SQL structure is plausible; it
has not been parsed or executed in this review.

PostgreSQL documents that `FOR SHARE` blocks membership-row UPDATE/DELETE until
the transaction ends. It also documents alphabetical ordering of same-kind
triggers. These facts explain the intended seam but cannot establish this
migration's installed behavior. The existing `trg_projects_updated_at` runs after
`projects_jurisdiction_context_guard` and sets a monotonic revision. Check both
installed definitions and their actual ordering. See [row locks](https://www.postgresql.org/docs/current/explicit-locking.html)
and [trigger ordering](https://www.postgresql.org/docs/current/sql-createtrigger.html).
Supabase [RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)
distinguishes service bypass from caller permissions. The current changelog was
also fetched; its HTTP/TLS announcement does not prove a change in this SQL seam.

Before executing any probe, the parent must create and identify a disposable,
owned predecessor database with real Supabase roles, actual predecessor
migrations, explicit fixture IDs and no default/demo/hosted target. Record the
intended migration set, including the separate status of migration 15. Retain
candidate SQL hash, PostgreSQL/PostgREST versions, database identity, role grants,
trigger inventory and fixture snapshots. Check resource capacity and run serially.
Use explicit target selection; do not inherit the application's environment.

These catalog queries are read-only and suitable after the parent prepares that
isolated target. They do not apply anything:

```sql
SELECT current_database(), current_user, version();
SELECT rolname, rolsuper, rolbypassrls
FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','postgres');
SELECT tgname, tgenabled, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'public.projects'::regclass AND NOT tgisinternal
ORDER BY tgname;
SELECT conname, convalidated, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid = 'public.projects'::regclass;
SELECT p.oid::regprocedure, p.prosecdef, p.proconfig, p.proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
 ('valid_project_jurisdiction_context','guard_project_jurisdiction_context',
  'set_projects_updated_at','workspace_role_rank');
SELECT policyname, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname='public'
 AND tablename IN ('projects','workspace_members');
SELECT r, has_function_privilege(r,
 'public.valid_project_jurisdiction_context(jsonb)','EXECUTE') AS may_validate,
 has_function_privilege(r,
 'public.guard_project_jurisdiction_context()','EXECUTE') AS may_call_guard,
 pg_has_role(r,'postgres','MEMBER') AS member_of_restore_owner
FROM unnest(ARRAY['anon','authenticated','service_role']) AS r;
```

The native behavioral matrix must cover these different boundaries:

| Boundary | Isolated action | Required observation |
|---|---|---|
| Upgrade | Populate legacy null, uploaded/searched geometry, site and corridor fixtures before installing reviewed SQL | Original fields and exact geometry remain; legacy context stays null |
| Validity | Call CHECK helper with valid null/unresolved/declared contexts, then wrong keys/types/version/date/UUID/count/size/reference; exercise actual constraint | Exact valid/invalid results and intended SQLSTATE; compare SQL acceptance with the stricter TS resolved-reference check |
| Direct authorship | Real authenticated owner/admin/member INSERT and UPDATE non-null context with forged actor/time/resolved identity | 42501 and unchanged row; null-context ordinary creation and geometry-only edits still work |
| Read isolation | Owner/admin/member/viewer, nonmember, other workspace | Only authorized rows readable; viewer and foreign writers cannot use the route or direct writes |
| Service attribution | Service update attributed to current writer, viewer, absent actor or actor belonging only to another workspace | Writer succeeds with database time; others refuse with 42501; no client timestamp survives |
| Membership race | Two sessions, save first then revoke/downgrade; reverse order separately | Correct membership row is locked through write; revoke-first blocks/refuses the save after release, with no unauthorized successful write |
| CAS race | Two exact-revision updates with different contexts, same project; repeat across foreign workspace/project IDs | Exactly one matching write, second zero rows/route 409; original actor/context stays with winning revision |
| Scope changes | Move a fixture project between workspaces while another save waits; change account and permission during draft and in-flight response | Workspace/revision protection refuses stale intent; no silent reattribution or stale UI confirmation |
| Restore seam | Fresh archive with non-null and unresolved contexts plus geometry, restored to a separate owned target | Exact context actor/time and project revision retained on INSERT; ordinary roles cannot assume postgres/service_role or invoke a writable definer bypass |
| Restore limitation | Test postgres UPDATE separately | Existing revision trigger may advance revision; trusted restore bypass is not a general promise of revision-preserving UPDATE |
| Full transport | Actual authenticated route through parent-owned PostgREST | Real SQLSTATE to HTTP mapping, trusted actor/time, 409/503 distinction and retained draft, not only query-builder mocks |

Use transaction/savepoint rollback for single-session probes. For example, the
parent can run the following against an existing owned synthetic project,
supplying its own `actor`, `project` and strict `context` psql variables:

```sql
BEGIN;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', :'actor', 'role', 'authenticated')::text, true);
SELECT current_user, auth.uid();
SAVEPOINT denied_context_write;
UPDATE public.projects SET jurisdiction_context=:'context'::jsonb
WHERE id=:'project'::uuid;
-- Require 42501, not merely any error or zero rows.
ROLLBACK TO SAVEPOINT denied_context_write;
-- Independently inspect the fixture and prove its unchanged context/geometry.
ROLLBACK;
```

For the service seam, use a separate transaction with `SET LOCAL ROLE
service_role` and an explicit workspace AND exact revision predicate. Record
`RETURNING jurisdiction_context, updated_at`; compare stamped time to database
bounds captured before/after and recorded actor to the route user. Do not count
a zero-row predicate as successful authorization refusal. Two-session races need
parent-owned committed fixtures, explicit barriers and exact cleanup receipts;
rolled-back writes alone cannot exercise the winner/loser CAS interleaving.
Use short timeouts rather than killing other sessions.

Challenge the guards on a disposable copied schema: harmless comment survivor,
then role refusal removed, membership lock weakened/removed, actor membership
predicate redirected, timestamp stamping omitted and revision predicate omitted.
Require the particular native assertion and SQLSTATE to fail, restore exact
source/installed definitions, then rerun the positive case. Restore tests need a
separate archive/readback oracle and deliberately altered provenance control.
No mutation or native probe above was run by this reviewer.

## The 12-descriptor cap is a development bound, not the v1 destination

The API, stored schema, SQL and UI impose 12 declarations. The UI discloses that
number, and the parent explicitly accepted a bounded list. This can support a
bounded development increment. It cannot represent complete all-state,
regional, sovereign and overlapping authority context for every v1 project.
For example, a statewide project may involve more than 12 distinct declarations;
combining them into one label would hide independent assessments.

Record the cap as a current resource/development limitation in the existing
M1/CORE-GEO-01 evidence mapping and user disclosure. Do not describe it as a
complete jurisdiction model or turn it into a permanent contract maximum.
The present UI says only “Up to 12 declarations”; adding the development-limit
qualification would make that boundary clearer. The full contract and roadmap
remain unchanged. No blanket whole-product gate is requested for this change.

## Parent integration and acceptance

Correct the three findings, preserve this report and any disagreement, and review
the exact replacement head. Then run the native checks on the owned isolated
stack and the joined build with the separate map/camera work. From Projects,
exercise upload, independent jurisdiction save/reload, change each fact, cancel,
clear, conflict, account change and failure recovery. Inspect actual desktop and
390px screenshots with build/viewport provenance, keyboard use and console.

Download readiness, report, bundle and standalone GeoPackage at one revision.
Compare canonical material/hash, declared context, source labels and exact WKB.
After a context edit, prove old report/archive object hashes remain unchanged
and bundle review is stale. Check exported attribution against the explicit
privacy decision. These are relevant bounded release checks. They do not imply
native GIS-recipient, practitioner, legal, scientific or complete v1 acceptance.

## Temporary probe reproducibility

The temporary scripts remain available to the parent during this handoff:

```text
/tmp/jurisdiction-review-jfelat4k/editor-probe.cjs
SHA-256 a61b6a1f927cec0b835bd5e588e608916c3e243c80345ebfbc45e5d8e3610d4f
/tmp/jurisdiction-review-jfelat4k/artifact-probe.cjs
SHA-256 2d643a399d375d92d1b1700eb96dd42ebd7d8ec0aeffbfefc257ed827a1d89d8
```

Run serially from the assigned review tree with Node:

```bash
node --max-old-space-size=128 /tmp/jurisdiction-review-jfelat4k/editor-probe.cjs baseline
node --max-old-space-size=128 /tmp/jurisdiction-review-jfelat4k/editor-probe.cjs harmless
node --max-old-space-size=128 /tmp/jurisdiction-review-jfelat4k/editor-probe.cjs capture-actor
node --max-old-space-size=256 /tmp/jurisdiction-review-jfelat4k/artifact-probe.cjs
```

The editor script uses explicit leaf stubs and a retained hook-state harness.
The artifact script loads exact Git objects, transpiles them in memory, uses
installed dependencies and actual SQLite, and separately evaluates the exact
sanitizer fragment. Neither contacts an application or database server. Temporary
files are not durable repository evidence; this committed report retains the
source locations, method, digests and observed values. Preserve the probes in
the parent's dated evidence if later correction work depends on them.
