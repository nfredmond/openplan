# Saved plan context and display geography now share a guarded write path

October 16, 2026. This is a local implementation checkpoint for the bounded M1
KI-025 correction. ROOT trial01 establishes focused route behavior and SQL
source intent across one 31-case population. ROOT trial02 establishes scoped
TypeScript, changed-file lint and product-direction checks. The new migration
is **unapplied**. Native database enforcement, concurrent serialization,
frozen-history journeys and browser acceptance remain unproved. ROOT owns the
fresh independent final review before any join. This report does not close M1
or KI-025 as a whole and does not declare a release.

## The correction preserves the existing context command

General plan PATCH previously allowed geography label or geometry to change
after a retained place was saved. A later assembled snapshot could combine the
new display geography with the old retained place. Creation and the existing
context-save transaction already write the matching tuple atomically. The
original research establishes this as a source gap, not an executed native
failure or P2 result.

The route now uses the existing scoped context reader only for geography
PATCH requests. It refuses a label, geometry or combined disagreement with a
useful 409 directing the user to the existing context editor. A missing,
malformed, unnormalized or unreadable retained-context read does not become
legacy absence. It verifies the working version, context descriptor, plan kind
and query scope before a write. The update retains the plan ID predicate and
adds the verified workspace ID predicate. Conflicts stop both plan and
applicability writes. Title, authority-display and applicability edits avoid
that large context read. Valid legacy geography edits and semantic equality
remain allowed through the existing permission and working-version guards.

The route also recognizes only database code `PT409` together with the exact
message `Land-use plan geography must match saved context`. This preserves a
useful conflict response when the first context save occurs after the route's
legacy read. Generic `23514`, unrelated `PT409` and other database failures
retain the existing failure response. The focused route test simulates that
exact database response; it does not execute the two-session race.

The additive database trigger covers INSERT and relevant context/geography
transitions for direct table writers and existing service commands. It requires
exact label and JSON geometry agreement with a validated retained place. SQL
NULL context remains distinct legacy state. Retained context cannot be cleared
to that legacy state. Unchanged context, label and semantic JSON geometry take
the no-op path, allowing unrelated historical edits without silent repair.
Actual geography changes under unchanged retained context fail, including
attempted repairs to an already divergent row. The existing context-save
command remains the intentional attributed correction path.

The invoker function has a fixed search path, performs no table lookups and
adds no privilege escalation. The new trigger sorts after the existing
server-write guard, preserving that guard's refusal. It does not replace actor,
hash, receipt, lock, revision, ACL, RLS or frozen-snapshot safeguards. It adds no
country policy, jurisdiction default, place picker, module or inferred authority.
Study geometry, workspace home, jurisdiction, responsible bodies and legal
applicability remain different facts. It does not force `authority_label` to
one body. No history rewrite, automatic repair or backfill occurs.

## Source identity and exact ownership

The T3 binding and Git branch are
`/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8`,
`t3/land-use-context-geography-correction`. The assigned model is
`gpt-6.1-sol`, high reasoning. No nested agents run. The initial clean HEAD is
`05dd3e8da4a4572437f06e771b0a2477873e681f`. An explicit successful ancestry
check precedes the authorized local fast-forward to
`0875f3f341eac90adc1463a59b6422f0212e5a90`, whose application tree is
`2b1916349d7379c96bf97b1708b3e4016d37384d`. There is no fetch, reset,
checkout, force operation or binding change. The implementation checkpoint
commit is reported separately with its final tree and report hashes.

The complete original design, context-authoring guidance, current route,
context reader/store, creation/save transactions, triggers and frozen guards
were read before implementation. The full contract, M1, capability matrix,
latest direction review and responsible-human authority remain in force.
The research report at commit `681c05e198bd6d3e952c569979e97435499a4e94`
is 15,414 bytes, SHA-256
`c4f56bfb994ceda3e9752a7aeabada24f672b89a42bfb2842cdfafc664101116`.
The research checkout was independently read back at that clean commit.

Production ownership is limited to the plan route and one new migration:

- `openplan/src/app/api/land-use-plans/[planId]/route.ts`
- `openplan/supabase/migrations/20261017014010_land_use_plan_context_geography.sql`

The other owned files are the two new focused tests, the smallest necessary
context-persistence and draft-revision SQL fixture extensions, the small
Unreleased changelog note, this new review directory and the private evidence
directory. No shared helper or client changes are needed. All original 423
migration sources remain unchanged. The source directory contains 424 migration
files after the addition. Neither count establishes installed schema truth.

The migration body is 6,500 bytes, mode 0664, SHA-256
`b083241e879913afe93e848f4bb81191acf5439569c8226a86e14852bf3ee002`.
The immutable 6,577-byte draft has SHA-256
`07a78359bfe47c9846162cf35ba71f2bff2e3deed5c93ab675280a06c3b2dc21`.
Production removes only the draft's obsolete first 77-byte comment. All
executable SQL and other comments are identical. The exact difference remains
in [production-from-draft.diff](production-from-draft.diff).

## Trial01 failed after accepting focused partial evidence

ROOT dispatch session60841, unit
`openplan-land-use-geography-focused-20261016-01`, invocation
`337a058964034ab2a0181d19279d8f93`, reaches terminal exit1 after
89.31478891696315 seconds. The service consumes 89.295 seconds and 44.498 CPU
seconds. The sampled memory peak is 459,423,744 bytes, swap is zero, peak PIDs
42, and memory/PID maximum events and OOM events are zero. The admitted unit
uses 360 seconds, 1 GiB, zero swap, CPU50 and Tasks64 with one nonblocking
exclusive compiler lock. Source and donor mounts are read-only; only the two
private subject overlays can mutate. The environment and caches are private,
network and PID namespaces are unshared, `/run` is empty and only `/dev/null`
is device-bound. The explicit private Vitest envDir starts empty.

Classifier exits0 and focused exits0. All 16 focused invocations complete:
first harmless comment, restored baseline, 13 named faults and final restored
baseline. Each invocation contains the same 31 distinct file/fullName pairs:
27 route cases and four inert SQL source-intent cases. The exact expected two
file identities, nonempty assertion arrays, suite messages, counts and fullName
inventory are checked against the first harmless actual report. A missing
`numRuntimeErrorTestSuites` key is not treated as independent proof that runtime
suite errors are absent. Unexpected failed names and mixed exception classes
refuse classification. ROOT reports reading all 16 full stderr files without
broad unhandled/error markers.

The first harmless comment survives with exit0. Both restored baselines pass
all 31. The named faults fail with the intended `AssertionError`, actual name
and location, rather than an arbitrary nonzero exit. The table lists all 13
faults. `patch` means `land-use-plan-geography-patch.test.ts`; `source` means
`land-use-plan-geography-source.test.ts`.

| Named fault | Observed assertion locations, line:column | Failed assertions |
| --- | --- | ---: |
| allow_patch_geography_after_context | patch 65:29, 77:29 | 5 |
| check_label_but_ignore_geometry | patch 65:29 | 1 |
| allow_patch_repair_of_divergent_context | patch 77:29 | 2 |
| mask_database_conflict_as_500 | patch 143:29 | 1 |
| relabel_generic_database_error | patch 154:29 | 3 |
| legacy_absence_on_unreadable_context | patch 112:29, 118:29 | 8 |
| load_context_for_unrelated_patch | patch 101:43 | 3 |
| wrong_workspace_in_context_read | patch 67:21 | 3 |
| omit_write_workspace_filter | patch 84:22, 92:25 | 2 |
| omit_database_geography_invariant | source 10:17 | 1 |
| database_ignore_geometry_on_new_context | source 17:17 | 1 |
| database_revalidate_unrelated_history | source 24:17 | 1 |
| database_broad_conflict_identifier | source 33:29 | 1 |

[ASSERTION_EVIDENCE.md](ASSERTION_EVIDENCE.md) copies every actual failed
fullName, class, saved full failure message/stack and location, plus the first
harmless inventory. The original raw JSON/stdout/stderr remain private and
sealed. These are repeated populations, not 496 distinct cases or a broad suite.
The four database faults establish source-intent sensitivity only.

Classifier controls separately preserve the harmless survivor and intended-only
acceptance, reject a mixed TypeError and a suite import error accompanying a
named AssertionError, and reject unexpected names, wrong files, empty suites and
changed name inventories. In-memory guard removals fail as `AssertionError` at
`classifier-controls.py:43`, called at line86, with exact messages
`mixed-type: accepted forbidden report` and
`suite-import-plus-named: accepted forbidden report`. These supplied-report
controls do not replay an older suite. Raw actual tracebacks and restoration
readbacks remain in `classifier-controls/`.

The next type phase exits2 with exactly these diagnostics from unchanged code:

```text
src/lib/data-sources/crashes.ts(156,33): error TS2503: Cannot find namespace 'GeoJSON'.
src/lib/data-sources/crashes.ts(157,3): error TS2503: Cannot find namespace 'GeoJSON'.
```

The private scoped config restricts automatic types to `['node']`, unlike the
application config. The installed GeoJSON declaration exports the namespace.
ROOT classifies the failure as `HARNESS_TYPE_CLOSURE_FAILURE`, a scope-config
omission, not an established application defect. Trial01 remains **FAILED1**.
Lint and direction are not reached. The controller stops without retry and
records its exact `RuntimeError` and traceback. Both mutable overlays restore
their exact original SHA-256 and mode0664. The accepted partial classifier and
focused evidence remain separate from the failed whole-unit result.

## Trial02 passes only types, lint and direction

ROOT creates a separate trial02 scoped type config that adds only `geojson`
beside `node`. There is no weaker compiler option, skip, ambient substitute or
application/test edit. The original config, harness, manifests and failed trial
stay unchanged. Trial02 config SHA-256 is
`c92b20579650a313cd30fe3b5e9aa8a0ff82ac203ad171273923887ca60c0016`.
The donor's actual `@types/geojson/index.d.ts` SHA-256 is
`d30e67059f5c545c5f8f0cc328a36d2e03b8c4a091b4301bc1d6afb2b1491a3a`;
its package SHA-256 is
`488a70ed7c01bc30ceb90f667a141e80c4a7d31ee805d8d7d4498f82b014a522`.

ROOT dispatch session65696, unit
`openplan-land-use-geography-focused-20261016-02`, invocation
`47301b84565d4c2bbaa25a32919d2172`, exits0 in
16.451315058977343 seconds. The service consumes 16.431 seconds and 8.156 CPU
seconds. Sampled memory peak is 442,335,232 bytes, swap zero, peak PIDs44,
maximum events and OOM events zero. Its separate grant admits 120 seconds,
1 GiB, zero swap, CPU50, Tasks64 and one exclusive compiler lock. Scoped types,
changed-file lint and product-direction each exit0. No Vitest or mutation
repeat occurs. ROOT confirms the exact compiler lock inode has zero holders.

Typing covers the route, the two new tests and their imported closure, not the
entire application. Lint covers the changed TypeScript files. Direction succeeds
while retaining the reminders: jurisdiction registry review expired September
28; capability matrix and registry reviews expired October5; latest review
covers v0.66.0 while the package is v0.68.0; that review predates the listed
substantive changes. Passing direction does not erase those reminders or
change product authority.

## CLI bootstrap failure and migration generation are separate evidence

ROOT generation01 invocation `7a822215de774b1b8b07b9e992c10de1` reaches
terminal1. Only the installed candidate's `--version` runs. It exits -4 with
empty stdout and a Bun1.3.13 Linux/glibc2.43 segmentation panic at0xBBADBEEF.
No help or generation follows. This is an observed CLI/bootstrap failure in
that bounded sandbox; its cause is not established in application or SQL code.
The immutable 15-file proof is preserved. No package manifest alone establishes
an actually tested binary/version.

ROOT separately obtains and checksum-verifies official Go CLI v2.75.0. Its
binary SHA-256 is
`ede7713ac26a4e8bd8ebdfad93676d9652b254d4d6bc163a003a6493f4b3302b`.
Generation02 invocation `a15dbf0341b34e55a1e7ffde8ab4ebf4` exits0. Actual
version, top help, migration help, migration-new help and one private
migration-new command all exit0 with empty CLI stderr. Parent elapsed is
1.077 seconds; service elapsed is1.016 seconds. ROOT allocates the actual
empty generated filename `20261017014010_land_use_plan_context_geography.sql`
and authorizes the exclusive new-file copy. This generation-only result does
not regrade the failed Bun trial and establishes no project dependency install,
database connection, migration application or general CLI support claim.
[GENERATION02.md](GENERATION02.md) records the allocation and comment-only copy.

## Public and private custody remain explicit

Public custody is this committed review directory, its assertion appendix,
current pins, source diffs and historical preparation records. `STATUS.md`
links this current result above its preserved source-preparation history.
`SOURCE_PINS.txt` and `FINITE_WINDOW.md` remain the exact pregrant snapshots;
their earlier pending/unexecuted language describes that stage. The Unreleased
changelog note also retains its sealed precheck wording. This report supersedes
its pending-check status, while migration installation remains pending.

Private implementation evidence lives under:

```text
/home/nathaniel/.local/state/openplan/land-use-context-geography-correction-20261016
```

That directory retains all source snapshots, subject/window/closure manifests,
controllers/configs, exact two-file overlays and actual unit-controls,
classifier-controls and finite-window outputs. Its original scoped type config
is untouched. New handoff-only evidence lives in `final-handoff-20261016/`.
No old private output or manifest is regenerated.

ROOT focused custody lives under:

```text
/home/nathaniel/.local/state/openplan/land-use-geography-focused-root-20261016
```

It retains trial01 grant/intent/dispatch/terminal/resource evidence,
`failed01-inventory.json` and separate `trial02/` config, pins, grants, process
receipts, terminal, phase outputs and success. Failed01 inventory SHA-256 is
`62188f03c6f7ef7a26d45c65bb5ee3b06955dba20ebbd1a42dc1ef568fdfc96b`.
An additive final readback confirms all114 listed files still match exact bytes,
sizes and modes. Trial01 grant SHA-256 is
`9fdebd5d01f77776ca5cae84aca5115d51de0a23d60d1c629dce49787ae45d97`;
trial02 grant SHA-256 is
`63fe6818def7a7c68c478ca6113b65039811dc078e31e57a1adc2aca2a99596a`.
[EVIDENCE_INDEX.json](EVIDENCE_INDEX.json) binds exact private paths, sizes,
modes and hashes, including the pre-update STATUS snapshot. It is a custody
index, not new runtime evidence.

CLI custody remains separately under
`land-use-migration-generation-root-20261016`,
`land-use-migration-generation-root-20261016-r2` and
`land-use-cli-official-go-release-20261016`, all beneath the same private state
parent. Earlier root selection/research proofs, canonical targets and concurrent
A0/budget subjects remain outside write ownership.

## Evidence limits and landing hold

The route tests mock database/access/working-version boundaries and assert
query projections and scoped IDs. They prove those local behaviors under the
supplied records. They do not prove actual PostgreSQL parsing, installed
trigger order, grants/RLS, direct authenticated writers, row locks, isolation
or serialization. SQL source matching can detect the named source omissions
but cannot establish executable semantics. The extended SQL fixtures are
prepared and unexecuted. Their new assertions have no native mutation proof.

Existing create/save atomicity, retained retry receipts, direct writers and
no-op historical updates still need native execution on a **new, exclusive,
explicitly ROOT-allocated target**. The ordered first-save versus PATCH test
requires two real sessions. The frozen-A/fork/save-B journey must preserve
original A bytes/hash while accepting B through the existing command. None of
those journeys ran here. No older source/proof, demo, source database, A0 or
budget target is an authorized substitute.

There is no native SQL, Auth, database fixture, Docker/service, provider,
application HTTP or browser operation in these checks. Desktop and390px
navigation, console/artifact checks and practicing-planner usability remain
separate unproved tiers. There is no push, PR, main update, hosted operation or
release. The full contract remains unchanged. ROOT must conduct the fresh
independent final review before a join; this local checkpoint grants no next
runtime operation.
