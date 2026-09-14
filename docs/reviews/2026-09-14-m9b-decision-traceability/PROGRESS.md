# Response-to-decision context in progress

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
