# Publication needs two retained-packet validation corrections

Independent exact-commit source review, October 16, 2026, Pacific time.

**Verdict: request changes for two P2 findings.** The transaction addresses the
original route race at the source level. Its retained-packet checks still accept
two states that the existing edition readers reject. Neither finding requires
repairing history, deleting artifacts, changing base privileges, or redesigning
all table writers. No P1 or additional P3 finding is recorded.

This verdict concerns candidate
`3ce1a92e017e96c8d0c15230b2ab8d1836969f7f`, parent
`b1f4aaa5fa6874af45afb75d9172b5ac6f7486e9`, application tree
`a3f50878dfeccfaa2c5526dd3f8ff04a8df86cd8`. It is not native approval. I ran no
dependencies, imports, compilation, tests, direction checks, manager units,
locks, SQL, Docker, browser journeys, application HTTP, providers, or SDKs.
Python and Git operations read source and metadata and write my review receipts.
Web reads consult primary documentation only. No additional control is requested.

## 1. P2: repeat verification can confirm an artifact the edition readers do not use

**Location:** candidate migration
`openplan/supabase/migrations/20261017030608_land_use_plan_publication_transaction.sql`,
lines 76–86, within the `already_published` branch.

The function counts HTML artifacts and selects an HTML artifact. It verifies
that artifact's version, content, frozen snapshot and adoption manifest. The
edition page instead selects the newest artifact without an artifact-kind filter:

- `openplan/src/components/reports/land-use-plan-report-page.tsx`, line 23.
- `openplan/src/app/api/reports/[reportId]/provenance/route.ts`, lines 27–29.

A retained report can contain one matching HTML artifact and a newer PDF artifact
whose metadata is empty or identifies another version. The function sees exactly
one HTML artifact and returns success with `alreadyPublished: true`. The page
selects the PDF metadata and withholds the plan at lines 38–40. The provenance
endpoint refuses at lines 44–51. The response helper cannot catch this difference:
its typed result identifies the HTML artifact, but neither reader receives that
artifact ID from the publication response.

A related mismatch exists even with one artifact. The function does not refuse
`metadata_json.kind = 'land_use_plan_implementation_report'` when the other
checked fields match. `report-snapshot.ts`, line 20, explicitly rejects that
kind for an adopted-plan packet.

These are source counterexamples involving retained state before the request.
They do not require an insert during the transaction or establish that the normal
publication route creates that state. Existing artifact history remains mutable
and permits multiple artifact kinds. The candidate explicitly undertakes to
verify an existing packet and refuse inconsistent or ambiguous history. Its
current predicate does not match the readers it is confirming.

**Required minimal correction:** make the repeat verifier refuse when the
artifact that the unchanged readers select differs from the verified packet.
Conservatively refusing additional or ambiguously selected artifact history is
sufficient for this bounded lane. Also reject the reader-disqualifying metadata
kind. A shared, deterministic reader/verifier selection is another possible
implementation, but it broadens the delta. Do not delete, reorder or rewrite
stored artifacts to obtain a match. A later authorized check should cover valid
single-artifact reuse, newer inconsistent PDF history, timestamp ambiguity and
the implementation-report kind. Concurrent direct writers remain a separate
native boundary.

## 2. P2: the retained manifest hash does not establish a readable adoption decision

**Location:** the same migration, lines 58–65, before either existing-packet
confirmation or new insertion at lines 91–100.

The function checks that the retained adoption manifest is an object, recomputes
its PostgreSQL JSONB-text hash, and checks its top-level plan, version, content
hash and review-release references. It never validates the nested `decision`.
The edition's adoption reader requires an object containing typed decision kind,
body, instrument fields, nullable vote, valid decision date and nullable effective
date. See `openplan/src/lib/land-use-plans/report-adoption.ts`, lines 6–19 and
33–47.

This is not an invariant established by the existing database trigger. The
current `verify_land_use_plan_decision_hash` definition in
`20260823000007_land_use_plan_review_reporting.sql`, lines 304–317, validates
the top-level references and review outcome hash, then computes the manifest
hash. It does not require a nested decision. The decision table's native fields
do not impose a JSON shape on that nested object.

Consider a retained adoption record with valid native columns, valid top-level
manifest references and review outcome hash, but no `decision` key. Its manifest
hash can be correct. The new function passes that record, creates the report and
artifact or confirms an existing copy, and returns success. `loadReportAdoption`
then returns `invalid`. `LandUsePlanReportAdoption` withholds the saved decision
details. Provenance returns 503 even when the separate frozen-plan check passes.
A nested decision with the wrong scalar types creates the same mismatch.

The current application adoption route constructs a complete decision object.
I do not claim that route produces this malformed record. This finding concerns
the publication function's acceptance of retained data, not a proposed rewrite
of adoption history or a claim of a newly introduced global adoption flaw.

**Required minimal correction:** reject retained manifests that fail the
existing adoption reader's required decision shape before confirming or creating
a packet. Use explicit JSON type and presence checks so missing keys, JSON null,
strings and other scalars remain distinct. Compare the retained decision fields
with the selected native decision columns where the function claims those facts
are verified. Keep original JSON and hash bytes unchanged. Do not synthesize
missing fields from current records or repair old decisions. An authorized
check should distinguish a valid retained decision from missing, null and
wrong-type decision fields. Reader refusal must remain available for old data.

## The source change addresses the original race

At the parent, the route reads `published_report_id`, inserts a report, inserts
an artifact, then updates the version pointer in separate calls. Two requests
can both read NULL. Each can create a report and artifact. The pointer update
has no NULL precondition, so the later update can replace the first report ID.
`loadAdoptedReportSnapshot` requires `version.published_report_id === report.id`
at line 24. The displaced report cannot pass that reader. This is an independent
source inference, not a reproduced database interleaving.

A pointer-only compare-and-set would avoid overwriting the pointer but leave the
earlier independent inserts outside its transaction. The candidate's choice of
one function is appropriate for that problem. The source places report insert,
artifact insert and a NULL-guarded pointer update in the same function. An
unmatched update raises rather than returning success. PostgreSQL's documented
exception behavior supports that transaction intent, but it does not establish
that these exact migration bytes parse, install or roll back on the intended
database. [PostgreSQL error handling](https://www.postgresql.org/docs/17/plpgsql-control-structures.html#PLPGSQL-ERROR-TRAPPING).

The initial route read no longer short-circuits when a pointer exists. The
helper validates the original supplied frozen object before the RPC. Its
identity reader checks plan ID, version ID, version number, original content
hash and retained context. It serializes the original object with unchanged
`serializeFrozenRecord`, rather than hashing a Zod-stripped projection.
The function compares parsed JSON to the stored snapshot, hashes the supplied
JavaScript serialization, and independently checks its plan/version identity.
It preserves the existing encoding instead of substituting PostgreSQL JSONB
text for that snapshot hash. The adoption manifest uses its separate existing
PostgreSQL JSONB-text hash.

The helper validates typed report/artifact IDs, workspace, plan, version and
content hash in the response. A new packet must retain the requested title.
An existing packet returns the original stored title, independent of the later
caller's title. Unknown database errors or malformed results remain unconfirmed.
PT400, 42501, PT404 and PT409 retain explicit refusal categories.

New reports use `/reports/<reportId>` for their edition URL. The route's separate
`publicUrl` remains `/published-plans/<planId>`, whose unchanged loader resolves
the latest adopted version. The internal edition reader also permits superseded
and repealed versions while retaining the exact report pointer. The publication
command intentionally requires the current adopted version. I found no source
change that silently upgrades historical retry recovery or makes the public URL
an immutable edition identifier.

## Actor, locking and schema review

`loadLandUsePlanAccess` obtains the user through `auth.getUser`, resolves the
plan's workspace and applies `plans.write`. The role matrix permits owner,
admin and member. The route supplies that authenticated user ID to a server
service-role client; it does not accept an actor or role from the request body.
The new function repeats the current membership check under `FOR SHARE NOWAIT`.
The workspace-members primary key makes the workspace/user pair unique. This
supports the current-member source contract for the normal route. The function
still trusts an authorized service-role caller to supply the actor. It does not
cryptographically bind a service-role SQL call to an end-user session.

The migration declares `SECURITY INVOKER`, a fixed search path and UTC timezone.
It revokes execute from PUBLIC, anon, authenticated and service_role before
granting it to service_role. It adds no table grants, policies or new module.
Supabase documents the caller-privilege meaning of invoker functions. This source
declaration does not attest the installed ACL or role inheritance.
[Supabase database functions](https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker).

I read the relevant source definitions for reports and artifacts, plan/version
ownership and constraints, public-review releases, adoption decisions and their
append-only guards, frozen-version guards, draft-revision guards, cascade guards,
workspace membership, role gates, restored client/service grants and land-use
RLS. In particular:

- `20260314000018_reports_module.sql` defines report/artifact kinds, foreign
  keys, generated timestamps, mutable artifact rows and membership policies.
- `20260728000006_workspace_write_role_gate.sql` and its children migration
  add role-aware restrictive writes, including artifacts through their report.
- `20260804000002_restore_client_role_grants_after_cli_default_flip.sql`
  restores service DML and future table defaults. The new migration does not
  use `SECURITY DEFINER` to work around missing grants.
- `20260823000002_land_use_plans.sql` gives versions scoped ownership, frozen
  constraints and the report pointer, plus decision native columns and guards.
- `20260823000007_land_use_plan_review_reporting.sql` defines review releases,
  manifest hashing, the current adoption RPC and plan-packet report types.
- `20261016000003_land_use_plan_draft_revision.sql` and
  `20261016000009_land_use_plan_cascade_guards.sql` preserve version ownership,
  frozen content and append-only decisions while permitting the pointer update.
- `20261016000012_land_use_plan_implementation_report_commands.sql` uses the
  same plan/current-member/adopted-version locking and atomic report/artifact
  pattern. Its separate implementation snapshot/hash encoding stays separate.

The function takes plan, membership and version locks before publication.
Another new-route command cannot independently create a second packet through
the same locked plan. `NOWAIT` can refuse a selected row conflict rather than
wait. It does not guarantee every table lock is nonblocking. PostgreSQL documents
that distinction. [PostgreSQL SELECT locking](https://www.postgresql.org/docs/17/sql-select.html#SQL-FOR-UPDATE-SHARE).

The adoption RPC takes version writes before updating the plan, unlike this
function. A publication that already owns the plan and encounters the adoption's
version lock should refuse through NOWAIT. That source reasoning does not prove
all foreign-key, trigger, cancellation or rollout interleavings. I found no
source reason to demand a wider lock-order redesign within this patch.

The existing-packet HTML count is a separate SELECT from the artifact share
lock. Share-locking an existing report/artifact row does not exclude every later
child insert. There is no global uniqueness constraint or immutable artifact
history here. New-route serialization is narrower than database-wide hostile
writer safety. The two findings above concern the verifier's handling of already
retained state; they do not require solving this separate global boundary.

## Exact source and reviewer binding

The assigned worktree is
`/home/nathaniel/.t3/worktrees/openplan/t3-2693899a`, branch
`t3/review-land-use-publication-transaction`. Initial HEAD is clean at
`05dd3e8da4a4572437f06e771b0a2477873e681f`. I do not rebind or check it out.
I extract the exact candidate blobs into my new private source overlay.
The final review commit adds only this review directory to that historical
reviewer branch. Its application checkout is not the reviewed candidate app.

Live T3 thread metadata confirms this worktree, branch, provider `codex`, model
`gpt-6.1-sol`, subagent relationship and parent thread
`1401bb6a-70e4-42eb-a1f1-98045485f8cc`. The harness declares high reasoning.
`orchestrator_capabilities` reports inherited `gpt-6.1-sol`, but its catalog's
composer default is low. The thread read does not expose the active run's
reasoning setting. I preserve that distinction rather than claim independent
metadata attestation of high effort. No nested agents run.

The author checkout later advances to clean
`65ec771d3b45a7297fac7f007404ff7730a82a73`. Its parent is the fixed candidate.
Its two changed files are unrelated M1 review documents and its application tree
still equals `a3f50878`. This does not move my review target or transfer native
M1 proof to this publication candidate.

I read all seven candidate changed files, including the complete DESIGN, REPORT
and EVIDENCE records. `EVIDENCE.json` here records their Git blob IDs, SHA-256
hashes and lengths. The four changed implementation/test pins are:

| File | SHA-256 |
| --- | --- |
| `publication.ts` | `b6cbf6830b652d7cd17580384797010f5c03903c1b00ca1fcc6b41389a5887bb` |
| decisions `route.ts` | `81a161a2f399130f05ba1e10cec537d352f46e7bb1d7b23a9fa626f0112e22ca` |
| migration 425 | `15d1904db83f83d7ac93bc7aa7910de042f2e94ac256c4579906d48a036d2272` |
| focused test | `9a3b413fe982fd587913c3c6f3e392cbccba4f6624aa0419ef337f9429883a6b` |

All eight candidate evidence pins, including continuity tests/setup/type config,
match the exact Git blobs. Generation's 424 original migration hashes match the
candidate's prior migration inventory. The new migration is ordinal 425. These
are source identities, not installed migration-history receipts.

## Retained evidence supports the stated focused checks

Evidence comes from
`/home/nathaniel/.local/state/openplan/land-use-publication-transaction-correction-20261016`.
I read the runner/configuration, selected source, mutation specifications,
actual Vitest JSON, failure messages, applied transformation receipts, private
SQL inputs, stage streams, terminal records and final restoration records.
I compare bytes and names rather than accepting the summary status alone.

The supplied private manifest has SHA-256
`3473de431240c2b3b9f94e9d06ad10de5dbe30a62d9288aa2cc9bb07c50c4ce8`.
All 3,119 entries match their hashes, sizes, modes and ownership at inspection.
No old proof is copied into my evidence. My new inspection receipts and exact
source overlay live under my own 0700 private directory.

Generation01 records invocation `776ea1a046c34ed299ef506d4ff9cc0f`, terminal
exit 0, and four serial commands: actual nested direction check, pinned CLI
version, installed `migration new --help`, then `migration new`. Version stdout
is `2.75.0`; new stdout identifies the exact generated filename. The generated
private file has zero bytes and the empty-file SHA-256. SQL authoring follows
generation. The prior 424-file inventory stays unchanged. This is an offline
generation receipt, not a parser, migration application, installed CLI acceptance
campaign or independently repeated download-provenance audit.

Checks01 remains exit 1 under invocation
`3fc2f2bc2ea14b2bbee926f9ea97d186`. Harmless and baseline each pass 25 selected
cases. Its snapshot-guard mutant fails with `Error: promise resolved` rather than
`AssertionError`. The strict reader stops. There is no accepted kill receipt for
that variant and no completed types/lint/direction stage in this trial. All 47
files in its failed seal still match. I do not relabel it as a successful run.

Checks02 changes only test mechanics. The retained diff adds a helper that
returns an actual `PlanPublicationError`, rethrows unrelated exceptions and uses
ordinary kind/status assertions. Production/helper/route/SQL bytes match between
the trials; only the focused test pin differs. Checks02 reruns its own harmless,
baseline and restoration instead of borrowing the old green cases.

The checks02 parent terminal is exit 0. The manager's stderr names the unit but
does not print an invocation ID. Entry metadata records invocation
`7f50ce8fd29f483f9b0966b409eacb88`. Parent elapsed is 82.06651887099724 seconds;
manager service time is 82.042 seconds and CPU is 40.780 seconds. Entry observes
1,073,741,824 bytes memory, zero swap, CPU `50000 100000` and Tasks64. Final peak
is 393,850,880 bytes, PID peak 43, zero current swap and zero memory/PID limit
events. These recorded limits apply to that unit, not this reviewer or all host
processes. Entry mount/network records support the named read-only source/donor
and private writable arrangement, not host-wide confinement.

Harmless, baseline and restored JSON each show 25 passes, no failures and 82
pending/skipped cases. Their selected full names match exactly. Those 25 are 23
new publication cases and two old adoption-manifest continuity cases. The old
full campaign does not run. Module mutations use actual candidate modules through
private Vite transforms, with exact applied file/find/replace receipts. SQL
mutations use the explicit private fixture from the test configuration. Their
input hashes and saved SQL copies match each selected change. No SQL executes.

| Fault | Exact observed assertion consequence |
| --- | --- |
| `snapshot-guard` | Expected conflict receives null after the guard is disabled. |
| `returned-workspaceId` | Expected unavailable receives null for the wrong workspace. |
| `returned-planId` | Expected unavailable receives null for the wrong plan. |
| `returned-versionId` | Expected unavailable receives null for the wrong version. |
| `returned-hash` | Expected unavailable receives null for the wrong hash. |
| `new-title` | Expected unavailable receives null for an unexpected new title. |
| `conflict-mapping` | Expected conflict/409 receives unavailable/503; both helper and route assertions fail. |
| `unverified-pointer` | The stale-pointer early return produces the wrong report ID. |
| `plan-lock` | SQL text lacks the required scoped plan NOWAIT lock. |
| `current-adopted` | SQL text lacks the current-adopted pointer predicate. |
| `current-writer` | SQL text changes the writer-role predicate to include viewer. |
| `snapshot-encoding` | SQL text hashes JSONB text instead of supplied snapshot bytes. |
| `existing-artifact` | SQL text lacks frozen-snapshot artifact equality. |
| `null-pointer` | SQL text lacks the NULL pointer guard. |
| `rollback` | SQL text lacks the unmatched-update exception predicate. |
| `execute-grant` | SQL text grants authenticated execution instead of service-role execution. |

Each of the 16 faults exits 1 with its exact baseline-joined oracle failing.
Fifteen variants have one failed assertion; conflict mapping has two. Actual
failure messages contain AssertionError and the inspected suites have no runtime
failure messages. The candidate's 16 result hashes match the retained receipts.
The full exact names and messages remain in my private
`retained-fault-results.md` and `evidence-inspection.json`.

Scoped types, focused lint and nested direction stages each record exit 0.
Type/lint streams are empty. Direction stderr retains expired registry/matrix
review reminders, the version difference and intervening-change reminders.
This is a scoped TypeScript project, not a new whole-app TSC or Next build.
All eight final pins match; the active transform is empty and the private SQL
fixture is restored to the candidate bytes. I verify 25 check-stage stream hash
pairs, including the failed trial, with no mismatches.

The route mock asserts its exact selected projection and ID/plan filters, one
RPC, and no calls to report/artifact tables in the success/unconfirmed paths.
The selected old descriptor test also asserts projection fields and plan scope.
These are useful mocked query assertions. They do not exercise database RLS or
prove every unchanged adoption query.

## Each evidence tier keeps its blind category

The helper/route tests execute JavaScript with supplied query/RPC responses.
They can distinguish the selected guard, scope, response and control-flow faults.
They cannot establish the server client credential, PostgREST behavior, installed
function, database permissions, persistence, publication visibility or races.
The new findings are outside their selected supplied-response coverage.

SQL assertions inspect substrings, order and grant intent. Their faults prove
those textual checks can fail. They do not prove PostgreSQL grammar, overload
resolution, trigger interaction, transactions, locking, NULL/type behavior,
installed ACLs, schema history, or immunity to a semantic equivalent hidden in
uninspected SQL. Some assertions could match dead code or comments. I do not
promote their names, including “rolls back,” into native proof.

The harmless helper comment survives the full selected suite and demonstrates
the runner can return a survivor. It does not establish harmless SQL semantic
equivalence. The configured SQL file and hash receipts address fixture identity,
not SQL execution. Manifest hashes address retained bytes and custody, not the
truth of planning facts or the authority of a human decision.

The new RPC does not constrain every direct or privileged writer, prevent all
future artifact changes, establish global packet uniqueness or repair the
historical race. It checks a selected current adopted edition. Later adoption
and legacy reader recovery remain separate. The existing public loader still
reads its own latest decision ordering; the new SQL's deterministic retained
decision choice does not silently revise every public/history reader.

The retained records describe no application of migration 425. I perform no
native inventory to independently attest a database's present state. Parent
424 proof, external A0 source f8/app d577/history 421 and budget source 3f/app
44e/history 422 do not prove this app or migration. The separate M1 geography
recipe remains 423 to 424. Earlier whole-TSC evidence for app d60 stays at that
older application identity.

No identified-build navigation, desktop or 390px journey, console review, actual
public artifact, engine run, hosted acceptance, practicing-planner observation
or public-participant observation runs. KI-025, M1, the remaining V1 contract
and release acceptance remain open. This review preserves the full V1 destination
and does not narrow it to this publication correction.

## Review custody and next action

I own only this new review directory and
`/home/nathaniel/.local/state/openplan/land-use-publication-transaction-independent-20261016`.
The private directory is mode 0700. I preserve missing-path reading mistakes,
truncation follow-ups, the unavailable markdown changelog read and the successful
primary-document fallback in an additive receipt. I do not alter author source,
tests, prior reports, evidence, checkouts, workers or browser sessions.

Both P2 findings are sent to the root thread during this review. The next action
is a bounded source correction that refuses the reader-inconsistent retained
states, followed by separately authorized controls and a new exact-commit source
review. No extra execution grant is assumed. Native parser, transaction,
concurrency, RLS and ACL acceptance still require their own reviewed operation.
The requested local commit contains only new review documentation, with hooks
and signing disabled. No push, PR, main update, merge, tag or release occurs.
