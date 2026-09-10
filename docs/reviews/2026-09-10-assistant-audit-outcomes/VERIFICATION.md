# Assistant audit outcome repair

Base main `3ffd2a41`; isolated checkout
`~/.local/state/openplan/assistant-audit-outcomes-2026-09-10`.
Ownership: stage-gate decision route, shared action audit wrapper, focused tests,
and this evidence. No other session edits observed. No new permission or approval
scope, migration, provider connection or reminder change.

## Demonstrated errors and repair

The stage-gate route passed a fulfilled Supabase `{data,error}` result to the
shared audit wrapper before checking the error. A rejected decision could thus
receive a succeeded action-log row. It now checks errors and returned decision
inside the audited body; a missing row cannot be presented as a created decision.
Actual decision/approval identity and the agent HOLD-only restriction are retained.

The audit wrapper caught thrown audit-persistence failures as action failures.
It could append a misleading second attempt or replace the original effect error.
Action outcome is now determined separately; audit transport exceptions produce
an operator warning and preserve the original result/error. This does not make
the audit durable or surface missing audit records in the browser.

## Verification so far

Focused 3 suites / 57 tests pass. Harmless comments survive; restoring the old
audit exception boundary, accepting rejected writes and accepting empty write
responses fail the intended assertions. Logs were inspected; these are behavior
failures, not compile failures. Mocked route tests assert the decision projection,
one write, exact approval identity and one appropriate audit outcome.

An initial command used npm exec from the repository root; imports failed before
any tests executed. The corrected run used the application directory and config.

A live PostgREST probe used only our retained disposable target
`openplan-restore-target-3390964` at API22301. A new synthetic probe table grants
INSERT and conditionally SELECT. Hidden-row minimal INSERT succeeded and retained
one row; hidden-row INSERT with representation was rejected 42501 and retained
zero. A visible single-row control retained one. A two-row INSERT requesting a
singular response returned PGRST116 and retained zero. A trigger-suppressed insert
also returned PGRST116 with exactly zero rows and retained zero. No resets or existing-row
changes were used. `postgrest-probe.json` records statuses and independent counts.

This contradicts the older shared `write-outcome.ts` claim that INSERT PGRST116
proves a committed but unreadable row. PostgREST also documents PGRST116 for either
zero or multiple rows, not only zero:
[error reference](https://docs.postgrest.org/en/v16/references/errors.html).
The stage-gate path no longer uses that assumption. The shared helper and its
other callers remain a known follow-up; no blanket write-outcome correctness is
claimed by this bounded repair.

At the initial checkpoint, browser acceptance, complete QA and final CI were pending;
the final local evidence below supersedes that status. The mocked audit suite
cannot prove persistence during a database outage or resolve response-loss
ambiguity; atomic execution receipts and durable retry remain A1a work.

## Production browser acceptance

Build `3f1d010b9ed6` (0.49.2, Next16.3.4) was independently identified at port3275
in this isolated checkout. Six cases navigated from sign-in to Dashboard, Projects,
a specific project and Planner Agent at 1440×1000 and 390×844. Synthetic SSE
proposals used the current project context's offered gate; real single-use approvals
and decision endpoints ran. No provider/model was contacted or evaluated.

At each width, a targeted database trigger refused a decision: HTTP500, zero saved
decisions, one failed audit row. A separate targeted audit-insert refusal returned
HTTP201 with one saved decision and no audit row; the UI retained executed status,
and the server logged the expected audit-persistence warning. The normal control
returned HTTP201 with one decision and one succeeded audit row. All six made exactly
one effect request and retained exact approval IDs/hashes and distinct authorship.
Only the deliberately induced HTTP500 appeared in browser console errors.

The trigger fixtures are limited to six synthetic project IDs in our disposable
workspace. They are acceptance fixtures, not application migrations. Existing
planning data was not reset, deleted or altered. The rejection proves the corrected
route boundary; audit transport exceptions remain covered by unit injection, not
by this database refusal. This does not establish durable audit recovery.

Two earlier harness attempts did not reach the intended failure fixture. One
sampled a disabled Send while project context loaded; the other incorrectly used
a California fixture gate against the workspace's federal-aid template and was
correctly refused HTTP400. The harness now waits for the actual project and enabled
control, and derives its gate from current application context. Those attempts are
not accepted software failures or success evidence.

The Activity page repeated an unsupported completeness promise in its introduction,
operator card, notes and empty state. These now describe retained entries and the
possibility of missing audit rows. Existing page assertions were updated; harmless
comments survive and the old wording fails both page/copy checks. The jargon
baselines only decreased (operator45→43, workspace159→158); the guard was not relaxed.

Full local QA at `ce330b02` passed 1,232 files /13,473 tests, build and dependency
audit (33 files /299 tests skipped). Shuffled seed914093 at `3f1d010b` passed the
same counts. Final activity copy changes passed the focused page/copy suites and
production build at `ccae4cf7`; final-main CI still must cover the combined release.
The database outcome acceptance remains applicable because subsequent application
changes were Activity-page wording only.

## Final read-only acceptance and release boundary

The final `ccae4cf7ca19` build was independently identified in the browser and by
serving-directory/health checks at port3275. Fresh sessions navigated through
Projects to all six synthetic projects, read decisions through the authenticated
API and opened the retained HOLD on the project board. Navigation continued to
Planner Agent Activity; failed/succeeded rows matched their exact approval-hash
prefixes and absent rows remained absent. The new completeness disclosure was
visible at desktop and390px. Decision/audit counts stayed unchanged and both
browser console reviews were clean. Selected final captures were visually inspected.

The read-only harness initially encountered the duplicate Projects breadcrumb and
CSS-uppercase SUCCEEDED text. It now scopes the navigation rail and matches the
rendered case. Harmless badge outline survives; changing the displayed success
badge to Failed is rejected, then restored. No database writes occur in this check.

Final engineering acceptance is complete; the main commit's CI and upgrade checks
must succeed before v0.49.2 is tagged. No human sign-off is required. The following
work remains explicitly unfinished: shared write-outcome assumptions in other
routes, unstamped production identity detection, durable action/audit recovery,
optional-consent and scoped external-client/provider execution. The patch does not
claim to finish A1a or any scientific validation requirement.

Case-specific harness paths require local dependencies, an explicitly disposable
stack and separate private login/environment files. Those private files are not
included in this evidence. All retained UI data is synthetic.

## Published receipt

[v0.49.2](https://github.com/nfredmond/openplan/releases/tag/v0.49.2) was published
2026-09-10T08:43:43Z, neither draft nor prerelease. Annotated tag object
`c79486619639bf94dac75bd6e7dd1ce21baa2d23` peels to release commit
`d87a04d4271ee7e46e21d09e4fc63cd3fec6f5b3`; both remote refs were checked.
All jobs succeeded on that exact commit before tagging: CI34455454601, RLS34455454729,
and upgrade34455454518 from v0.49.1. Full QA, shuffled, worker, operations and
modeling jobs are included in the retained final-ci.json receipt.
