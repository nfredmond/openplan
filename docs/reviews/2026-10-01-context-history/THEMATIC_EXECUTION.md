# Native thematic execution and original-response custody

October 2, 2026. This internal checkpoint extends native thematic staging with
resource authorization and single-task execution. It does not release a visible
workflow or complete M9b. The full v1 contract remains unchanged.

## Execution and recovery

Migration `20261015000009_engagement_synthesis_thematic_execution.sql` adds one
private immutable task-input table and thematic-specific native commands. It
reuses existing grants, attempts, dispatches, selections and original captures.
A new grant includes evidence-frame tasks and the final proposal task. Only the
new request's original staff author can authorize resources or change selections.
Service commands cannot create those staff approvals.

Each claim retains the exact dynamic task and predecessor selection, attempt,
capture and result hashes. Native claim, dispatch and status commands check the
complete selected predecessor chain. A changed earlier selection stops fresh
execution even when the immediate predecessor is unchanged. Cancellation,
requester membership loss, provider revocation and expiry stop new calls. Exact
receipt recovery does not renew dispatch permission or choose a new retry.

The worker reconstructs sealed original inputs before execution. It compares
retained frame bytes, task references and the separate final reference, then
rechecks scope. It replays selected original captures through the frozen thematic
continuation before preparing the next task. Database projections include the
fields used for these comparisons. Native checks separately fence concurrent
selection and authority changes at dispatch.

The shared provider adapter selects the frozen frame or proposal recipe and
preserves original response bytes. The private journal records thematic mode
before a claim and refuses journals from another execution mode. An observed
response can be delivered after cancellation or requester revocation without a
second provider call. An unknown dispatch remains unobserved until an explicit
staff-authorized retry. Existing segment and context recovery remain separate.

The CLI accepts `--authorization UUID --task-index INTEGER --thematic` through
its existing worker launcher. It explicitly refuses `--all-tasks --thematic`;
a durable thematic scheduler remains unfinished. Apply the additive migration
before using the internal commands. Installation in this checkpoint is confined
to the owned isolated restore-target stack.

## Evidence

- Original-input and job-reader suites pass 89 tests after the isolated final
  reference case. Together with the unchanged projection guard, 95 checks pass. They reconstruct actual
  synthetic original histories with mocked database transport. Tests assert
  projections, frame and final-reference identity, current scope, selected
  receipts, resource ceilings, exact task bytes and original capture replay.
- Shared provider API, thematic worker and existing context worker suites pass
  71 tests. They use local HTTP provider responses and private filesystem journals.
- Installed native thematic and context execution suites pass 77 tests. A separate
  segment execution and live schema regression run passes 63, for 140 total. Thematic
  probes include a harmless comment change and targeted faults for grants,
  retries, original inputs, predecessor ancestry, role boundaries and recovery.
- Authenticated HTTP execution passes in 173.59 seconds including runner overhead.
  PostgreSQL, PostgREST and the actual local CLI process one synthetic original
  contribution through thematic frames and the final proposal. A proxy drops
  the final retention acknowledgement after commit. A fresh invocation delivers
  the same original capture after cancellation and membership revocation, without
  another provider call. Independent replay yields `machine_unreviewed`.
- Schema checks pass 34 tests. A harmless migration comment remains green;
  an unread column and removed RLS declaration fail their intended checks.
  The owned catalog has 277 application tables, all with RLS, and 14 views.
- TypeScript passes after correcting nullable test-only capture access.
- Application mutation probes detect 93 targeted faults after isolating the
  final-reference comparison. Each mutation group retains a passing harmless
  control. Shared worker probes cover mode separation, claim/dispatch/status
  routing, pinned predecessor arguments and refusal before a provider call.
- The live HTTP harmless control passes in 173.50 seconds. Disabling thematic
  late-response recovery fails the intended exit-status assertion in 173.86
  seconds. Removing the unsupported-scheduler refusal makes five database calls
  where zero are expected, failing in 150.11 seconds. All durations here include
  runner overhead. The mutation sources are restored.
- [Fault records](thematic-execution-mutations.json) retain initial survivors,
  diagnostic mismatches, corrected probes and source hashes.
- Final full QA passes 17,099 application tests with 1,429 explicit skips,
  382 connector tests with four skips, lint, configured dead-code checks,
  dependency audit with zero findings, and webpack build including TypeScript.
  The configured dead-code check reports unused exports; success does not mean
  it found none. Ordinary QA skips live RLS. The 140 separate installed native
  checks above cover this increment, not the entire project isolation campaign.
- Live CLI recovery also passes after the explicit-query correction in 299.71
  seconds while full QA runs alongside it. That measured shared-host load nearly
  consumes the former 300-second integration-test allowance. This extended test
  now allows 600 seconds; worker, provider and authorization deadlines are
  unchanged. The final isolated run passes in 173.74 seconds; changed-test lint
  also passes.
- Product direction check passes with existing age/version reminders. No review
  date is changed to suppress them. Main remains `8cb534f5`; correction PR 112
  remains owned and open. This checkpoint is an owned-branch backup, not main
  integration or a new release. No UI, external model or practitioner acceptance
  is claimed.

## Errors retained in the record

The first job-reader run failed 48 cases because the transport fixture omitted
`maybeSingle`. The fixture now implements that method and projects requested
columns. Initial TypeScript errors also identified missing fixture controls and
nullable test access; those were corrected without relaxing production checks.

The expanded native mutation run initially reported one diagnostic mismatch.
Counting frames instead of all tasks correctly refused a valid final-proposal
grant, but the fixture expected an inner error hidden by native error handling.
The fixture now labels the valid authorization boundary explicitly. The corrected
focused probe and full installed suite pass. Initial logs remain preserved.

One application mutation initially survived because the final-reference test
changed both text and byte length. The byte-length guard masked the removed text
comparison. A same-length replacement now isolates and detects the text fault;
the original survivor remains recorded.

Initial full QA passes 17,098 tests and fails one projection-coverage guard.
The new generic read helpers increase unresolved projections to 251, beyond the
existing strict limit of 250. Both new readers now expose explicit table and
column selections. The guard and its limit are unchanged. Ninety-five focused
checks pass after the change. Harmless control, two nonexistent-column faults,
and four repeated read-error/abort probes verify the revised query boundary.

The live late-response mutation failed at its intended CLI exit-status assertion,
returning 2 instead of 0. Its log matcher initially reported an unexpected outcome
because Vitest truncated the source excerpt before the searched field name.
Direct file, line and assertion inspection confirms the intended failure. The
original classification and the subsequent diagnostic review remain recorded.

## Limits and next work

Native SQL probes establish structural custody, current scope and resource
fencing. They do not prove that arbitrary service-supplied tasks describe the
correct evidence. Application replay checks that evidence separately. Mocked
transport tests cannot establish native RLS or concurrent database behavior;
the live tests cover those different boundaries on an isolated stack.

The synthetic provider does not establish model quality, billing, translation
accuracy, representative engagement or practitioner acceptance. The native HTTP
case has one original contribution; it does not establish large-campaign speed
or recovery. Input preparation still collects original evidence in memory. The
final proposal task can exceed its explicit byte limit and remains incomplete
in that case. No clipping or uncertainty removal is permitted.

Thematic scheduling, retained derived proposals, current-staff proposal history,
explicit staff import and connected desktop/390px journeys remain unfinished.
Original provider captures are retained now; that does not establish the derived
proposal workflow. Wrong-mode CLI invocations can leave a prepared journal that
requires a documented self-service recovery path. Do not overwrite that journal
or infer fresh authorization. Main integration, combined migration accounting,
branch CI and release remain separate from this owned-branch checkpoint.
