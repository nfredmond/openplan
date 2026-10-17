# The cardinality correction addresses the retained duplicate-decision finding

Independent round 3 exact-final-source review. October 16, 2026, Pacific time.

**Verdict: accept the bounded source correction. No new P1, P2 or P3 finding.**
The six added migration lines refuse the retained duplicate-row state identified
in round 2. They use the unchanged adoption reader's exact plan, version and
manifest-hash scope before either publication path. No further source correction
is required for that finding. This is source acceptance, not operating approval.

The exact subject is `182add8b6929d8127d50f16123650bf27e8cb88f`, parent
`eb4e2a4328880d2650251347a8629a6ad3c0ab27`, application tree
`42fc0315070f31269325acb264f0260723dbd56b`. The migration remains the same
generated, described-as-unapplied 425 filename. I run no application code,
compiler, test, SQL, dependency command, manager or browser. No additional pure
control is essential to this bounded source disposition, so none is requested.

## The new precondition matches the reader's cardinality requirement

Round 2 found that `LIMIT 1` selects a valid native decision without establishing
that the edition reader sees one matching record. The unchanged
`openplan/src/lib/land-use-plans/report-adoption.ts`, lines 36–47, queries
`land_use_plan_decisions` by `plan_id`, `version_id` and
`adoption_manifest_hash`, then calls `maybeSingle()`. It does not filter by
workspace, decision kind or content hash in that query. It returns `invalid`
when the supplied query result contains an error.

The current migration adds its refusal at lines 69–74. Its count uses
`plan_id=p_plan_id AND version_id=adopted.id AND
adoption_manifest_hash=decision.adoption_manifest_hash`. It requires exactly one.
It adds none of the three extra filters absent from the reader. The earlier
selected-row verification already requires a non-NULL manifest hash and valid
scope. The aggregate count yields a cardinality, and `<>1` refuses zero and
multiple matches. No new nullable comparison weakens this count precondition.

The count precedes nested decision validation, `already_published:=`, the
existing-pointer branch and the report/artifact inserts. Both successful paths
must pass it. In round 2's retained state, D1 and D2 have distinct IDs but the
same plan, version and valid manifest hash. That state now reaches count two and
raises PT409 instead of confirming or creating a packet. A single matching row
continues to the existing checks. History with another manifest hash does not
enter the count. A matching row of another decision kind does enter it, as the
unchanged reader requires.

I inspect the actual decision definition in
`20260823000002_land_use_plans.sql`, lines 182–203, the manifest columns and
replacement hash trigger in `20260823000007_land_use_plan_review_reporting.sql`,
lines 278–320, and the adoption RPC that follows. The primary key and scoped
unique key concern decision ID, not plan/version/hash. The trigger checks the
closed review release and top-level manifest references and computes its hash.
It does not establish manifest-hash uniqueness. Candidate-wide migration search
finds the relevant decision definitions, guards and references without a later
hash uniqueness constraint. The append-only guard prevents ordinary rewrites;
it does not itself prevent duplicate inserts.

The correction preserves that history. It adds no UPDATE or DELETE of decisions,
global unique index, manifest synthesis or historical repair. It therefore meets
the minimal round-2 response without expanding the lane. The retained-state
counterexample does not require concurrency or establish a normal UI reproduction.
I make neither a native reproduction claim nor a normal UI defect claim.

The count is a precondition at its query. It does not exclude every later direct
insert, certify future reader visibility or establish global uniqueness. The
function retains plan, membership and version locks, but this added count takes
no decision-range lock. Privileged writers, foreign-key interactions, transaction
isolation and exact interleavings remain native obligations. That acknowledged
boundary does not reopen the already-retained two-row counterexample.

## Both earlier corrections and the original transaction intent remain intact

I read the full round-2 REPORT and EVIDENCE first. Its report is 22,315 bytes,
SHA-256 `10ecfbc853efbd34e707fb9efcc4a79970e083b99bc977a0f1a8d5d41be501b6`.
Both files match review commit `2da034a2189c99e5538b56f62cd96ed135d5823b`.
Its request-changes verdict remains correct history for its earlier subject.
I also read the full original independent REPORT and EVIDENCE and compare both
with `6b94c19b472ac16c82ee2551e59933fce2c58036`. Its report remains 25,379 bytes,
SHA-256 `34bf1a4a237c30c511876b4a46c37ddc1c78c268febbbb10e1df95183cffdcec`.
Neither historical verdict or report is rewritten.

I read the complete original DESIGN, REPORT and EVIDENCE, complete
retained-validation REPORT and EVIDENCE, complete current decision-cardinality
REPORT and EVIDENCE, all six current delta files and pertinent actual unchanged
readers and schema. The four documentation files in this delta include the
preserved round-2 review and the current response. The executable delta contains
the six migration lines and the focused test additions. The full Git diff is
retained privately. No other application file changes relative to this parent.

Original P2 finding 1 concerned verifying HTML while readers selected the latest
artifact of any kind, and accepting an implementation-report marker that the
adopted-plan reader rejects. The current function still requires one total
artifact, share-locks that row, requires HTML and rejects the marker. One good
HTML plus a newer bad PDF, or a multirow timestamp tie, still refuses. This
conservative choice also refuses otherwise matching additional history. The
edition page and provenance endpoint retain their latest-any-artifact queries.
With one retained artifact, those queries select that row. No new source change
weakens this response. Future direct artifact insertion remains separate.

Original P2 finding 2 concerned a correct hash and top-level scope with an
unreadable nested decision. The current function still requires an object, all
seven keys, explicit string fields and present string-or-null nullable fields.
It still rejects reader-blank native text and native dates outside years
0001 through 9999. It compares all seven native values with JSONB containment,
using explicit date formatting and JSON null for nullable native values. Unknown
extra object keys remain permitted. The new count does not change that block,
its NULL refusal or either historical hash encoding. Round 2's bounded source
disposition remains supported. This review adds no PostgreSQL execution claim.

The original race remains separate route calls that can both read a NULL pointer,
create different report/artifact records and overwrite one version pointer.
The unchanged edition reader requires pointer equality. The transaction function
still places both inserts and a NULL-guarded pointer update together and raises
on an unmatched update. The route still reaches the RPC when its initial read
contains a pointer. This is source transaction intent, not native atomicity,
rollback or concurrent acceptance.

The helper still validates original frozen identity and serializes the original
object with `serializeFrozenRecord`. SQL still hashes the supplied JavaScript
serialization, not PostgreSQL JSONB text, for the frozen snapshot. The manifest
retains its separate native JSONB-text hash. Typed result scope and new-title
checks remain unchanged; verified existing packets retain their original title.
The report edition URL remains `/reports/<reportId>`. The separate
`/published-plans/<planId>` URL remains the latest edition, not an immutable
edition identifier. Historical retry recovery after supersession is unchanged.

The route obtains the actor through `loadLandUsePlanAccess`, which uses
`auth.getUser` and current `plans.write` membership. The server supplies that
actor to the service-role client. SQL retains the current owner/admin/member
check, membership share lock, scoped plan/version NOWAIT locks, current adopted
pointer gate, SECURITY INVOKER and service-role-only execution grant. No base
grant, RLS policy, action registry or module changes. The function continues to
trust the service caller's actor parameter. Installed privileges and arbitrary
service calls are not authenticated-human proof. The adoption RPC's different
lock order and all actual conflict behavior remain unproved.

## The retained four-case window supports its selected source claims

The proof root is
`/home/nathaniel/.local/state/openplan/land-use-publication-decision-cardinality-correction-20261016`.
I inspect the actual controller, dispatcher, entry wrapper, grant, preparation,
Vitest/configuration sources, mutation specifications, saved JSON, input copies,
applied transform, full names/messages, intents, PIDs, stage streams, terminal,
resources and final restoration. My private `evidence-inspection.json` records
independent byte and name joins. `saved-results-full.md` retains the complete
saved JSON, including every skipped result and failure stack. Summary green is
not the sole evidence.

One unit is recorded:
`openplan-land-use-publication-cardinality-checks-20261016-01`. Parent PID 345641
and wrapper PID 345647 end with return code zero, no recorded collector failure,
and elapsed 28.511573330964893 seconds. Entry PID 2 records invocation
`054acb06e2744bcea9afced5eb2c06ec`. Backend death remains `UNASSESSED` in the
terminal receipt. Process return alone is distinguished from the terminal record.

The saved manager stderr also prints that same invocation ID. I do not infer
the ID from the announcement in place of entry metadata. Unlike earlier windows
whose announcements omitted it, this window supplies both observations. Its
manager output reports success, runtime 28.491 seconds and CPU 14.127 seconds.
This receipt clarification is not a new application finding.

Actual entry limits are 1,073,741,824 bytes memory, zero swap, CPU
`50000 100000` and Tasks64. The late in-unit sample records 286,007,296 bytes
peak, PID peak 42, zero swap and zero memory/PID limit events. The named root
and source/donor mounts are read-only, and the proof root is writable. Recorded
network namespaces differ. The full mountinfo is metadata, not a claim that
every host path or this reviewer is confined. No host-wide confinement is claimed.

Harmless, baseline and restored saved JSON each contains four passes, no failures
and 19 pending cases. Every selected full name agrees. Three cases are new:
the actual unchanged reader refuses a supplied PGRST116 query error, SQL text
contains the exact three-field count, and the count precedes either branch.
The existing valid nullable-decision case supplies continuity and asserts the
exact native projection and three filters. The prior 21-case/12-fault and
25-case/16-fault campaigns do not repeat in this window or this review.

The four baseline names are:

1. `retained publication decision reader boundary accepts typed nullable fields and preserves the exact native query`.
2. `retained publication decision reader boundary refuses the supplied multiple-native-rows query error for a valid decision`.
3. `retained publication SQL composition, not database execution requires one native decision in the exact reader plan version and hash scope`.
4. `retained publication SQL composition, not database execution places the native cardinality refusal before either publication branch`.

The SQL-comment harmless variant survives with all four passes. Its private SQL
copy equals the candidate plus the declared comment replacement. This establishes
that the retained harness can report a survivor for the selected assertions.
Each fault joins uniquely to its declared baseline oracle. The actual failure
messages are AssertionErrors and no suite runtime message substitutes for one.

| Fault | Saved assertion consequence | Failed assertions |
| --- | --- | --- |
| `missing-native-count` | Scope slice is empty; count position is -1 rather than after manifest verification. | 2 |
| `narrow-native-count` | Extra decision-kind predicate changes the required exact scope string. | 1 |
| `late-native-count` | Early scope slice is empty; count offset 10014 is not less than branch offset 6332. | 2 |
| `reader-duplicate-status` | Actual reader returns `absent` where the supplied-error case requires `invalid`. | 1 |

The first three faults alter private SQL text only. Every saved SQL input equals
the candidate plus its declared transformation, including the late insertion.
Input hashes, lengths and source hashes match. The fourth fault transforms the
actual unchanged reader through the private Vite plugin. Its exact applied
file/find/replace receipt matches. It leaves three selected cases passing and
fails the intended supplied-error case. All four actual JSON hashes and named
messages match the current published evidence. I preserve complete stacks
privately rather than shorten the evidence itself.

Stage PIDs are 3, 39, 75, 110, 145, 181 and 216 for harmless through restoration;
types, lint and direction record PIDs 251, 258 and 269. Each records entry PID 2
as parent. The argv records select one test file, the four exact test names,
one worker and the private configuration/SQL fixture. Each test stdout identifies
its JSON output; each test stderr is empty. All ten stage stream hash pairs and
both parent stream hashes match. Intent is checked against output, not treated
as proof of completion by itself.

Scoped types, focused test lint and nested direction each record exit zero.
Type and lint streams are empty. Direction preserves the expired registry and
matrix reminders, reviewed/current version difference and intervening-change
reminders. No review date or registry changes. These retained results are scoped
TypeScript and selected lint, not a new whole-application TSC or Next build.
I execute none of those commands during this review.

The initial fixture message is preserved in the pre-grant patch and source pins.
Changing the final phrase back to `multiple rows returned` reproduces its initial
pinned SHA-256 `878def0720558f2647cdbc808182b12e19a57f9dcfd577bcdf61f6f286db19af`.
The final phrase is `multiple (or no) rows returned`. I inspect the installed
donor's `PostgrestBuilder.ts` multiple-row branch, lines 519–531. It sets PGRST116,
that message, data NULL and status 406. The fixture supplies code/message and
NULL data; it does not invoke that builder or reproduce actual transport.
The optional helper parameter defaults to NULL, preserving previous fixture
responses. No prior assertion is removed or expected result relaxed. The initial
preparation and final grant remain separate records; this is not a test retry.

## Exact source, custody and reviewer ownership are preserved

All ten source/config/test pins match exact candidate Git bytes and current author
files, including lengths, modes and UID/GID. All eight preservation pins match.
Finally records `sourceWrites=false`; the active transform clears and the SQL
fixture restores to exact candidate bytes. The separate local-checkpoint receipt
binds the six changed files, ten source pins, candidate, parent, application tree
and clean author state. It sits outside the frozen proof manifest as documented.

I independently inspect all three proof manifests, without copying old corpora:

| Corpus | Entries | Manifest SHA-256 | Mismatches |
| --- | --- | --- | --- |
| Current cardinality | 2,530 | `2314e644d5b286d4954e938a1f71b406c4b90b3834d9c83f5418484dcc1cc75a` | 0 |
| Retained validator | 2,601 | `79e819b24f873de2ce9750bde9591c1d30ec25d1c308653997548572ab9bc830` | 0 |
| Original transaction | 3,119 | `3473de431240c2b3b9f94e9d06ad10de5dbe30a62d9288aa2cc9bb07c50c4ce8` | 0 |

Each comparison covers hash, length, mode and UID/GID. The original checks01
terminal remains exit one, its failed seal classification remains
`PERMANENT_HARNESS_READER_FAILURE_EXIT1`, and its 47 sealed files remain exact.
Accepted named kills remain zero for that failed trial. Later source controls
do not replace, rerun or regrade it. The current root's full-JSON inspection of
round 2 is also preserved; I read the complete imported JSON independently.

My assigned checkout is
`/home/nathaniel/.t3/worktrees/openplan/t3-220a9e84`, branch
`t3/land-use-publication-cardinality-review`. It starts clean at historical
`05dd3e8da4a4572437f06e771b0a2477873e681f`. I do not rebind or check it out.
Exact Git blobs in my new private overlay supply the reviewed application.
The reviewer checkout's historical application tree is not the candidate app.

Live T3 thread metadata confirms the assigned checkout, branch, Codex provider,
subagent relationship and model `gpt-6.1-sol`. Thread configuration explicitly
records `reasoningEffort=high`, consistent with the harness. The generic catalog
composer default says low; it does not override that explicit thread selection.
No nested agents run. The author checkout remains clean at the fixed candidate
and application tree during inspection. Later unrelated documentation work
cannot move this review's subject.

I own only this new review directory and new private directory
`/home/nathaniel/.local/state/openplan/land-use-publication-cardinality-independent-20261016`,
mode 0700. Git/Python/shell operations read source and metadata and write my new
receipts and review documentation. I read the required planner-writing, prove-it,
Supabase and Postgres skills; explicit source-only scope overrides runtime steps.
No imports of subject code, dependencies, compilation, tests, direction commands,
flock, manager, Docker, SQL, native target, HTTP, Auth, provider, SDK, browser or
old campaign executes. T3 metadata calls inspect binding only.

My first broad worktree inventory and one bulk metadata display exceed output
limits. I preserve that reader issue additively, then inspect relevant binding,
terminal, grant, preparation and mount fields in bounded full reads. The latter
truncation comes from full mountinfo, not a missing test result. No control,
source or retained receipt changes to accommodate a reader mistake. The final
local commit contains this new review directory only, with hooks and signing
disabled. No push, PR, source join, main update, merge, tag or release occurs.

## Source acceptance leaves each unproved tier open

The SQL checks inspect literal text, scope and order. They can detect these
selected textual faults and can match comments or dead text. They do not run a
one-row or two-row SQL state. They cannot establish grammar, NULL/type execution,
installed visibility, trigger interaction, rollback, locks, RLS, ACLs, migration
history or transaction isolation. A late guard's textual-order failure does not
itself demonstrate a native atomicity defect.

The actual reader checks use supplied native/metadata responses and mocked query
methods. Projection and filter assertions protect that selected query contract.
They cannot establish actual SDK multirow handling, transport, database errors,
role visibility, native hashing, persistence or publication. Static inspection
of the donor branch supports fixture fidelity, not installed SDK acceptance.
Hash/manifest inspection protects bytes and custody, not planning truth, legal
applicability or the authority of an adoption decision.

Migration 425's parser, application, rollback, locks, RLS, ACLs, exact installed
history and direct-writer races remain open. I perform no native inventory and
do not attest any database's present state. Parent 424 and external A0/budget
native records do not prove this application or migration. The separate M1
isolated tool startup observes version/help at 17.6 only. It inspects no archive
and connects to no database. It does not supply publication or restore acceptance.

No identified build, real navigation, desktop or 390px journey, console review,
usable public artifact, hosted operation, scientific/engine acceptance,
practicing-planner observation or public-participant observation runs. KI-025,
M1, the complete V1 contract and release acceptance remain open. This disposition
does not shrink those requirements or authorize an operating action. Further
native work requires its own exact-source, exact-history reviewed scope; this
review grants none.
