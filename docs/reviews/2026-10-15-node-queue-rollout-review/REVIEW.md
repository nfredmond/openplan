# PR 327 has no new source finding; its hosted prerequisite remains open

Reviewed October 15, 2026 UTC by the assigned GPT-6.1 Sol high review child.
Parent thread: `1401bb6a-70e4-42eb-a1f1-98045485f8cc`.

**Disposition:** No new P1 or P2 source defect found within this review's scope.
This is not a merge or deployment approval. The parent must complete fresh
database and Storage capture, apply additive migration 15, and confirm the
result before merging code that depends on it. The supplied continuation record
and PR body both record migration 15 as unapplied. I did not query production.

## Identity and ownership

- Assigned checkout: `/home/nathaniel/.t3/worktrees/openplan/t3-be4a2e1f`.
- Review branch: `t3/review-pr327-node-queue-rollout`.
- Initial clean commit: `05dd3e8da4a4572437f06e771b0a2477873e681f`.
- Clean fast-forward after fetching origin: `1b2fefe0f0e98f99700fc77e99146fe697b43ee7`.
- PR: [327](https://github.com/nfredmond/openplan/pull/327), open,
  `work/node-queue-heartbeats-20261014`.
- Reviewed head: `031e01f1ff9645fbd8c10935ab205baff6484307`. Live GitHub reads
  find no drift from the assigned head. The evidence file records the final read.
- PR source is read from Git objects. This branch remains based on main.
  I own only this review directory. No implementation or test file changes.

I read the assigned checkout's canonical `AGENTS.md` again after the
fast-forward, the current coordination and restart records, and the requested
product and operating authority. The direction check exits zero. It retains
registry/matrix age, release-version and intervening-change reminders. Those
reminders do not create another whole-product release gate for this change.

The V1 contract, sole roadmap queue and requirement ledger remain binding.
Nothing here reduces all-state/DC, California-depth, territory, tribal or
overlapping-authority scope, separate demand-model validation, or human control.
This bounded operation change sits within Stage A and M3, not a V1 acceptance claim.

## Source conclusions and exact pointers

All line references below refer to the reviewed head, not this main-based tree.

1. **Shutdown ownership remains with each worker.**
   `openplan/src/lib/ops/node-queue-observation.ts:17-61` wraps the work without
   installing process signal listeners. All eight files under
   `openplan/scripts/workers/` invoke it with their declared kind and notify it
   from existing SIGINT/SIGTERM handlers. `document-exports.ts:13-19` and
   `engagement-email.ts:11-23` retain default Node termination before asynchronous
   directory/journal startup installs those handlers. The startup test executes
   these actual bodies with imported infrastructure replaced. The existing
   hosted supervisor, `workers/hosted-node/supervise.mjs:19-60`, still allows
   20 seconds before SIGKILL and fails on an unexpected child exit, including
   zero. This PR does not make interrupted business jobs safe to replay.

2. **Diagnostic work has a separate lifecycle.**
   `node-queue-observation.ts:20-48` captures one UUID, build and service client;
   permits one client-side request at a time; and applies a three-second abort
   deadline. Lines 50-59 preserve the work result/error, clear the timer, cancel
   the pending request and attempt a higher-sequence stopped write. Client
   construction and diagnostic logging failures preserve the business path.
   The fixed warning omits raw provider errors and job payloads. The preparation
   entry validates options before observation begins at
   `synthesis-preparation.ts:5-7`. Other entries are not certified here as having
   a zero-diagnostic-HTTP boundary for every invalid invocation.

3. **SQL preserves instance order within the RPC trust boundary.**
   `openplan/supabase/migrations/20261017000015_node_queue_process_observations.sql:6-25`
   adds a deployment-global table, narrow fields, primary key and latest-row
   index. Lines 27-59 use invoker authority and a fixed `pg_catalog` search path.
   The upsert accepts increasing sequences, preserves the captured build and
   start time, refuses stopping-to-running transitions and makes stopped
   absorbing. Exact replay does not refresh server time. A committed stopped
   row fences a delayed running write even with a higher sequence. This does
   not guarantee a terminal row commits during an outage or abrupt kill.

4. **Ordinary roles receive no observation access.**
   Migration lines 20-23, 56-59 and 92-93 enable and force row-level security
   (RLS), revoke table/RPC access from PUBLIC, anon and authenticated, and grant
   the required access to service_role. Neither RPC is SECURITY DEFINER.
   No workspace, actor, job identifier or payload enters the table. Service
   credentials remain trusted. Their direct INSERT/UPDATE privileges bypass
   the RPC's ordering rules; the PR explicitly documents this boundary.

5. **The reader distinguishes unavailable data from missing observations.**
   Migration lines 61-90 return all eight kinds using one server timestamp and
   a two-minute inclusive freshness window. Mixed instances retain active
   counts even when the latest row is stopped. Future times remain unknown.
   `openplan/src/lib/ops/node-queue-observation-reader.ts:14-49` preserves
   PostgreSQL microseconds and rejects contradictory counts/states, incomplete
   kinds and extra fields. It retains process-only and unassessed-job labels.

6. **Deep health remains protected and describes read success.**
   `openplan/src/app/api/health/deep/route.ts:27-61,75-101` checks the configured
   bearer token before probes and retains independent caller/deadline-aware
   transports. Lines 118-142 return 503 for an unreadable observation, without
   a fabricated queues array. A valid census containing only stale, stopped
   or unobserved kinds can still produce HTTP 200. This reports a successful
   read, not seven healthy hosted queues. The SQL summary omits instance IDs
   and builds, so it cannot establish the current worker revision by itself.
   `openplan/scripts/ops/check-deep-health.mjs:6-7` allows 30 seconds for three
   serial eight-second probes. No monitor or health-token setting is activated.

## What the evidence establishes

[EVIDENCE.json](EVIDENCE.json) retains sanitized live PR/CI metadata, Git object
identities and digest comparisons. All nine indexed proof reports match their
recorded SHA-256 values. All 47 entries across the retained binding files match
the reviewed source objects, including the final 23-source binding set.
Digest equality establishes byte identity, not correct behavior.

GitHub reports 10 executable checks successful and one neutral Vercel Agent
review for this head. I inspect the following jobs and logs directly:

- [Dedicated observation controls](https://github.com/nfredmond/openplan/actions/runs/38665695143):
  source, reader, transport, route, checker and schema drivers each log four
  surviving positive cohorts. Their intended failure counts are 54, 28, 12,
  five, one and three. Each driver checks the expected failing test and message
  rather than accepting any nonzero exit. The additional actual preparation
  idle CLI step succeeds; its driver checks four positives and one wrong-target
  fault but does not print cohort counts.
- [Live RLS isolation](https://github.com/nfredmond/openplan/actions/runs/38665695110)
  and [full archive restore drill](https://github.com/nfredmond/openplan/actions/runs/38665695113):
  both apply candidate migration 15 in disposable CI stacks and report
  1,559 tests passed, with 125 skipped. Skipped cases remain unproved. The
  restore job invokes `--full-archive` and retains its custody artifact. I do
  not independently replay the archive or inspect every artifact record.

These three runs report head `031e01f` but checkout GitHub's synthetic merge
`a3cdbfd3069140763ed85aa72eb01f64a4fefdfb`. I fetch that object and compare
trees. Both trees equal `4921f96d4392e42ef41f3e6c6f68667488cb680c`.
This establishes source equivalence for those runs, not deployment equivalence.

The retained native SQL/HTTP reports remain separate evidence. Their checked
drivers use an owned retained 415-migration fixture, selected upgrade to 417,
then candidate 418. They exercise actual service/ordinary roles, exact replay,
mixed instances and an HTTP request observed waiting on a database lock before
the stopped transaction commits. Their harmless controls survive and the
recorded ordering/grant faults fail for named reasons. I inspect the drivers
and reports but do not rerun them or access their private cluster. The bounded
10,000-retired/256-active SQL probe is not business capacity evidence.

## The parent must complete this rollout sequence

The controlling order is in `AGENTS.md`, under "Live hosted installation",
and the current coordination record. It is stricter than the general
`HOSTED_OPERATIONS.md` wording that permits confirming a daily capture or
applying alongside a merge. Candidate `OPERATIONS.md:5-8` does not replace
the explicit pre-merge confirmation requirement.

1. Recheck the exact PR head, clean checks, intended installation and coordinator
   slot. Compare current applied history with the selected checkout. Do not let
   a broad migration command silently apply another pending candidate.
2. Capture a fresh protected database archive and Storage bytes for the intended
   installation. Retain verified hashes, readable archive index, object
   inventory and actual consistency interval. Record any writers that remain
   active. Daily capture presence alone does not satisfy this turn's fresh
   capture prerequisite or prove a consistent whole-installation recovery point.
3. Apply only the intended additive
   `20261017000015_node_queue_process_observations.sql`. Its reviewed SHA-256 is
   `40a554ab2d1c97791f3e2875ca5ff24350d400bd3e1ec618896bcdeeed097113`.
   Before dependent merge, confirm applied history, deployed function bodies,
   forced RLS and role grants against those bytes. Confirm the service reader
   returns all eight kinds with the process-only labels. A read can remain
   unobserved before worker delivery. No fabricated production observations are
   required to check the schema and read path.
4. Only then may the parent merge in its coordinated turn. Identify the web and
   application-worker deployments, confirm their commits or exact runtime-path
   equivalence, then inspect the route/read path and fresh per-kind observations.
   The public migration stamp describes build expectations, not applied history.
   A green deep-health response alone does not identify current worker builds.
   Keep GTFS off if it was off. Use existing authorized health access without
   silently enabling deferred settings or synthetic business work.
5. Retain the post-merge main CI and delivery evidence before the next production
   turn. A failed worker or missing observation requires investigation through
   the existing supervisor/log and job-custody records, not automatic job retry.

The parent owns all five steps. This child performs none of them.

## Restore boundaries and proposed integration

Migration 15 is additive: it creates a new table, index and invoker functions
without rewriting business tables. The prior main has no reads of these new
objects, so source inspection supports leaving the migration in place during
an app rollback. Actual rollback selection must still compare every intervening
schema and worker change. Do not reuse a dated rollback deployment blindly.

`openplan/docs/ops/HOSTED_RECOVERY.md`, `BACKUP_AND_RESTORE.md`, `RUNBOOK.md`,
`HOSTED_OPERATIONS.md`, `workers/hosted-backup/DEPLOY.md`, and the superseded
checkpoints in `docs/ops/HOSTED_LIVE_2026-10-11.md` distinguish archive inspection,
disposable restore and complete installation recovery. They preserve missing
replacement Auth/Storage operation, complete worker-journal replay, independent
key custody and cutover evidence. Current CI and selected-schema native tests
do not close those gaps or prove recovery of populated observation history.
Those limits do not create a new whole-installation gate for this bounded PR.

Other reviewed blind categories remain explicit: a blocked event loop, failed
job loop or wrong business configuration can coexist with a recent process
observation; a clean work return and a thrown error both attempt stopped; an
abrupt kill can skip it. HTTP abort does not prove a database transaction rolled
back. Fencing requires the terminal observation to commit. Old instances remain
retained without a demonstrated retention/capacity policy. The census covers the
seven declared hosted kinds plus standalone GTFS, not arbitrary future daemons.
The SDK socket controls stop before response headers and do not prove every
stalled-body case. No real-provider, throughput, independent-host, browser,
desktop/390px, practitioner, scientific or V1 acceptance is established here.

Proposed integration: retain this report as an independent dated record. The
parent can cherry-pick its documentation commit separately from PR 327, then
append the actual rollout evidence when its authorized turn completes. No
implementation fix is requested by this review. I run no suite, build, service,
database command, browser journey, hosted mutation or GitHub review mutation.
