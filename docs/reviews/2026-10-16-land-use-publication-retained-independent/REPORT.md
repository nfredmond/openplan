# Publication still needs a retained-decision ambiguity refusal

Independent round 2 exact-commit source review. October 16, 2026, Pacific time.

**Verdict: request changes for one newly identified P2.** The correction addresses
both original P2 counterexamples at the bounded source level. It still confirms
a retained packet when duplicate native decision rows make the unchanged adoption
reader refuse. No P1 or additional P3 finding is recorded. This review does not
claim a new defect in the correction's JSON type, NULL or date comparisons.

The exact subject is `ac9c74a80b1de7b402cc54e7c216107a79aaaaed`, parent
`65ec771d3b45a7297fac7f007404ff7730a82a73`, application tree
`afbcd052ceb051d5eb2f95e14862ebede43deee6`. This is source review and retained
metadata inspection. It is not native, browser, release or operating approval.
No additional pure check is essential to support the source finding, so none
is proposed or run.

## 1. P2: selecting one decision can confirm a packet whose native reader sees two

**Location:**
`openplan/supabase/migrations/20261017030608_land_use_plan_publication_transaction.sql`,
lines 56–59, with the missing ambiguity refusal before lines 94–139.

The function selects one scoped adoption/amendment decision with
`ORDER BY decided_on DESC,created_at DESC,id DESC LIMIT 1`. It verifies that row's
manifest hash, top-level scope and now its seven nested decision values. It never
checks how many native records the unchanged report adoption reader will match.

`openplan/src/lib/land-use-plans/report-adoption.ts`, lines 36–47, queries by
`plan_id`, `version_id` and `adoption_manifest_hash`, then calls `maybeSingle()`.
It has no `limit(1)` and rejects a query error. The client contract requires zero
or one row. The retained donor's `@supabase/postgrest-js/src/PostgrestBuilder.ts`,
lines 519–531, also shows the multiple-row error branch setting data to null and
status 406. I read that source without importing or executing it.
[Supabase maybeSingle reference](https://supabase.com/docs/reference/javascript/maybesingle).

The schema permits two native decision rows with the same valid manifest and
hash. `20260823000002_land_use_plans.sql`, lines 182–203, makes the decision ID
unique, not plan/version/manifest hash. The added columns and replacement trigger
in `20260823000007_land_use_plan_review_reporting.sql`, lines 278–320, validate
the latest closed review release and top-level scope and calculate the hash.
They impose no uniqueness on that hash. A search across every candidate migration
finds no later manifest-hash uniqueness definition. Append-only guards prevent
rewrites; they do not make two insertions of the same manifest impossible.

A concrete retained-state counterexample has two decisions D1 and D2 with
different IDs, the same plan/version/review release, identical complete valid
manifests and identical native decision values. Their calculated manifest hashes
are therefore equal. Other publication preconditions are valid. If the report
pointer is NULL, the function selects one decision, passes the new checks and
creates a report and singleton HTML artifact. If a matching singleton packet
already exists, it confirms that packet. In both cases, the subsequent native
reader query matches D1 and D2 and returns an error. `loadReportAdoption` returns
`invalid`; the report withholds its saved decision details, and provenance returns
503 at `provenance/route.ts`, lines 44–51.

This does not require a child insert during publication, a malformed nested
decision, a hostile writer or rewriting history. The current adoption route
constructs valid nested fields. Its service RPC inserts an append-only decision
and the installed source trigger does not reject duplicate manifest hashes.
Two application requests can also pass the earlier public-review state read
before either finishes; the RPC's update does not retain that state precondition.
That is a possible source path, not a native reproduction or a claim that the
normal UI demonstrably created duplicate rows. The finding needs only the
already-retained two-row state allowed by the schema.

**Required minimal correction:** before inserting or confirming a packet, refuse
unless exactly one native decision matches the unchanged reader's plan, version
and selected manifest-hash query. Do not narrow the count with a decision-kind
filter that the reader does not use. A conservative refusal suffices. Do not
delete duplicate history, synthesize a manifest, change the hash encoding or add
a global uniqueness migration merely to satisfy this bounded verifier. A later
separately authorized control should distinguish one valid matching row from two
matching rows while preserving other decision history. Concurrent direct inserts
remain a separate native boundary.

The underlying duplicate-record possibility predates this correction. The new
publication function undertakes to verify the retained packet before reporting
success, so it must account for the unchanged reader's cardinality requirement.
This is a newly identified gap in that bounded verifier, not an assertion that
the three-file correction introduces a general adoption or database defect.

## Both original P2 corrections address their stated counterexamples

I first read the complete round 1 REPORT and EVIDENCE imported from review commit
`6b94c19b472ac16c82ee2551e59933fce2c58036`. Both imported blobs match that commit.
The report remains SHA-256
`34bf1a4a237c30c511876b4a46c37ddc1c78c268febbbb10e1df95183cffdcec`.
Its request-changes verdict and original two findings remain unchanged history.
I then read the complete original candidate DESIGN, REPORT and EVIDENCE, the
complete retained-validation REPORT and EVIDENCE, all seven current delta files,
the full changed migration/test sources and pertinent unchanged readers/schema.

Original finding 1 concerns selecting HTML while readers select latest any-kind
artifact, plus the reader-disqualifying implementation-report marker. The new
function counts all artifacts and requires exactly one. It selects that row
under `FOR SHARE NOWAIT`, requires HTML and rejects
`metadata_json.kind = 'land_use_plan_implementation_report'`. A report containing
one good HTML artifact and a newer bad PDF now refuses. A two-row timestamp tie
also refuses. With one retained row, timestamp ordering selects that same row.
The page, provenance and designation-map queries remain unchanged.

This intentionally refuses additional history even when all artifacts would
otherwise agree. It is conservative, consistent with the response report and
within the original minimal correction. It does not make all historical packets
readable or globally immutable. The count and row lock do not exclude every
concurrent direct child insertion. I do not transfer the retained-state source
conclusion to that separate boundary.

Original finding 2 concerns a correct hash and top-level scope with an absent or
malformed nested decision. The new block runs before either publication branch.
It requires an object and all seven keys. Required text fields use explicit JSON
string types; vote and effective date must be present strings or JSON null.
Missing keys and SQL NULL cannot silently satisfy the presence/type gates.
[PostgreSQL JSON functions](https://www.postgresql.org/docs/17/functions-json.html).

The final `@>` comparison constructs all seven selected native values. Explicit
field types prevent array containment from passing for a string field. Scalar
containment requires the matching scalar value; extra object keys remain allowed.
`IS NOT TRUE` refuses false or SQL NULL. Native text columns are NOT NULL in the
base schema. Native vote/effective-date NULL values become explicit JSON null
in `jsonb_build_object`, matching the required nullable keys. There is no field
synthesis or retained JSON rewrite.
[PostgreSQL JSON containment](https://www.postgresql.org/docs/17/datatype-json.html#JSON-CONTAINMENT).

Body, instrument type and instrument identifier must not trim to empty using
the ECMAScript whitespace set. The set matches the existing implementation-report
migration, including nonbreaking space and FEFF. Exact native equality then
ensures the retained strings are also nonblank. Leading/trailing whitespace in
otherwise nonempty historical text is accepted; the reader trims it for display.
No new maximum-length requirement is imposed beyond the unchanged reader.

Native dates are real `date` columns. The explicit range 0001-01-01 through
9999-12-31 rejects infinities, BC dates and expanded years before a successful
return. `to_char(...,'YYYY-MM-DD')` supplies the exact four-digit Gregorian
representation compared to retained JSON. Native calendar validation plus exact
string comparison excludes invalid calendar strings and noncanonical padding.
The NULL effective date remains permitted and must match JSON null. I read the
donor Zod v4 date regular expression, which checks four-digit Gregorian dates
and leap days. No subject code runs.
[PostgreSQL date formatting](https://www.postgresql.org/docs/17/functions-formatting.html).

These are source conclusions supported by documented semantics. They are not
proof that the exact PL/pgSQL bytes parse, install or evaluate on a database.
The extra decision-row cardinality finding remains independent of valid nested
shape and values.

## The original transaction and access scope remain intact

The source race remains the original separate report INSERT, artifact INSERT and
pointer UPDATE, with two earlier NULL reads able to create two packets and replace
one pointer. The exact report reader requires pointer equality. The new function
still places both inserts and the NULL-guarded pointer update together and raises
when the update changes no row. A pointer-only compare-and-set would leave the
other writes outside that transaction. This is source transaction intent, not a
native rollback or concurrency result.

The unchanged helper validates original frozen bytes and uses the established
JavaScript canonical serialization. The SQL hashes supplied snapshot text and
compares its parsed value, identity and version number. The adoption manifest
retains the separate PostgreSQL JSONB-text hash. Neither encoding is replaced.
The route still reaches the RPC when its initial read contains a pointer. The
helper still validates result types and exact scope, retaining the original
existing title and checking a new title against the request.

`loadLandUsePlanAccess` obtains the authenticated user through `auth.getUser` and
checks current workspace membership against `plans.write`. The route supplies
that actor to the server service-role client. The function repeats the current
owner/admin/member check under a membership share lock. It locks the scoped plan
and adopted version with NOWAIT, checks the current adopted pointer, uses
SECURITY INVOKER and grants function execution only to service_role. The correction
adds no table grant, RLS policy, module, agent action or privilege escalation.
This source contract still trusts the service caller's actor parameter; it is
not cryptographic binding of arbitrary service-role calls to a human session.

I inspect the relevant report/artifact definitions and RLS, role-aware write
gates, restored role grants, plan/version ownership and frozen guards,
review-release/decision hash trigger, adoption RPC, append-only/cascade guards
and the atomic implementation-report pattern. No relevant gate, grant, pointer
transaction or adoption-source block changes in this correction. The new P2 does
not require replacing those systems.

Plan/version/membership row locks serialize new-route publication commands at
the source level. They do not attest installed ACLs or every privileged writer.
The adoption RPC's version-then-plan ordering differs from publication's
plan-then-version ordering. NOWAIT can refuse the selected conflict. Foreign-key,
trigger, table-lock, cancellation and rollout interleavings remain unproved.
The function publishes the current adopted edition; later supersession recovery
and historical/public reader ordering remain their existing boundaries.

`/reports/<reportId>` identifies the saved edition. The separate
`/published-plans/<planId>` URL remains the latest adopted edition, resolved by
its unchanged public loader. This review does not turn that URL into an immutable
edition identifier or extend the command to older superseded editions.

## Retained controls support source claims, within their actual selection

Evidence resides in
`/home/nathaniel/.local/state/openplan/land-use-publication-retained-validator-correction-20261016`.
I inspect the controller, dispatcher, entry wrapper, prepared grant/configuration,
actual Vitest JSON, input hashes, saved SQL copies, mutation specifications,
applied transform receipt, full names/messages, stage streams/results, terminal,
resource and finally records. I do not accept summary green as the sole evidence.

One unit, `openplan-land-use-publication-retained-checks-20261016-01`, has parent
terminal exit 0 and elapsed 84.71200391999446 seconds. Entry records invocation
`af42b94683474b90abbe78374be5713a`. The manager announcement names the unit but
contains no invocation ID. It reports service runtime 84.692 seconds and CPU
42.115 seconds. Actual recorded limits are 1,073,741,824 bytes memory, zero swap,
CPU `50000 100000` and Tasks64. Late memory peak is 387,313,664 bytes, PID peak
43, zero current swap and zero memory/PID limit events. Named source/donor mounts
are read-only, the new private proof root is writable, and the network namespace
differs from the recorded host namespace. These receipts do not certify
host-wide confinement or constrain this reviewer.

Harmless, baseline and restored JSON each contain 21 passes, no failures and
22 pending cases. Their selected full names agree. Twenty are new cases:
14 actual unchanged adoption-reader cases with supplied native/metadata records,
and six SQL-composition checks. One existing canonical-packet SQL assertion is
selected. The old 25-case/16-fault campaign does not repeat.

The SQL-comment harmless control survives. Its saved SQL copy differs only by
the declared comment replacement and its configured input hash matches. Each
fault's assertions have the same selected full-name set as baseline and no suite
runtime message. Each exact named oracle joins uniquely to a baseline name.
The actual saved failure messages contain AssertionError, with the consequences
listed below.

| Fault | Observed assertion consequence | Failed assertions |
| --- | --- | --- |
| `html-only-count` | Required all-artifact count text disappears. | 1 |
| `multi-artifact-guard` | Singleton text disappears in new and continuity assertions. | 2 |
| `wrong-artifact-kind` | Required HTML refusal text disappears. | 1 |
| `implementation-kind` | Disqualifying marker refusal text disappears. | 1 |
| `object-shape` | Required object check text disappears. | 1 |
| `required-keys` | Required seven-key check text disappears. | 1 |
| `string-type` | Required body string-type check text disappears. | 1 |
| `nullable-type` | Required vote string-or-null check text disappears. | 1 |
| `blank-native` | Required native body blank check text disappears. | 1 |
| `calendar-range` | Required decision date range text disappears. | 1 |
| `native-values` | Native kind mapping text changes to NULL. | 1 |
| `reader-invalid-status` | Actual unchanged reader returns absent instead of invalid. | 13 |

Eleven faults change only the explicit private SQL fixture, not installed SQL.
Their saved copies equal the exact candidate plus the declared replacement.
The reader-status fault uses the actual reader through a private Vite transform;
its applied file/find/replace receipt matches. It has eight passes and 13 failed
assertions, all with expected absent-versus-invalid messages. Every named result
hash, Vitest JSON hash and failed-assertion count matches the published evidence.
My private `retained-results-full.md` preserves every selected name and complete
failure message, including stacks. `evidence-inspection.json` records the joins.

All 18 check-stage stdout/stderr hash pairs match. Test stdout identifies each
JSON output; test stderr is empty. Scoped types, focused lint and nested direction
record exit 0. Type/lint streams are empty. Direction retains expired registry
and matrix reviews, the reviewed/current version difference and intervening-change
reminders. This is scoped TypeScript, not a whole-app TSC or Next build. I change
no date or registry to imply fresh direction.

The final ten source/config/test pins and eight preservation pins match hashes,
lengths, modes and UID/GID. The ten source pins also match candidate Git blobs and
live author files. The active transform is empty and `subject.sql` restores to
the candidate. The private local-checkpoint record, outside the frozen manifest,
binds all seven current changed files, commit, parent and application tree; its
files match exact Git and current author bytes.

I inspect the retained Vitest each() dispatcher. Since the non-object table mixes
arrays and scalars, its handler receives each original value, including the empty
array fixture. That static read confirms the case meaning. No amendment, import,
runtime retry or extra test follows it.

## Custody, ownership and execution remain bounded

The new proof manifest SHA-256 is
`79e819b24f873de2ce9750bde9591c1d30ec25d1c308653997548572ab9bc830`.
All 2,601 entries match bytes, lengths, modes and ownership. The original proof
manifest SHA-256 is
`3473de431240c2b3b9f94e9d06ad10de5dbe30a62d9288aa2cc9bb07c50c4ce8`.
I independently match all 3,119 original entries by the same fields. No original
proof corpus is copied, mutated or regraded. Original checks01 terminal remains
exit 1 and its failed seal stays unchanged. The metadata-only filename misses
and report truncation in the correction are preserved in its reader-errors note.

My worktree is `/home/nathaniel/.t3/worktrees/openplan/t3-2d04f550`, branch
`t3/land-use-publication-retained-review`. It starts clean at historical
`05dd3e8da4a4572437f06e771b0a2477873e681f`. I do not rebind or check it out.
I review exact Git blobs through my new private source overlay. Live T3 thread
metadata matches the assigned worktree, branch, Codex provider and subagent
relationship. Thread configuration explicitly records `gpt-6.1-sol` with
`reasoningEffort=high`, consistent with the harness. The catalog's generic
composer default remains low; it does not override the explicit thread setting.
No nested agent runs.

The author checkout is clean at the fixed candidate during inspection, and its
application tree matches `afbcd052`. Later unrelated docs-only M1 changes cannot
move this review's subject. The reviewer checkout's historical application tree
is not the candidate app. The local review commit adds only this new review
directory, with hooks and signing disabled. No push, PR, main update, source join,
merge, tag or release occurs.

I own only this new review directory and the new private directory
`/home/nathaniel/.local/state/openplan/land-use-publication-retained-independent-20261016`,
mode 0700. My metadata/Git/Python operations read source and retained records and
write only my review receipts/docs. I run no subject tests, imports, dependencies,
compiler, direction command, flock, manager, SQL, Docker, HTTP, Auth, provider,
SDK, browser, old subject or worker. Primary-document web reads inform source
semantics; they are not planning data authority or native proof. Review reader
mistakes and truncation follow-ups are recorded additively in my private notes.

## Each tier retains its blind category

The actual reader tests use supplied data and mocked database responses. They
assert the valid projection and exact scope filters and can detect selected
shape/refusal behavior. They do not exercise transport, multirow database
responses, RLS, installed roles, a real native hash, persistence or native
publication. Their fixtures omit the new decision-row ambiguity finding.

SQL checks inspect substrings and order. Their faults show those textual checks
can fail and their no-op can survive. They do not establish PostgreSQL parsing,
NULL/type execution, overload resolution, date formatting execution, trigger
interaction, rollback, locks, ACLs, RLS, schema history or installed behavior.
They can match comments or dead code and miss semantically wrong SQL elsewhere.
The SQL tests do not execute the fixture states named by their prose titles.

Hash and manifest inspection establishes retained bytes and custody. It does not
establish planning truth, legal validity, human adoption authority or operating
safety. The source correction refuses inconsistent records; it does not repair
old adoption history, make all public/historical readers consistent, prevent
all concurrent direct writers or create global artifact/decision uniqueness.

Migration 425 retains its originally CLI-generated filename and remains described
as unapplied. I perform no native inventory to attest any database's current
state. Native parser/application, rollback, locks, RLS, ACLs and exact migration
history remain open. Parent 424, external A0 source f8/app d577/history 421 and
budget source 3f/app 44e/history 422 do not prove this application or migration.
The M1 geography recipe remains 423 to 424, and its separate empty-root guard
result establishes neither native/tool nor archive behavior. Older whole-app TSC
at app d60 does not prove this application.

No identified build, real navigation, desktop/390px journey, console review,
actual public artifact, engine result, hosted result, practicing-planner or
public-participant observation runs. KI-025, M1, scientific acceptance, the full
V1 contract and release acceptance remain open. This bounded source review does
not shrink or approve that destination and authorizes no operating action.

The next necessary source action is the single retained-decision ambiguity
refusal described in finding 1. Its controls and native acceptance need separate
authorization. I send the material finding to the root during review and preserve
the original two findings and response without replacing their evidence tiers.
