# Independent source review finds one context-replay fixture defect

October 16, 2026. Review subject `8d292caf864a3f66409bef6868fde82ef7a4f82e`,
parent `0875f3f341eac90adc1463a59b6422f0212e5a90`.

**Disposition: one P2 finding, no P1 finding. Hold approval of the exact
checkpoint until the fixture preserves the original replay bytes.** I find no
additional P1 or P2 defect in the changed route or migration source. Their
source design addresses the bounded saved-context/geography divergence. This
does not establish installed database enforcement, concurrency behavior or M1
acceptance. No production, fixture or old evidence edits occur in this review.

## P2: keep the original command bytes in the post-freeze replay

The affected file is
`openplan/src/test/fixtures/land-use-plans/context-persistence.sql`.
The new assignment at line 117 changes `raw_command` from study area A to
study area B. The later call at line 140 still supplies the original A
`command` ID and null original expected hash, but now passes B's command text.

The existing RPC compares `previous.command_text` with `p_command_text` before
returning the saved receipt. Its current definition is
`20261016000006_land_use_plan_retained_study_area.sql:30–42`. A different
command text raises `PT409`, with message `This command ID already belongs to
a different context save`. The fixture does not catch that exception at line
140. Its next assertion, `lost acknowledgment recoverable after freeze`, and
its cleanup assertions therefore cannot be reached through this source path.

This regression follows from the new B assignment. The parent fixture never
replaces `raw_command` before this retry. It is a fixture defect, not evidence
that valid production replay fails. The meaningful A-to-B save at lines
115–120 and the original-receipt check at lines 121–123 are useful and should
remain. The latter already uses `call_sql`, which captures A's exact text at
line 50 before the reassignment.

The smallest correction is to use `EXECUTE call_sql INTO replay` for the
post-freeze original retry too. Alternatively, retain A's text in an immutable
variable and pass that. Preserve both A's command ID and its original expected
hash. Do not weaken the RPC byte comparison or change the expected conflict
to manufacture a passing fixture. After correction, check that this final
retry returns A's original receipt and does not overwrite B. Any execution
still requires a separate ROOT allocation. I neither implement nor execute
this correction. This finding is a source trace, not an observed native failure.

## This reviewer has a separate T3 worktree and bounded ownership

T3 `t3_thread_list` and `t3_thread_read` identify this delegated review as
`sol-m1-context-geography-independent-20261016-round1`, under parent thread
`1401bb6a-70e4-42eb-a1f1-98045485f8cc`. They bind provider `codex`, model
`gpt-6.1-sol`, branch `t3/land-use-context-geography-independent-review` and
worktree `/home/nathaniel/.t3/worktrees/openplan/t3-5c638c79`.
Git independently reports that branch/path, clean starting status and HEAD
`05dd3e8da4a4572437f06e771b0a2477873e681f`. Runtime instructions identify high
reasoning effort. The catalog's separate model-option `currentValue: low`
does not attest this run's effort. No nested agents run.

Before any writes, those bindings distinguish this review from the author at
`/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8`, branch
`t3/land-use-context-geography-correction`. The author remains clean at the
exact subject commit. That commit has the supplied parent and application
tree `64a2c31e768d26c0978a3e0b945d2e1f41de9510`. The parent's application
tree is `2b1916349d7379c96bf97b1708b3e4016d37384d`. This older review checkout
is not used as the production source authority and is not joined to the author.

Write ownership is only this new review directory and the new private directory
`/home/nathaniel/.local/state/openplan/land-use-context-geography-independent-20261016`.
Other active T3 lanes, author/root trees, canonical documents and old proof
remain outside ownership. Identity and new metadata readbacks stay private.
This review uses planner-writing, prove-it, any-place and Supabase guidance
within the user's explicit source-only boundary. It executes no skill-suggested
network, SQL, CLI or runtime verification.

## Original purpose and source custody remain intact

I first read the complete original research report and `SOURCE_PINS.txt` from
research commit `681c05e198bd6d3e952c569979e97435499a4e94`, then the ROOT
selection readback. The report has 15,414 bytes and SHA-256
`c4f56bfb994ceda3e9752a7aeabada24f672b89a42bfb2842cdfafc664101116`.
It establishes an independent PATCH path that could diverge from saved
context. It does not establish a P2 reproduction, native failure or corruption
of already frozen evidence.

The author report is read in full at 17,602 bytes, SHA-256
`fc561907f9ccd3c48ac74b889e3f80f7c00f52860f0bdcb64c3f4642a120d697`.
I also read its current pins, assertion appendix and evidence index. The
current report supersedes the historical pregrant pending status. The index
intentionally retains an older STATUS hash, while CURRENT_PINS identifies the
final STATUS and its preserved private prior copy. That dated distinction is
not a source mismatch.

All 50 explicit CURRENT_PINS rows match their saved hashes, sizes and modes.
The seven changed non-review subjects match the exact commit bytes. Git's
migration diff adds only `20261017014010_land_use_plan_context_geography.sql`.
It does not modify any of the parent's 423 migration sources. The resulting
424-file inventory is source custody, not installed schema truth. The final
SQL matches the retained draft after its obsolete first 77-byte comment is
removed. No executable SQL changes during that copy.

`SOURCE_PINS.txt` in this directory identifies the reviewed source, designs,
reports and selected saved receipts. Private readbacks record matching
metadata without copying the proof corpus. These checks can detect altered
bytes and wrong identities. They cannot establish SQL execution or authenticate
the historical runtime beyond the saved records.

## The route protects the intended write boundary

The changed route at lines 142–167 keeps authentication, write permission and
working-version checks ahead of context inspection. Geography requests reuse
`readPlanContext` with the loaded plan, workspace and actor. The real reader
selects context, hash, descriptor, plan kind and working pointer, with both
plan and workspace predicates. It distinguishes explicit SQL-null legacy
state from missing projection fields, invalid shape, normalization changes,
missing hash and read failure. The route also compares the returned working
version, descriptor and plan kind against its verified inputs.

For retained context, lines 155–161 compare both the previously loaded
geography and each supplied geography field with the saved place. They refuse
both a new divergence and an attempted independent repair of an old divergence.
Deep equality permits JSON property-order differences while retaining array
order and values. The useful 409 points to the existing context editor and
preserves the draft. These returns precede all plan and applicability writes.

Title, authority-display and applicability-only changes avoid the full-context
read. Legacy geography edits remain possible only after the reader validates
explicit absence and identity. The plan update at lines 188–189 retains the
plan predicate and adds the verified workspace predicate. The exact `PT409`
code plus exact geography message maps to 409 at line 191. A generic `23514`,
another `PT409` message or other database error retains 500. This narrow mapping
does not relabel unrelated failures as geography conflicts.

The reader's hash validation checks the stored field's format, not a newly
computed client hash. The existing generated database column supplies its
relationship to context. Nothing in this review promotes a mocked hash into
native generated-column evidence. Earlier reads can also become stale. The
database guard is necessary alongside this route pre-read.

## The migration preserves coherent transitions without repairing history

The new function is `SECURITY INVOKER`, fixes its search path and performs no
table lookup. It reads OLD/NEW values and returns or refuses; it does not assign
context/geography values, change grants on tables or replace prior functions.
Its execute privileges are revoked. Trigger name
`land_use_plan_context_zz_geography` follows the existing
`land_use_plan_context_server_write` name and precedes the identity-revision
trigger. Source ordering preserves the earlier server-write `42501` for an
authenticated attempt to change context or its guarded descriptor fields.
Native installation and permission behavior remain unverified.

The transition logic at lines 9–22 has four distinct outcomes. An unchanged
context/label/JSON geometry tuple returns without revalidating history.
Changing geography under unchanged non-null context refuses, including an
attempt to repair a divergent or malformed historical row. Clearing retained
context to SQL NULL refuses. SQL NULL legacy rows otherwise remain eligible
for their established independent edits. JSON null is not that legacy state.

A new or changed non-null context proceeds through the retained-place checks
at lines 27–99. The outer predicate uses `IS NOT TRUE`, so absent/null agreement
does not pass. It requires matching label and JSON geometry, schema version,
place shape, bounded numeric bbox values and latitude order. Drawn/uploaded
places cannot carry invented resolver/jurisdiction identity. Separate type
checks precede nested array lengths and iteration. Polygon/MultiPolygon rings
need four two-number positions, WGS84 ranges and the established closure
tolerance. Longitude bounds may cross the antimeridian. This is shape and
agreement checking, not topology, provider validity or legal assessment.

The existing application schema also uses two-number positions and the same
ring-closure tolerance. The new SQL adds no US state, agency or jurisdiction
default. Existing resolver/country restrictions remain separate M1/KI-025
work. Study geometry does not become adopting authority or legal applicability.
No new picker or shared helper changes broaden this correction.

For a first context save after a legacy PATCH pre-read, a later geography
update reaches the trigger against the retained row and refuses a changed
tuple. If the geography update occurs first, the existing context command
writes its matching tuple afterward. This is source reasoning about the two
orders, not a two-session observation or proof of every concurrency schedule.

## Existing create, save, revision and frozen paths remain separate

The current `save_land_use_plan_context` definition locks the plan, checks
membership, checks exact replay before new-save preconditions, then checks
working version, expected context hash and prepared assessment. Retained-place
mode checks the saved place. Its lines 74–82 update context, label and geometry
in one statement and append the receipt. A meaningful A-to-B command changes
context and supplies matching geography, so the new trigger's unchanged-context
refusal does not block that intended path. Exact replay returns before another
plan update. Creation likewise inserts the matching tuple at migration 7,
lines 110–119. No RPC or creation source changes in this patch.

The unchanged identity-revision trigger counts relevant tuple changes. Its
no-op path and the new guard's no-op path preserve unrelated historical edits.
The new trigger does not rewrite context commands, freeze receipts, snapshots
or adopted bytes. The existing freeze RPC locks/rechecks revision, identity and
context. Frozen readers validate retained values and hashes without current
draft backfill. Fork activation changes the working pointer. The new guard's
unchanged-tuple return accommodates that pointer write.

I trace production table references in application, worker and script source,
and compare the retained SQL definitions. Ordinary table writers also reach
the new BEFORE trigger. The old server guard still reserves context changes
to its verified server roles. Actual ACLs, RLS, installed triggers, service
writer behavior and trigger bypass privileges remain native proof boundaries.
The correction does not certify arbitrary privileged SQL or new authorization.

The draft-revision fixture replaces its shallow placeholder context with a
matching tuple, refuses clearing and freezes with that retained context. This
fits the new source contract. It still uses a synthetic content hash and partial
snapshot for its narrow revision purpose. It cannot establish a real freeze
command, public reader or frozen-A/fork/save-B journey. The context fixture adds
direct authenticated conflicts, service clearing/insert conflicts, unchanged
row/revision checks and a meaningful replacement save. Those useful intentions
do not cure the separate final retry defect reported above.

## Saved controls support only their stated evidence tier

I inspect the 16 saved unit JSON reports and their stderr, without rerunning
the campaign or importing product code. They retain the same 31 distinct
file/fullName pairs, comprising 27 mocked-route assertions and four SQL source
assertions. The harmless comment and both restored baselines each pass 31.
All 13 named faults fail through saved `AssertionError` messages with actual
test locations, not an arbitrary nonzero exit. The nine route faults cover
agreement, repair refusal, exact error mapping, invalid reads, unrelated-read
avoidance and scope predicates. The four SQL faults cover omitted attachment,
geometry comparison, no-op history and conflict identifier as source strings.
They do not prove executable SQL semantics. No 496-distinct-case claim follows
from repeating the population 16 times.

The raw report messages agree with the assertion appendix and actual test
locations. A finite metadata comparison of those 16 JSON/stderr pairs plus
controls/restoration matches 34 selected evidence-index entries. No unexpected
runtime marker appears in those saved stderr files. The classifier's saved
controls retain the harmless survivor, intended-only acceptance, refusal of
mixed TypeError, suite-import-plus-named, unexpected-name, wrong-file, empty and
changed-inventory reports. Its two in-memory classifier faults retain actual
tracebacks at `classifier-controls.py:43`, called at line 86. These are saved
report-classifier controls, not native enforcement tests.

Trial01 remains terminal1 after 89.31478891696315 seconds. Its accepted
classifier/focused phases precede scoped typing exit2 with the two unchanged
`crashes.ts:156–157` missing-GeoJSON diagnostics. The saved private configs show
trial01 restricts types to `node`; trial02 adds `geojson` without weakening
compiler options or changing product source. Trial02 remains its distinct
terminal0 after 16.451315058977343 seconds, covering scoped typing, changed-file
lint and direction only. It does not rerun Vitest or repair trial01. Direction's
age/version reminders remain. I read the ROOT preservation receipt for all
114 failed-trial files; I do not claim to independently rehash that whole set.

The retained Bun CLI attempt stops after failed `--version`, status -4. The
separate official Go 2.75.0 generation record has five status0 commands and the
ROOT allocation for the actual empty filename. Its checksum-pinned binary and
generation evidence establish that bounded generation history, not SQL
application or general installed-CLI acceptance. Both histories remain intact.

## Approval limits and next owner

ROOT should return the one P2 fixture correction to the author. The exact
checkpoint is not fully source-approved while that changed fixture contains
the conflicting replay. No further unresolved production source question
requires an inert test window from this reviewer. This report requests no
runtime operation. Corrected bytes require an updated source identity and a
bounded review of that correction; old proof must remain unchanged.

Later native parsing, trigger order, permissions/RLS, direct authenticated and
service writes, no-op divergent history, meaningful context-save/replay,
two-session first-save/PATCH orders and frozen-A/fork/save-B custody need a
new exclusive ROOT-allocated target. Existing A0, budget, demo and source
databases are not substitutes. Native fixture assertions still lack native
harmless/targeted mutation evidence, including a direct-write challenge with
the database guard removed.

No product imports, compilation, tests, dependencies, direction check, compiler
lock, manager, product helper, CLI, Docker, SQL, database, Auth, HTTP, browser,
provider or seeded-fixture execution occurs here. Shell/Python operations read
text, Git and saved JSON or create review metadata. No source join, push, PR,
main change or release occurs. Only new review documents receive a local
commit, with metadata and whitespace checks.

Source, mocked-route/unit, native, browser and practitioner acceptance remain
distinct. Identified desktop and 390px navigation, console review, usable
artifacts, practitioner/counsel observations and full M1/V1 remain unproved.
The complete all-state/DC, territory, tribal and overlapping-authority contract
remains active. This bounded correction does not close KI-025's report-pointer,
public bbox or creation-provider gaps, or the remaining whole-product floor.
