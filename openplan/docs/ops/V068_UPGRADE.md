# v0.68 upgrade and recovery

This guide describes the accumulated v0.68 development candidate. It does not
declare a release or authorize an update to an unidentified installation. Check
the final GitHub release and commit before deploying. The candidate contains
399 migrations through `20261016000027_run_project_workspace_foreign_keys.sql`,
including 26 additions since v0.67.0. Read the [changelog](../../../CHANGELOG.md)
for the complete capability and migration inventory.

## Prepare the installation

1. Record the current app commit, database target, worker versions and running
   job IDs. Use the [runbook](RUNBOOK.md) to identify the served app. A package
   version alone cannot distinguish the different v0.68 candidate builds.
2. Preserve and rehearse a recoverable backup using
   [backup and restore](BACKUP_AND_RESTORE.md). Include model source/output files,
   private command journals, worker configuration and stable installation
   identity as well as the database and Storage. The local archive drill does
   not cover external workers, custom database roles or scheduled SQL jobs.
3. Stop new model dispatch. Let active work reach a known, retained stopping
   point, then confirm that every model worker using this installation has
   stopped, including separately running containers. A stopped app server does
   not establish that. Preserve evidence of interrupted work.
4. Schedule a maintenance window. Migration 27 validates existing run/project
   workspace relationships and takes table locks. Invalid relationships stop
   the migration; they are not silently corrected or dropped.

Apply migrations before deploying the updated application and workers. For a
confirmed local Supabase CLI evaluation stack, run from `openplan/`:

```bash
npm ci
npm exec -- supabase migration up
```

Use the selected installation's documented migration procedure for other
deployments. Do not substitute `db reset`, select an unrelated database, or use
`--linked` without identifying the remote target. A successful migration command
does not establish that all app and worker processes use the updated checkout.

Before starting either general model worker, preserve its existing
`OPENPLAN_DEPLOYMENT_ID` and command-journal locations. The installation identity
and database URL are part of receipt recovery. A new installation needs its own
identity. If this installation has no configured identity, assign and retain
one before its first command journal is created. Changing an old journal's
target is not a recovery method. Follow the
[AequilibraE](../../../workers/aequilibrae_worker/DEPLOY.md) and
[ActivitySim](../../../workers/activitysim_worker/DEPLOY.md) deployment guides.
These worker updates do not enable normal managed-attempt dispatch.

## What changes for existing model work

Migration 18 retains an explicit historical enrollment for existing runs and
blocks unreviewed historical execution writes. It does not reconstruct missing
stage-start evidence. Previously retained outputs remain readable; their
scientific claim tiers do not change. New runs have separate enrollment.

Migration 22 limits automatic timeout to unstarted queued work. Running,
attempt-managed or previously started work cannot be failed solely because its
timestamps are old. Model-page loading and the scheduled model sweep still
invoke guarded reconciliation for eligible queued work. A page load is not
necessarily read-only, and a saved running status is not proof of a live worker.

Migration 23 adds exact-request abandonment decisions. Migration 24 lets a
workspace member read retained instrument evidence only through a visible run
in the same workspace. Neither migration authorizes model continuation or
promotes scientific results.

## Review an interrupted model

In Travel modeling, open the model and affected run. A workspace owner or
administrator can use **Review execution recovery** and **Review current
execution state**. Inspect the actual process, retained journals and source
files separately; the displayed database state cannot prove process termination.

If abandoning the run is appropriate, record the reason, acknowledge the stated
limits and use **Save abandonment decision**. The server checks the reviewed
state again. If it changed, review the current state before making another
decision. A confirmed decision preserves prior run, stage and attempt snapshots,
revokes further worker write authority and marks unfinished execution cancelled.
It does not stop an operating-system process, verify the reported evidence or
start a replacement model.

If the reply is lost, keep the original request and use **Retry saved decision**.
Use **Download decision copy** or **Download decision and receipt** to retain
the record outside browser storage. Restoring that JSON checks account/run scope
and saves the request locally; it sends nothing. An imported receipt still
needs server confirmation through explicit retry. Preserve unreadable bytes
before restoring a matching request. Do not clear browser storage or change
request IDs to get past an uncertain result.

Historical reconciliation for continuation and full stage resume remain
unfinished. Abandonment and receipt recovery are the available bounded actions.
The [recovery acceptance record](../../../docs/reviews/2026-10-09-recovery-mobile/VERIFICATION.md)
documents the tested interruption and narrow-layout cases.

## GTFS import failure and cleanup

Migrations 25 and 26 preserve ready versions, close failed or abandoned unfinished
attempts transactionally and retain private-object cleanup requests. Configure
the authenticated `/api/cron/reap-gtfs-ingests` schedule every 15 minutes as
described in [self hosting](../SELF_HOSTING.md#services-schedules-and-upgrades).
Use the protected `CRON_SECRET`; do not put credentials in a URL or public log.

A failed replacement leaves the prior ready feed available. A cleanup retry
removes the failed attempt's queued private object when Storage becomes
available. The endpoint's `scanned` and `reaped` counters count abandoned ingests,
not deleted cleanup objects. Successful HTTP delivery alone does not prove that
every queued object was removed; inspect the queue and corresponding Storage
state through the installation's private operational tools.

The import still runs inside its existing HTTP request. It is not a resumable
GTFS worker. A closed attempt cannot resume writes; another import uses a new
version. Keep the original source and the displayed failure details. The
[integration evidence](../../../docs/reviews/2026-10-09-recovery-integration/VERIFICATION.md)
records the ready-feed preservation and scheduled cleanup checks.

## Verify the updated installation

Confirm the served commit, migration completion and worker configuration before
accepting the update. Reopen existing project-linked model records and their
retained outputs. Check My Work's blocked-project read, the current transit feed
and its failed-attempt history. Exercise a disposable case for recovery rather
than assigning a synthetic decision to an agency project.

Retain the prior installation and backups until the changed workflows pass on
the intended deployment. Reverting app code alone does not undo migrations or
prove old-worker compatibility. The release's synthetic checks do not establish
complete agency commissioning, native mobile behavior, scientific acceptance
or observed practitioner outcomes.
