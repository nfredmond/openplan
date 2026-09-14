# Response-to-decision context in progress

## Usage-reset handoff, September 14

The user asked to preserve continuity across the weekly usage reset. Resume
this lane from this checkout, not the original checkout or an old roadmap.
This section supersedes older next-step and uninstalled-status statements below.

- Checkout: `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`.
  Application commands run in its `openplan/` subdirectory.
- Branch: `work/engagement-decision-traceability`. All application changes through
  `ea474256c9322a88bbdfe87077f8a2ad33b67604` were verified present on origin at
  this checkpoint. Main remains `24f0dc9f2bee0e6958d205c505aa1a3b810dd648`.
  No PR. Merge directly to main when affected acceptance is ready.
- Latest released version remains v0.59.0. This decision-link increment is
  unfinished and unreleased. The complete V1 objective remains unchanged.
- The isolated application database is now at 340 migrations through
  `20261014000021`; activation and all 533 live RLS tests passed as recorded below.
  Preserve it and the disconnected proof database. Do not reset either.
- A production build of ea474256 completed and is served on localhost:3262 by
  our server process. The process may not survive a reset. Recheck ownership,
  served identity with `scripts/ops/which-openplan.sh`, and database URL before
  resuming. Other servers and the original checkout belong to separate work.

### Browser checkpoint

Both desktop 1440px and 390px journeys completed through real Projects and
Engagement navigation on identified ea474256. Each created a synthetic proposed
project decision and a manual response, linked them, lost the successful POST
acknowledgment deliberately, downloaded the retained request, reloaded, and
retried the identical request. Each retained one history entry, with the downloaded
context matching its retained SHA256. These manual responses have zero source
contribution references; they do not prove the full traceability journey.

Private evidence is under
`/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/browser/`:
`basic-1440-1789383801102` and `basic-390-1789383913908`, with JSON observations,
screenshots, accessibility snapshots and downloaded retained requests.
The reusable private runner is `basic-decision.cjs`.
Each console contains the deliberately induced connection reset. Navigation also
aborted RSC prefetch requests. Do not report an unqualified clean console.
Screenshots were inspected at both widths; the mobile history still needs a
separate scrolled inspection. Focus/Enter activation was exercised, but a
meaningful Tab traversal remains outstanding.

### Continue here

1. Extend browser acceptance to real source contributions, corrections and
   withdrawal at both widths. Inspect expanded history, keyboard traversal and
   a journey without induced console errors. Keep the served build frozen while
   collecting acceptance and preserve raw private evidence locally.
2. Complete self-service recovery for corrupt or unknown saved requests. Read
   existing translation/request-resolution patterns first. Archiving local bytes
   alone cannot cancel an in-flight server request. Preserve exact original
   bytes and prevent late commits or duplicates. Unsent draft durability also
   remains unproved.
3. Finish explicit public explanation with private-field exclusion and report/
   export lineage before claiming M9b complete. Private snapshots cannot be
   repurposed directly as public payloads.
4. Run applicable final QA, shuffled tests, isolated RLS and worker/upgrade checks.
   Inspect GitHub CI on the actual final main release commit before tagging.
   Earlier main CI does not cover this branch. No human review release gate.

The browser jobs completed and closed their browsers. No QA or mutation run is
pending at this checkpoint. Do not rely on tool session IDs surviving the reset.
Keep operation local and free; leave the pending reminder constraint untouched.

## Migration 21 activated in the isolated application stack

`20261014000021_engagement_response_decision_links.sql` is assembled from the
three verified candidates in context/command/history order. It is now installed
in `supabase_db_openplan-restore-target-2026091050`, application database
`postgres`, ledger `340:20261014000021`. This supersedes the older uninstalled
status below. All 339 preceding migration files matched the isolated stack
before the additive upgrade. Eight existing source/history table fingerprints
were identical before and after activation; the new link table started empty.
`decision-link-activation.json` retains those hashes. No database was reset.

The new installed test is `engagement-decision-link-activation-rls.test.ts`, using
the synthetic `fixtures/engagement/decision-link-activation.sql`. It exercises
the installed definitions without replacing their grants for its baseline.
Baseline and harmless controls pass; five deliberate privilege faults fail
their intended native assertions. This is seven executed tests. The old-schema
positive tests failed because the new reader was absent, and the combined
migration/fixture then passed inside a rolled-back transaction before installation.
The first invocation from the repository root failed to locate its fixture and
ran no tests; it is not the before-migration evidence. The corrected package-root
run is in private `decision-context/activation-before-migration.json`.

The new live test is included in `test:rls-live` and the table's dedicated RLS
inventory. Full isolated RLS completed successfully: 533 tests in 58 files,
375.66 seconds. Tool session `58922` is terminal. Its log is
`/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/rls-after-activation.log`.
The census baseline and harmless comment pass; omitting this table's probe fails
the actual native catalog inventory. Source was restored, as recorded in
`decision-activation-census-results.json`. Installed definitions of all three
new functions exactly match the separately tested proof database after full RLS.
`decision-installed-rls-results.json` records results and hashes. The
context proof's old-schema execution guard now lives in `main()` so its reusable
synthetic fixture can be imported after activation; direct execution still
requires its original uninstalled 339/20 target. The disconnected proof DB is
unchanged. Next build an identified server on a free port and exercise the editor
through actual Projects/Engagement navigation at desktop and 390px.

## Latest verified checkpoint: d94c73ee

Full local QA completed successfully on `d94c73ee0f8522037770241ba93c50b7e494834c`.
Its 1301 test files passed with 15188 passing tests and 504 skipped tests across
50 skipped files. Lint, dead-code checks, provider connector checks, dependency
audit and the webpack production build completed. The separately shuffled suite
also passed 15188 tests with 504 skipped using seed `914060`. Exact process
results and private log paths are in `editor-local-qa.json`.

The live RLS gate was explicitly skipped in that QA run. Native candidate
role/concurrency tests above are separate evidence; the new schema is still
uninstalled in application `postgres`. No new worker, upgrade, restore, browser,
public-explanation or release acceptance is claimed here. There are no remaining
QA or mutation processes from this checkpoint to resume. Existing port 3260 is
still the old isolated browser build, not this compiled checkout.

All implementation work is pushed to `work/engagement-decision-traceability`.
Main remains `24f0dc9f`; GitHub CI `34827922723` and RLS `34827922744` were checked
completed/success again. GitHub has no workflow runs for this work branch.
Do not attribute main's green CI to this newer implementation. Continue directly
to main after the additive migration and affected workflows are ready; no PR or
human review is required. The full V1 goal remains active.

## Campaign scope correction after editor QA

Full QA at `87bac2b8` passed lint/dead-code checks but stopped with 15186 tests
passing, 504 skipped and one wording-ledger failure. Four occurrences of the
generic word "record" in the new panel exceeded its baseline. Labels now name
the response/decision or say "saved". The unchanged wording check and editor
tests pass together. Later QA stages were not reached on that commit; the private
log is `decision-context/full-qa-87bac2b8.log` beneath the evidence root below.

A separate native probe found a real uninstalled-command privacy defect. An
inaccessible campaign normally returned `42501`, but a held campaign row or
request advisory lock returned `PT503`. This exposed lock state, not source
content. `FOREIGN_CAMPAIGN_LOCK_FINDING.json` and
`campaign-scope-order-results.json` preserve the original candidate hash and
observations. The command now scopes the campaign by current staff membership
before locking its row, then verifies/locks membership and workspace before
taking the request lock. Neither guard is an application-schema change yet.

The expanded concurrency suite passes 22 scenarios for both baseline and
harmless controls, with 11 targeted lock/scope failures. Parent-row controls use
`FOR NO KEY UPDATE` so an INSERT's foreign-key key-share lock cannot hide a
missing explicit share lock. Reverse-order cases hold a saved link transaction
while each source lock is attempted, then confirm the exact original receipt.
The separate proof database's corrected function was restored after mutation;
the application remains at 339/20 with candidates absent.

The previous viewer-command mutation survived after this fix because the new
campaign scope check also excludes viewers. Its updated mutation deliberately
changes both command access predicates while leaving the table read policy
intact; the viewer command refusal then fails as intended. Serial link, history
and grant/malformed-intent suites were rerun. Their source hashes reflect the
corrected candidate. The history probe regenerated the synthetic typed fixture.

The editor also hides local recovery content until a complete history response
confirms the same actor and scope. A new regression retains the old local copy
but refuses to display or download it after a confirmed account mismatch. The
HTTP/editor mutation suites were refreshed for these exact sources. Editor
baseline and harmless controls pass 81 tests and all 20 targeted faults fail.
HTTP baseline and harmless controls pass 36 tests and all 26 targeted faults fail.
`EDITOR_COVERAGE_GAP.json` records a timing gap in the first new account test:
it asserted absence before local recovery finished. The corrected test first
displays the actual saved explanation under its verified account, then changes
the returned actor on reload and checks that the explanation and download vanish.
The deliberate rendering fault now fails that executed assertion. A later
typecheck invocation repeated the root/package path error and did not run; the
correct package-root rerun completed successfully.

For activation, assemble the context, link command and history candidates in
that order as additive migration 21. Add an installed native role/lifecycle
fixture to `test:rls-live` and its dedicated-table census entry before upgrading
the named isolated application stack. Preserve the older 339/20 candidate proof
records. The context proof module currently asserts that old schema at import;
move its execution guard to its runnable entry point if importing its reusable
synthetic fixture after activation, rather than pretending the old pre-migration
proof applies to the upgraded schema. No reset is needed or authorized.

## Editor implementation checkpoint

The real campaign response builder now opens `DecisionLinksPanel`, scoped by
the current user, workspace and campaign. It reads eligible project decisions,
previews private response/decision/source context, saves a link or reviewed
successor, retains earlier versions, and can withdraw using original context
after current records disappear. It does not publish private source words or
approve a decision. This is implemented code, not yet browser acceptance.

Recovery uses one local-storage key per actor/workspace/campaign/request. The
exact context and intent are retained and read back before transport. Lost
acknowledgments retry the same ID. Definitive refusals preserve the old request
while allowing a newly reviewed attempt; malformed replies, permission changes
and uncertain outcomes stay unconfirmed. Corrupt local bytes remain downloadable
and block new saves. Self-service resolution of corrupt copies remains unfinished.
Receipt cleanup checks the exact retained context even for withdrawal, and
refuses concurrent local replacement. A confirmed old retry does not clear a
different explanation currently being typed.

The two failures from full QA at `dc6e4fcd` are resolved in the focused suite:
production callers now exist, and the role inventory follows `decisionLinkAccess`
to the actual `loadCampaignAccess` call. The role checker is static invocation
evidence, not runtime control-flow proof. Existing HTTP tests cover actual
handler refusals separately.

`prove-decision-editor.py` ran 80 focused tests for baseline and harmless comment
controls. All 19 targeted mutations failed executed assertions; exact source
hashes and limits are in `decision-editor-results.json`. These cover storage
readback, missing/replaced recovery copies, cleanup, reviewed hashes, original
withdrawal context, exact retry identity/account headers, refusal classification,
lost acknowledgments, corrupt bytes, the actual response-builder entry point,
snapshot account checks, predecessor wiring and the role helper invocation.
They use real React components and typed checks with mocked HTTP; browser layout,
cross-tab storage events and actual downloads still require live evidence.

The first typecheck command was mistakenly invoked from the repository root
and did not run. The corrected package-root check found missing workspace props
in an existing recovery fixture and overly narrow inferred native fixture types;
those fixtures were corrected. Lint also caught an unescaped JSX apostrophe,
which was fixed. Full QA is the next check on this checkpoint.

`prove-command-boundaries.py` is now retained here. Its native baseline and
harmless controls passed 13 cases, and five grant/malformed-input mutations
failed. `decision-command-boundaries-results.json` records the candidate hashes
and private logs. The application database returned to 339/20 with candidates
absent after rollback. The initial private anonymous-grant mutation had survived
because its checksum argument queried a fixture table before calling the command;
the corrected fixture supplies a preloaded setting, so the intended command grant
is now reached and tested. No production command change was needed for this gap.

Next activate the additive migration and installed RLS checks, then run identified
desktop/390px browser journeys, keyboard/console inspection and artifact/retry
acceptance. Complete explicit public explanation and export/report lineage before
claiming the full response-to-decision increment. Keep this unfinished editor on
the existing work branch until its database integration is ready for main.

## Usage-reset handoff, September 14

Resume in `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`,
branch `work/engagement-decision-traceability`. Another session owns the original
checkout. This checkpoint saves unfinished work on the existing work branch;
it is not a PR or a release. Continue directly to main after fixing and checking
the integration. The full V1 goal, local/free operation and no human release
gate remain unchanged. Do not touch the pending reminder constraint.

Remote main was `24f0dc9f` at this handoff. Its CI `34827922723` and RLS
`34827922744` previously completed successfully. Local `dc6e4fcd` adds the HTTP
implementation, but full QA failed with 15161 tests passing, 504 skipped and two
failures: the workspace role inventory does not recognize `decisionLinkAccess`,
and the new routes have no UI caller. Later QA stages were not reached. Logs are
under `/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/full-qa-dc6e4fcd.log`.
Do not describe this checkpoint as QA-green or push it onto main as complete.

The final two edits are unfinished and have not been tested: the role inventory
now recognizes the helper and its underlying `loadCampaignAccess` invocation;
`pending-decision-link.ts` retains exact actor/workspace/campaign/request recovery
copies and validates receipts before deleting them. These edits need focused
tests, harmless controls and targeted failures. Do not remove the caller check
or add an exemption. Implement the actual reachable editor instead.

Next connect a decision-links panel to `EngagementCloseLoopBuilder`, passing
`campaign.workspace_id` from the actual campaign page. Use the existing GET
history, GET context and POST routes. The context response is `{packet,actorId}`.
Review source context before link/refresh, retain the exact request before POST,
retry the same ID after lost acknowledgments, preserve original context on
withdrawal, and keep corrupt recovery bytes visible. Project decisions already
exist in Projects; project display names use `name`. Do not create another module.
No editor, application migration or browser acceptance exists yet.

A further native grant/malformed-input probe is saved privately at
`/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/prove-command-boundaries.py`,
with `command-boundaries/results.json` beneath that directory. Its baseline,
harmless control and five targeted cases reached their expected outcomes. The
first anonymous-grant mutation survived because its argument queried a fixture
table before the command ran; the corrected fixture supplies that argument from
a preloaded setting. Move the reusable probe/evidence into this review folder,
document that test gap and rerun as needed. Do not mistake it for browser proof.

Application stack `supabase_db_openplan-restore-target-2026091050`, database
`postgres`, remains at 339 migrations through `20261014000020`. Candidates are
installed only in disconnected `openplan_decision_link_proof_20260914` on that
container. Never attach PostgREST or workers to that proof database, recreate it,
or reset either database. Existing port 3260 serves the older isolated 5a93ae99
build; identify any new served build with `which-openplan.sh` before acceptance.
Recheck processes after the reset. Do not assume shell sessions or servers survived.

After editor implementation, finish additive migration/RLS, desktop and 390px
real navigation, keyboard/console checks, recovery, explicit public explanation
without private-field leakage and export/report lineage. Run applicable full QA,
shuffled, worker, upgrade and isolated RLS checks, then inspect CI on the final
release commit before tagging. v0.59.0 is the existing published release; this
work does not yet close M9b.

## Current history and HTTP checkpoint

Private history and HTTP integration now exist in addition to the original
native candidates. No application migration or editor integration is installed
yet. The new routes return unavailable against an unupgraded application schema;
this is unfinished development, not a release or browser acceptance claim.

`decision-history-candidate.sql` returns current eligible project decisions,
complete retained link chains and distinct unchanged/changed/unavailable source
states. The serial probe reads 1006 retained rows, preserves original context
after decision removal and withdrawal, and checks empty and populated staff
access. Baseline and harmless controls pass; eight targeted failures are recorded
in `decision-history-results.json`. `HISTORY_COVERAGE_GAP.md` preserves the initial
viewer mutation that survived due to borrowing a nested reader's protection.

The native save receipt now includes exact `payload_text` alongside its stored
checksum. That function and the history reader were installed only in the
disconnected proof database. Its manifest has the updated hashes. Serial link
and all 11 concurrency cases were rerun with the receipt change; four removed
row locks still fail. The ordinary application database remains at 339/20.

`openplan/src/lib/engagement/decision-links.ts` checks native context/definition/
history bytes, reference counts and ordering, scope, nonforking chains, cycles,
exact actors/requests and current-source labels. Both server loaders and future
browser recovery use this checker. Cycle checking reuses resolved paths rather
than repeatedly walking an entire long history. The native synthetic fixture in
`openplan/src/test/fixtures/decision-link-native.json` contains no real records.

Private GET history, GET context and POST command routes now call those loaders.
POST checks browser origin, expected user/workspace, strict intent and native
receipts. It makes one write attempt, preserves conflict/unavailable outcomes,
and explicitly refuses unregistered Planner Agent headers. No current-source
preflight is inserted before receipt replay. Responses are private/no-store and
do not expose database diagnostics. The RPC/client boundary is mocked in route
tests; this is not live HTTP, browser recovery or database grant evidence.

The 36 TypeScript contract/route tests and a harmless control pass. All 26
targeted parser/route mutations fail their named executed assertions; runner or
import failures do not count. `decision-http-contract-results.json` retains the
exact sources and private reports. Full QA and current CI are separate next
checks, followed by the remaining native boundary cases and editor integration.

A further native counterexample found the command attempted to lock a foreign
decision before checking campaign/project scope. An idle foreign row returned
`P0002`; a busy foreign row returned `PT503`. No contents or saved links were
returned, but the error exposed foreign lock state. The command now filters the
decision by both workspace and campaign/project membership before taking its row
lock, then rechecks and locks the relationship before saving. The retained
`FOREIGN_DECISION_LOCK_FINDING.json` records the old hash and observed errors.
Current baseline and harmless controls each pass 12 races, and all five lock/
scope mutations fail. Serial link and history probes were rerun on the corrected
candidate; the application database still has neither candidate installed.

CI `34827922723` finished all five jobs successfully, and RLS `34827922744` passed,
for the preceding `24f0dc9f` checkpoint. These results do not cover this later HTTP
implementation. Full local QA and its final remote CI remain separate checks.

## Earlier native implementation checkpoint

The v0.59.0 publication checkpoint is `8d563fd2` on main. Work continues in
`/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`
on `work/engagement-decision-traceability`. The original checkout has another
Codex session and remains untouched. This lane owns this review directory and
the forthcoming Engagement decision-link implementation.

The existing M9b response builder has source IDs and retained response history;
Projects already owns decision records and campaign/project relationships.
Extend those records. The complete V1 contract and other roadmap priorities
remain binding. No new module, paid infrastructure or human release gate.

`decision-context-candidate.sql` is an uninstalled private preview reader. It
captures current response and project decision records, the retained response
revision, campaign/project relationship, and every source contribution reference.
Source words and geometry are explicitly observed at preview time. They do not
establish what an earlier response author originally saw. Submission-time
configuration references retain their actual definitions; absent references stay
unknown. Private contact fields and moderation notes are omitted. Nothing here
approves a proposed decision or publishes its rationale.

The response clock advances on a no-op update without creating history. Compare
content excluding that clock, retain both clocks and the real history revision.
Do not invent a new revision or overwrite the old baseline.

`decision-link-candidate.sql` now adds append-only link/refresh/withdraw commands
with exact request replay, current source checks and nonforking correction chains.
The preview is not a write lock. The command takes nonblocking membership,
project relationship, decision and source locks before re-reading. This avoids
waiting in a cycle with the existing source-withdrawal writer. Concurrent lock
behavior now has the native evidence below. A withdrawal retains the predecessor's context
and works after the response, decision and campaign/project link disappear.

Native serial verification on the explicitly named disposable application stack
`supabase_db_openplan-restore-target-2026091050`, database `postgres`, installed
ledger `339:20261014000020`, ran each candidate and synthetic fixture inside a
rolled-back transaction. Neither candidate is installed in that application's
`postgres` database afterward. Reader
controls have a baseline and harmless survivor plus 17 targeted failures. Link
controls have a baseline and harmless survivor plus 10 targeted failures. See
`decision-context-results.json` and `decision-link-results.json` for exact source
hashes and failures. Run the corresponding `prove-*.py` files with `python3 -B`.

The first reader run stopped because its synthetic source correction omitted the
existing review version and reason. The fixture now uses that supported edit
contract, and the full reader rerun passes. The native link lifecycle retains
three records through link, refresh, current-source deletion and withdrawal.
Exact retries return the old records; viewer/outsider reads and writes are refused.
The preview excludes contact/metadata fields but still contains private source
words and decision rationale. It must never be used directly as a public payload.

`prepare-decision-proof.py` copied schema only into the new disconnected database
`openplan_decision_link_proof_20260914` on that same explicitly isolated container.
No user or contribution rows were copied. Only this proof database has the two
candidates installed. Do not recreate it, attach a worker or point PostgREST at it.
Its schema/candidate hashes and private dump location are in
`decision-proof-database.json`. Synthetic concurrency fixtures remain there.

`prove-decision-concurrency.py` observes each held backend as `idle in transaction`
in `pg_stat_activity` and checks its process before and after the competing call.
Baseline and harmless controls each pass 11 races: exact retry after commit,
interrupted rollback, competing root and successor, actual source and decision
corrections, project relationship lock, actual staff downgrade, and independent
source/decision/membership row locks. Four removed locks fail their respective
overlap assertions. Committed corrections reject stale contexts; explicit fresh
context succeeds. Results and limits are in `decision-concurrency-results.json`.
The original native function definition was restored after every mutation run.

The initial source-lock mutation survived. A real contribution UPDATE also locks
its parent project through the existing evidence-revision trigger, so that test
borrowed the parent's protection. `CONCURRENCY_COVERAGE_GAP.json` preserves this
failure and the private first-run evidence. The revised test holds the source row
alone as well as retaining the real-update scenario. No production code change
was needed to repair this test gap.

Next complete command grant and malformed-input checks, campaign/workspace/response
lock controls, reverse writer-first races, and retained-history reader validation
before installing an additive migration. These are still candidates, not a release.
Then finish staff navigation, an explicit public explanation with private-field
exclusion, export/report lineage and interrupted recovery. Agent writes require
the existing approval registry or an executable refusal.

Acceptance still requires native isolation/concurrency, meaningful harmless and
targeted faults, desktop/390px real navigation, keyboard and console inspection,
usable retained artifacts, full applicable QA and final CI before a new tag.
The reader alone does not close M9b or establish user-facing functionality.

The preceding main checkpoint's CI `34825484375` and RLS `34825484367` were checked
completed/success during this work. They cover `8d563fd2`, not these candidates.
