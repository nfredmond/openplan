# OpenPlan Restore Drill Approval Packet

**Date:** 2026-05-01
**Status:** Approval packet only; staging restore drill not yet run
**Approver:** Nathaniel Ford Redmond
**Operator:** Bartholomew Hale or a named trusted OpenPlan operator
**Related preflight:** `2026-05-01-openplan-restore-drill-preflight-plan.md`
**Related procedure:** `openplan/docs/ops/2026-05-01-openplan-backup-restore-procedure.md`

## Decision Needed

Nathaniel approval is needed before the first quarterly restore drill may mutate any Supabase resource.

Approve one named staging Supabase target, one source restore point, one operator, one mutation window, and one cleanup expectation. Without that written approval, the release-to-sale restore-drill gate stays open and no cloud/data operation should be run.

## Recommended Staging Target Posture

Use a dedicated non-production Supabase project created or selected only for restore-drill validation.

Recommended posture:

- Project name clearly includes `staging` or `restore-drill`.
- Project ref is privately recorded and verified to be different from production before any command runs.
- Region matches production unless Nathaniel explicitly approves a region difference.
- No customer-facing Vercel app, public demo, production webhook, billing flow, outbound email path, or live customer workflow points at this project.
- Any restored data is treated as sensitive even when the target is staging.
- Staging credentials, dashboard URLs, backup ids, storage object names with customer context, and service-role keys stay out of the repo and chat.

## Non-Negotiable Safeguards

- Written approval must name the staging target, source restore point, operator, allowed mutation window, cleanup expectation, and evidence destination.
- The active Supabase CLI/dashboard target must be compared against production and the drill must stop if the refs match or cannot be distinguished.
- Production Supabase must not be linked, restored, truncated, deleted, or otherwise mutated.
- Vercel production env vars, deployments, domains, and customer-facing configuration must not be changed.
- Stripe, billing, email, customer, auth-session, and secret operations are out of scope.
- Service-role inspection against staging is allowed only if explicitly included in the approval and must produce summarized evidence, not row dumps.
- No env files, tokens, backup files, raw customer data, dashboard URLs, or private restore artifacts may be committed.
- The release-to-sale restore-drill checkbox remains unchecked until a separate dated drill log records the approved drill and result.

## Operator Checklist

Before approval:

- Confirm the preflight plan and backup/restore procedure are current.
- Prepare a private operator note with the proposed staging target, source restore point, validation commands, cleanup plan, and evidence destination.
- Confirm the intended drill-log filename is unique under `docs/ops/YYYY-MM-DD-openplan-restore-drill-<slug>.md`.
- Confirm no production identifiers, secrets, or customer data are present in committable docs.

After approval, before first cloud mutation:

- Re-read Nathaniel's approval phrase and confirm every required field is present.
- Verify the active target is the approved staging target and not production.
- Capture pre-restore staging baseline evidence.
- Confirm validation commands target staging only.
- Confirm cleanup owner and retention window.
- Stop immediately if any target, source, or scope does not match approval.

During and after the drill:

- Restore only the approved source into the approved staging target.
- Run only the approved validation checks.
- Capture sanitized command/result evidence.
- Execute the approved cleanup plan or record the approved retention period.
- Commit only a sanitized drill log and docs-only follow-up.

## Mutation Scope

Will be mutated, only after approval:

- Approved staging Supabase Postgres database.
- Approved staging Supabase Storage buckets or manifests, if storage restore is explicitly in scope.
- Temporary private operator files under an uncommitted private path, if needed for the drill.
- A sanitized `docs/ops/YYYY-MM-DD-openplan-restore-drill-<slug>.md` evidence log after the drill.

Will not be mutated:

- Production Supabase project, production database, production storage, or production auth state.
- Production Vercel project settings, env vars, domains, deployments, or secrets.
- Stripe, billing ledgers through live payment systems, email providers, customer records, or external vendor systems.
- Git history beyond the sanitized docs-only drill log and approved docs follow-up.

## Rollback And Cleanup Expectation

Because the target is staging, rollback means containing and removing the staging restore, not touching production.

The approval should choose one cleanup posture:

- wipe restored staging data after validation,
- restore the prior staging baseline,
- retire/delete the staging project,
- or retain staging for a named investigation window.

After cleanup, the operator should revoke or rotate temporary staging credentials if any were created, remove private local backup/transcript files according to the private retention note, and record cleanup evidence in the drill log.

## Evidence To Log After The Drill

The separate drill log should record sanitized evidence only:

- approver, operator, approval timestamp, approved staging target alias, and evidence location,
- source restore point or backup timestamp, redacted if needed,
- pre-restore staging baseline summary,
- steps run, command/dashboard action summaries, exit status, duration, and target environment,
- database validation results, including workspace/membership presence checks,
- RLS/isolation validation pass/fail result,
- report metadata and storage manifest validation result,
- app health checks selected for the drill,
- cleanup action, retention window, and owner,
- result: `pass`, `fail`, or `partial`,
- follow-up tickets or procedure edits created because of the drill.

## Approval Phrase

Nathaniel can approve by sending:

> I approve the first OpenPlan staging restore drill for staging target `<project name or private alias>`, source restore point `<backup id or timestamp>`, operator `<name>`, mutation window `<date/time/timezone>`, cleanup posture `<wipe | restore baseline | retire project | retain until date>`, and evidence log `docs/ops/YYYY-MM-DD-openplan-restore-drill-<slug>.md`. Production Supabase, Vercel production, billing, email, customer, auth-session, and secret operations remain out of scope.

This packet does not complete the release-to-sale restore-drill gate. The gate can close only after the approved staging drill runs, validation is logged, cleanup is recorded, and the separate drill log is reviewed.
