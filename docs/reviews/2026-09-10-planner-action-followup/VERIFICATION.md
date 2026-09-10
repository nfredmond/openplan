# Planner Agent action follow-up recovery — in progress

Continuation after published v0.49.0; A1a prerequisite for A0 provider choice.
This is a bounded client-dispatch repair, not completion of A1a or A0.

## Demonstrated defect

The existing dispatcher awaited the action effect, marked the action completed,
then refreshed context. A failed context read propagated into the caller's
ordinary execution catch, overwriting success with failure. Both quick links
and chat proposals used this pattern. A fake-HTTP probe of the original
`generate_report_artifact` dispatcher observed HTTP 200, completion callback,
then an ordinary exception. No real writes were made by that initial probe.
The first funding-opportunity probe did not reproduce because that action's
metadata specifies no context refresh; that boundary remains intentional.

## Implementation under verification

A typed follow-up error records which post-effect step failed. The action effect
and approval refusal remain outside this boundary. Both UI callers preserve the
successful request status and retain a warning. A context-only recovery control
reads the current records without repeating the effect or follow-up prompt.
Completion wording describes the request; it does not assert a launched job has
finished or that an audit record was independently inspected.

## Evidence and remaining work

- Focused regression run: 34 tests across the existing dispatcher and
  AppCopilot suites. New tests exercise all five follow-up callback failures,
  a true effect refusal, both UI callers, repeated context unavailability and
  successful context recovery with one effect call. Cancellation text inside a
  failed context read must not return an already executed proposal to pending.
- These tests mock HTTP. They cannot establish database persistence, endpoint
  idempotency, real navigation or browser usability. Browser acceptance, full QA and CI remain outstanding; this is unreleased work.
- Exact approvals, route-local authorization, audit persistence, server-side
  idempotency and durable assignment gaps are not repaired by this client change.
- Worktree: `~/.local/state/openplan/planner-action-followup-recovery-2026-09-10`.
  Own files: shared action dispatcher, AppCopilot, their focused tests and this
  evidence directory. Base main `b16bf2ea`; no PR and no human release gate.

- Seven mutation runs: harmless comment survives; six targeted failures detected
  (erased boundary, misclassified effect, either caller loses success, swallowed
  prompt failure, and recovery skips its read). Failure logs inspected separately.
