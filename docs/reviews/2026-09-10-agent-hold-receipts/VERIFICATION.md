# Approved HOLD recovery, backend checkpoint

Worktree `~/.local/state/openplan/agent-hold-receipts-2026-09-10`, branch
`work/agent-hold-receipts`, based on released v0.49.4 at 4d02130b. This is not a
release candidate or a completed browser workflow. It continues roadmap A1a.

The existing approval table gains a context snapshot; the existing action ledger
gains a versioned result receipt and a unique approval index for those receipts.
Historical audit rows remain unchanged. Approval preparation captures the current
workspace binding, registered gate and prior decision. The transaction hashes the
canonical action text itself, parses that same text for the decision, and saves
the decision, verified audit receipt and consumed approval together. The route
checks a retained receipt before checking whether current context permits new
work. A current viewer may recover their earlier result but cannot execute a new
HOLD. A revoked member cannot recover it. Manual PASS/HOLD remains a separate
human-authored decision route.

PostgreSQL row locks are the proposed serialization mechanism. The [PostgreSQL
locking documentation](https://www.postgresql.org/docs/17/explicit-locking.html)
explains the conflict between FOR UPDATE and key/shared row locks. Actual races
with concurrent manual writes, binding changes and process loss remain to test;
documentation is not concurrency acceptance.

The additive migration applied through Supabase to the explicitly owned disposable
stack `openplan-restore-target-3390964`, API22301/database22302. No reset or demo
migration was used. Fourteen live database tests pass. They cover exact receipts,
replay after expiry/context change, stale context, original-user/workspace binding,
viewer/revoked access, unused expired/legacy approvals, ledger RLS and complete
rollback when decision/audit/approval writes are suppressed. The first fixture
attempt demoted its only owner, correctly hitting the owner floor before the
intended probe. A separate fixture custodian now preserves that invariant.

A harmless SQL comment survives. Removing payload matching, workspace/prior-decision
checks, audit confirmation, original-caller checking, expiry, function privilege
restrictions or receipt-read access fails the intended assertions. Disabling ledger
RLS exposes the synthetic receipt and fails the cross-workspace probe. A no-effect
success mutation fails the exact-decision assertion. Each mutation was restored;
logs were inspected, including the specific SQL failure messages.

135 focused tests across seven files pass, including migration inventory and the
existing manual/agent scope checks. TypeScript and scoped ESLint pass. Browser-side
route fixtures now model a transaction response, not the former separate database
writes; the live tests carry the atomicity claim. Helper tests assert query fields,
scope, canonical dispatch, exact receipt data and refusal statuses. Harmless source
comments survive. Missing projections/filters, ignored failures or scope, changed
receipt content, dropped approval context, absent route verification/transaction
calls and skipped recovery each fail their intended assertions. Source-call guards
only establish calls; they cannot establish runtime ordering or SQL correctness.

Two commands were initially invoked from the repository root rather than the app
package and failed before their checks ran. Corrected app-root invocations provide
the evidence above. Do not count those startup failures as product failures or
successful checks.

Remaining before a release: simultaneous requests/manual changes, process-loss
recovery, durable browser recovery after navigation/reload, native desktop/390px
journeys and console inspection, full QA/shuffle/workers/isolated RLS, upgrade and
final-main CI. Other actions still use separate effect/audit operations. No external
agent identity, assignment system, provider adapter or scientific claim is added.

Next implementation choice: expose recovery through the existing Planner Agent
Activity page. Prefer server-retained exact approved action data over an unscoped
browser-storage queue. A result lookup must never mint new approval or silently
re-execute work. An explicit resume may reuse valid unchanged consent; expired or
stale consent must return to review. Keep historical uncertain executions visible.


## Recovery interface checkpoint

The existing Planner Agent Activity page now lists the current user's retained
HOLD approvals. Checking saved results is read-only. An explicit resume dispatches
the same exact action and approval, then reads that approval by ID, including
records older than the first page. Expired consent and historical requests without
retained exact action data cannot be resumed. A lost chat response links to this
page and no longer claims that nothing changed.

Three live concurrency tests passed against the same disposable stack: concurrent
uses serialize and return one receipt; a concurrent manual decision makes the old
approval stale; terminating only the test's observed database backend rolls back
all writes and allows the original approval to execute afterward. The harmless
locking mutation survived. Removing the approval lock, project lock, or actual
write failed the relevant race/count assertion. Functions were restored. This is
database connection-loss evidence, not browser or Next-process interruption proof.

Recovery tests cover query projections, current user/workspace/action filters,
stable paging, exact older approval reads, changed retained data, current access,
read failures, read-only refresh, explicit same-consent resume, expired/completed
controls and truthful interrupted-chat guidance. The harmless source mutation
survived; 25 targeted mutations failed the intended assertions. Logs were inspected
for assertion failures rather than runner startup failures. These mocked tests
cannot establish database RLS, transaction correctness or browser reachability.
Browser acceptance and full release checks remain outstanding at this checkpoint.


## Full-suite integration corrections

The first full QA and shuffled seed540087 each found six failures: the new receipt
column and project-scoped consent read needed inventory classification; the new
copy added an unnecessary workspace term; the concurrency tests had timeouts below
the global limit; the migration lacked an Unreleased note; and the geography guard
mistook SQLSTATE42883 for a county code. PostgreSQL17 identifies it as
[undefined_function](https://www.postgresql.org/docs/17/errcodes-appendix.html).
These were missed at the focused checkpoint and are corrected here.

The migration note exposed a separate guard defect: it accepted a standalone slug
but rejected the exact full migration filename. It now accepts either, with
positive and wrong-name controls. Harmless integration/reference mutations survive;
missing consent project/workspace filters, an actual county branch, missing SQLSTATE
classification, an unclassified receipt column, ignored full filename and a
wrong-name match fail the intended assertions. These source inventories cannot
prove the SQL read itself; live receipt tests do that.

The first worker invocation refused to pass because the fresh checkout lacked
Python environments. Linking each worker to its existing local environment allowed
all52 suites to run and pass. The reused-stack RLS suite ran338 tests:335passed,
three schema-inventory assertions correctly found the retained
codex_audit_write_probe_20260910 fixture from earlier work. It was not an isolation
failure. A fresh named disposable stack, hold-release-rls-2026-09-10 on API29821 and
DB29822, is being prepared for a clean full run. The older fixture and its evidence
are preserved. No database reset or drop was used.


## Browser input-loss correction

At e02ad733, full QA/build and shuffled seed540087 passed13,571 tests in1,239
files;35files/309tests were skipped without live opt-in. The first browser
attempt identified the matching production checkout on3281, entered through
sign-in and Projects, then found that a question typed while project context was
loading disappeared when loading completed. No approval or HOLD was sent.

The context loader cleared the draft after its asynchronous read. It now clears
the previous case's draft when loading begins and preserves text typed during
that read. Both initial-load and case-switch tests cover the distinction. The
harmless comment survives; restoring late draft clearing or omitting old-case
clearing fails the expected input-value assertion. All22copilot tests pass.
Browser recovery must be rerun on the corrected build.

The first new-stack name was rejected by the existing contract fixture guard;
those refusals are setup failures, not product test outcomes. Only that owned
runner was interrupted, and its stack stopped with backup. Its replacement is
openplan-restore-target-2026091050 at the same API29821/DB29822, matching the existing
explicit disposable-stack rule. No guard was relaxed. The full live suite is
running there. The browser still uses the separately retained22301stack.


## v0.50.0 release preparation

At02a82286, the corrected production build was identified on3281. Real navigation
through sign-in, Projects, Planner Agent approval and Planner Agent Activity passed
at1440px and390px. Only the model's proposal stream was deterministic and explicitly
synthetic; context, approval, decision, receipt and authentication routes were real.
Context responses were delayed without changing their contents to exercise the
input-loss fix. No paid model was called.

For each viewport, an HTTP response was interrupted after the transaction returned
201. The recovery link, refresh and page reload showed the same original decision
and receipt without another POST. A separate request was interrupted before it
reached the server; after navigation/reload, keyboard resume reused its original
approval and wrote exactly one HOLD. A repeated authenticated POST returned200 and
the same decision, with no extra audit or decision row. Anonymous recovery GET
returned401. Only the two deliberately interrupted network errors appeared in each
console; there were no page errors or unexpected HTTP failures. Document width
matched each viewport, and recovery content stayed within its panel. Screenshots
were inspected. A harness retry corrected an early click before a SPA project
transition settled; it did not require a product change.

The final clean disposable stack is openplan-restore-target-2026091050, API29821,
DB29822. All338 live tests in42files passed. Full QA/build and shuffled tests at
e02ad733 passed13,571 tests in1,239files; the subsequent narrow chat fix passed22
focused tests, scoped lint and its production build. All52 worker suites passed.
Final release metadata and main CI/upgrade results remain separate pending checks.

Eight retained approval/audit rows from the v0.49.4 browser evidence were compared
against the actually upgraded22301database. Every previously captured field matched;
new context/receipt fields remained null. The source evidence file's checksum is
retained. A harmless unused probe note survived and altering a returned hash copy
failed the historical-record comparison. No database evidence was changed by that
comparison. It covers those recorded fields, not every historical row or an
independent restore. Final CI also rehearses a populated previous-release upgrade.

This increment makes approved HOLD recovery durable. It does not make other action
kinds transactional, authenticate an external agent, add assignments or provider
adapters, establish field usefulness, generate prescribed forms or change separate
scientific evidence tiers. Human review is not a merge or release gate. No reminder
constraint, paid service or demo installation was changed. Final main CI and tag
are pending at this release-preparation checkpoint.
