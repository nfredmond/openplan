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

## Additional findings during QA

The deterministic follow-up prompt helper caught its own HTTP errors, so the
dispatcher could not report that stage. It now propagates only when called as
an action follow-up; ordinary standalone prompts retain their existing error
display. A refused-effect and failed-prompt UI test distinguish the outcomes.

The first full QA run found the copy ratchet increased `record` from 265 to 266.
The new success sentence was rewritten; the existing guard and baseline were
not relaxed. The historical first-run failure remains in local logs.

Synthetic browser fixtures were created through current workspace bootstrap,
RTP-cycle and report APIs in the explicitly retained disposable target
`openplan-restore-target-3390964` (API 22301), in a new workspace and account.
They do not alter the original OWP fixture. No AI provider is used for the
deterministic report generation/context recovery journey.

Release preparation initially missed the JSON capability-registry version while
updating the three Markdown authorities. The direction check caught the mismatch;
only the current-release marker was corrected, without re-dating reviews.
