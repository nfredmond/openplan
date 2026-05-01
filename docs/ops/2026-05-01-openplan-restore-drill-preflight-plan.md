# OpenPlan Restore Drill Preflight Plan

**Date:** 2026-05-01
**Status:** Superseded by completed staging drill log `2026-05-01-openplan-restore-drill-staging-supabase.md`
**Audience:** Nathaniel Ford Redmond, Bartholomew Hale, and trusted OpenPlan operators
**Scope:** Buyer/internal-safe preparation for the first quarterly Supabase restore drill

This document is intentionally bounded. It prepared the release-to-sale restore-drill gate without creating, linking, restoring, or mutating any Supabase project. The later completed drill is recorded in `2026-05-01-openplan-restore-drill-staging-supabase.md`.

Related operator procedure: `openplan/docs/ops/2026-05-01-openplan-backup-restore-procedure.md`.

## Decision Boundary

This preflight may be shared internally or with a buyer as evidence that OpenPlan has a disciplined restore-drill gate. It must not include secrets, Supabase project refs, dashboard URLs, customer data, backup files, storage object names that reveal private customer work, or screenshots containing tokens.

## Safe To Do Now

These activities are safe before staging-target approval because they do not mutate cloud resources:

- Review the backup/restore procedure and this preflight plan.
- Confirm the release-to-sale checklist still shows the first staging restore drill as open.
- Collect the required-input list below in a private operator note outside the repo.
- Prepare a drill-log filename and slug, without creating a PASS log before the drill runs.
- Decide which non-production validation commands will be run after the restore.
- Run local docs-only validation such as `git diff --check`, reference grep, and `git status`.

Do not run Supabase cloud commands, link a project, create a staging project, import a dump, restore from PITR, alter storage buckets, touch secrets, or point the app at staging from this preflight.

## Requires Explicit Approval

The following steps are part of the actual staging restore drill and require a named staging Supabase target plus explicit written approval from Nathaniel before any cloud mutation:

- Creating or selecting the staging Supabase project.
- Linking the Supabase CLI to any project.
- Pulling production backups, PITR snapshots, or storage manifests through Supabase cloud tooling.
- Restoring a database dump or PITR point into staging.
- Replaying or copying storage objects into staging buckets.
- Running service-role inspection queries against restored staging data.
- Cleaning, truncating, deleting, or retiring a staging project after the drill.

Approval must name the staging target, source backup or restore point, operator, allowed mutation window, cleanup expectation, and evidence location.

## Required Inputs

Capture these in a private operator note, not in the repo:

- Approved staging Supabase target: organization, project name, project ref, region, and purpose.
- Source environment: production, staging, or local fixture.
- Restore source: backup id, dump path, or PITR timestamp.
- Restore scope: Postgres only, storage manifest only, selected storage buckets, or full staging reconstruction.
- Operator and approver names.
- Planned start and stop time with timezone.
- Validation commands and expected pass criteria.
- Data-sensitivity note: whether restored staging contains customer, demo, synthetic, or public-data-only records.
- Cleanup plan: retain staging for investigation, wipe restored data, or retire the project.
- Evidence destination: `docs/ops/YYYY-MM-DD-openplan-restore-drill-<slug>.md`.

Never commit the private note, backup files, env files, service-role keys, access tokens, dashboard URLs, or raw customer data.

## Dry-Run Checks

Run these before approval, using local/read-only checks only:

- Confirm the operator procedure exists: `openplan/docs/ops/2026-05-01-openplan-backup-restore-procedure.md`.
- Confirm the release-to-sale checklist still keeps the first restore drill unchecked.
- Confirm the intended drill-log filename will not collide with an existing `docs/ops/*restore-drill*` file.
- Confirm the runbook commands are copied into a private operator note with secrets redacted.
- Confirm the selected validation commands are non-destructive and target staging only.
- Confirm production project identifiers are kept in private notes and are not pasted into docs or chat.

Run these after approval but before the first cloud mutation:

- Compare the approved staging project ref against the production project ref and stop if they match.
- Confirm the active CLI context points at the approved staging target only.
- Confirm the backup id, dump timestamp, or PITR timestamp is the approved restore point.
- Confirm no customer-facing app or production Vercel environment points at the staging target.
- Confirm the operator can capture a sanitized command transcript without exposing tokens.
- Confirm the cleanup owner and retention window are named.

## Actual Drill Outline

The later approved drill should follow this shape:

1. Open the dated restore-drill log from the template in the backup/restore procedure.
2. Record operator, approver, source environment, target staging project, restore point, start time, and planned cleanup.
3. Capture pre-restore staging baseline evidence.
4. Restore the approved source into the approved staging target.
5. Run post-restore validation against staging only.
6. Capture sanitized evidence and any gaps found.
7. Execute the approved cleanup plan or record the approved retention period.
8. Commit only the sanitized drill log and any docs-only follow-up.

This preflight does not satisfy the release-to-sale restore-drill gate by itself.

## Objective Acceptance Criteria

Preflight acceptance:

- A dated preflight plan exists in `docs/ops/`.
- The plan separates safe-now preparation from approval-required cloud mutation.
- Required inputs, dry-run checks, cleanup notes, evidence capture, and stop conditions are documented.
- The release-to-sale checklist references this preflight beside the open restore-drill item.
- `docs/ops/README.md` exposes the preflight plan for discovery.
- Validation passes with docs-only changes.

Actual restore-drill acceptance:

- Written approval names a staging Supabase target before mutation.
- Restore uses only the approved target and approved source restore point.
- Staging validation records objective pass/fail outcomes for database access, RLS posture, expected workspace/membership presence, report metadata, storage manifest posture, and app health checks chosen for the drill.
- Cleanup or retention is completed as approved.
- A separate dated restore-drill log records the result as pass, fail, or partial.
- The release-to-sale checklist remains open until that drill log exists and passes review.

## Evidence To Capture

Capture sanitized evidence in the later drill log:

- Approval reference: approver, timestamp, and approved target name; omit secrets and raw project refs if buyer-facing.
- Source restore point: backup id or timestamp, redacted if needed.
- Command transcript summary: commands run, exit status, duration, and target environment.
- Validation results: query/check names, expected outcomes, actual outcomes, and failures.
- RLS/isolation posture: specific check name and pass/fail result, not private row dumps.
- Storage posture: bucket names and object-count/manifest status, without private object contents.
- Cleanup evidence: wipe, project retirement, or approved retention note.
- Follow-up tickets or procedure edits created because of the drill.

## Rollback And Cleanup Notes

Because the required drill target is staging, rollback should protect production by avoiding production changes entirely. If the staging restore fails:

- Stop further mutation and preserve the sanitized transcript.
- Do not retry against production.
- Either restore the prior staging baseline, wipe the restored staging database, or retire the staging project according to the approved cleanup plan.
- Revoke or rotate any temporary staging credentials created for the drill.
- Remove local backup files or transcripts according to the private retention note.
- Record the failure and next action in the drill log; do not mark the release-to-sale restore-drill item complete.

## Stop Conditions

Stop immediately if any condition is true:

- No written approval names the staging Supabase target.
- The active target is production or cannot be distinguished from production.
- The approved staging project ref matches the production project ref.
- A command asks to link, restore, delete, truncate, or overwrite a project not named in the approval.
- A secret, token, service-role key, env file, private dashboard URL, or customer data appears in a committable doc or chat transcript.
- Backup id, dump timestamp, PITR timestamp, or storage manifest does not match the approved restore point.
- Validation points at production, a customer-facing app, or an unknown environment.
- RLS/isolation validation fails after restore.
- Storage manifests or report artifacts show unexplained mismatch.
- Cleanup owner, retention window, or evidence destination is missing.

## Release-To-Sale Status

This preflight reduced operator ambiguity but did not itself complete the release-to-sale restore-drill gate. The gate was later closed by `2026-05-01-openplan-restore-drill-staging-supabase.md`.
