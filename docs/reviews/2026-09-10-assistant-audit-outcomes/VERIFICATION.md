# Assistant audit outcome repair — in progress

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
singular response returned PGRST116 and retained zero. No resets or existing-row
changes were used. `postgrest-probe.json` records statuses and independent counts.

This contradicts the older shared `write-outcome.ts` claim that INSERT PGRST116
proves a committed but unreadable row. PostgREST also documents PGRST116 for either
zero or multiple rows, not only zero:
[error reference](https://docs.postgrest.org/en/v16/references/errors.html).
The stage-gate path no longer uses that assumption. The shared helper and its
other callers remain a known follow-up; no blanket write-outcome correctness is
claimed by this bounded repair.

Browser acceptance, complete QA and final CI are pending. The mocked audit suite
cannot prove persistence during a database outage or resolve response-loss
ambiguity; atomic execution receipts and durable retry remain A1a work.
