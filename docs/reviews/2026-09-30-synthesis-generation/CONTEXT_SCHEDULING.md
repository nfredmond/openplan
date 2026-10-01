# Dependent context scheduling

September 30, 2026. This candidate follows main `eecdeadd`. The published and
installed release remains v0.65.0. The candidate adds an explicit context mode to
the existing local synthesis command. It creates no automatic grant, staff
interface, proposal import or public publication.

## Retained identity and fresh permission

The historical authority reader verifies original grant, request, context,
canonical plan header and seal bytes. It reconstructs the frozen continuation
header from retained request bindings. Expired or cancelled execution can still
recover saved output custody. This reader neither reconstructs original source
frames nor establishes current access. Its result exposes immutable scheduling
identity, without an inferred cancellation status.

A new schedule separately reconstructs every current source frame and requires
an active sealed plan and unexpired grant. It checks initial attempts through
ordered pages, including short pages, and verifies each original dynamic task's
bytes and binding. Its saved task list respects earlier attempts, the grant's
remaining allowance and explicit single-frame retry scope. The schedule does not
select replacement results or renew execution authority.

Every fresh worker claim and dispatch still performs the checks in
[retained context execution](CONTEXT_EXECUTION.md). A changed selection, missing
original predecessor or invalid continuation stops fresh work. Once saved, the
schedule reuses the same task directories and preserves its original task list.
An unobserved dispatch stops processing before any successor frame. A read,
resource or provider-output error retains the journals for diagnosis and recovery.

## Operator command and outcomes

From `openplan/`, use an existing context resource authorization:

```bash
npm run worker:synthesis-generation -- --authorization UUID --all-tasks --context
npm run worker:synthesis-generation -- --authorization UUID --task-index 0 --context
```

The commands share the same target, authorization and task directories. A single
observed task can recover before the complete saved schedule resumes. The
[runbook](../../../openplan/docs/ops/RUNBOOK.md) records configuration, private
journal custody, exit meanings and boundaries.

The CLI reports acknowledged outputs, unobserved dispatches, scheduled tasks not
processed and tasks outside its grant. Exit 0 establishes acknowledged output
custody for that schedule. It does not establish a valid final interpretation,
complete campaign synthesis, representative participation or staff approval.

## Evidence retained so far

The authority reader passes 41 focused cases. Its harmless mutation survives and
18 targeted faults fail. The scheduler's harmless mutation passes all 34 cases;
23 targeted faults fail. Combined faults test overlapping range, cursor and
identity checks without mistaking a downstream refusal for the intended guard.
The query mocks assert projections and delegate parent-history single-row reads.

The first test run exposed an extra parenthesis in the test fixture. The next
run exposed an inventory mock that intercepted parent-history reads without
supporting `maybeSingle`. Both fixture errors are corrected and their failed logs
remain retained. The plan-checksum probe also updates the grant and seal pointers
so they cannot mask a removed checksum check.

A real CLI journey, using PostgreSQL, PostgREST, Kong and a local synthetic model,
processes every context frame. It loses the first successful output acknowledgement,
recovers that original through the single-task CLI and resumes the full schedule.
After cancellation and staff revocation, the CLI redelivers the same saved outputs
without another provider call. A second case loses a successful dispatch
acknowledgement. Resuming returns exit 2, preserves the schedule and leaves exactly
one attempt, with no model call or successor claim. Both cases pass. TypeScript
and focused lint pass.

Native mutation controls pass. Disabling context selection fails before dispatch;
removing the unknown-dispatch stop changes the required partial result into a
refusal at the next worker. Sources are restored. The candidate still needs restored-source
related tests and final full QA, shuffled tests, isolated database and applicable
worker checks before landing. Final release CI must target the actual release
commit. The synthetic model provides deterministic structure, without evidence
of interpretation quality, billing, browser usability or physical power-loss
recovery. Staff proposal import and the full M9b and V1 requirements remain open.

[Retained proof](context-scheduling-proof.json) records candidate source hashes,
mutation results and private log hashes. The v0.66.0 worker run passes all
52 Python suites; full candidate QA, shuffle and isolated database checks remain
active.
