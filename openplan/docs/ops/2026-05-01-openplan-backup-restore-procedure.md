# OpenPlan Backup And Restore Procedure

**Date:** 2026-05-01
**Status:** Operator procedure
**Audience:** Nathaniel and trusted OpenPlan operators
**Scope:** Supabase-backed managed-hosting posture for OpenPlan

This procedure is intentionally conservative. A restore can destroy recent valid customer work while repairing older damage. Do not restore production data without Nathaniel's explicit approval, a written restore point, and a post-restore validation plan.

## Durable State Inventory

OpenPlan durable state is split across these systems:

1. **Supabase Postgres** — workspace records, memberships, project data, evidence logs, billing ledger tables, usage events, report metadata, modeling metadata, public-data ingest metadata, and RLS policies.
2. **Supabase Storage** — uploaded or generated files in buckets such as `gtfs-uploads`, `network-packages`, and `report-artifacts`.
3. **Vercel environment variables** — production configuration and integration keys. These are not database backups and must be snapshotted separately.
4. **Vendor systems** — Stripe, Mapbox, GitHub, and model providers. Treat these as vendor-managed records, not OpenPlan restore targets.

## Backup Cadence

Baseline posture before paid customer launch:

- Confirm Supabase automatic backups are enabled for the linked project.
- For paid production hosting, prefer a Supabase tier with point-in-time recovery (PITR) enabled before customer data becomes material.
- Capture offline Vercel env snapshots after any production env change.
- Run a non-production restore drill quarterly and before any major paid rollout.

## Capture Vercel Environment Snapshot

Run from `openplan/openplan` when Vercel CLI is authenticated to the `natford` scope:

```bash
mkdir -p ../.operator-private/vercel-env-snapshots
vercel env pull ../.operator-private/vercel-env-snapshots/openplan-production-$(date +%Y%m%d-%H%M%S).env --environment=production --scope natford
chmod 600 ../.operator-private/vercel-env-snapshots/*.env
```

Rules:

- Never commit `.operator-private/` or env snapshots.
- Never paste secrets into chat, tickets, commit messages, or incident notes.
- Record only the snapshot path, timestamp, and operator in the incident/drill log.

## Capture Supabase Postgres Backup

Run only from an authenticated operator shell. Prefer staging for drills.

```bash
mkdir -p ../.operator-private/supabase-backups
supabase db dump --linked \
  --file ../.operator-private/supabase-backups/openplan-$(date +%Y%m%d-%H%M%S).sql
chmod 600 ../.operator-private/supabase-backups/*.sql
```

Before production restore work, capture the current broken state as forensic evidence even if an automatic backup exists.

## Capture Supabase Storage Manifest

Create a manifest first. Download full storage objects only when the incident requires file-level restoration or forensic capture.

```bash
mkdir -p ../.operator-private/storage-manifests
supabase storage ls gtfs-uploads --linked > ../.operator-private/storage-manifests/gtfs-uploads-$(date +%Y%m%d-%H%M%S).txt
supabase storage ls network-packages --linked > ../.operator-private/storage-manifests/network-packages-$(date +%Y%m%d-%H%M%S).txt
supabase storage ls report-artifacts --linked > ../.operator-private/storage-manifests/report-artifacts-$(date +%Y%m%d-%H%M%S).txt
chmod 600 ../.operator-private/storage-manifests/*.txt
```

If the CLI shape changes, use the Supabase dashboard export/download path and record the exact method in the drill or incident note.

## Restore Decision Gate

A production restore requires:

1. Incident severity set to `SEV-1` in the incident note.
2. Current-state capture complete: database dump, storage manifest, relevant Vercel logs, and failing request evidence.
3. Target restore point documented: backup id, timestamp, or PITR moment.
4. Known post-restore data gap documented: anything created after the target restore point that may need replay.
5. Nathaniel approval recorded in writing.

Do not proceed on verbal memory alone. This is the sharp knife drawer.

## Restore Execution Posture

Preferred order:

1. Restore into a staging Supabase project first.
2. Run validation queries and app smoke checks against staging.
3. If staging validates, schedule/announce production maintenance if customers are active.
4. Restore production from the selected backup or PITR point.
5. Re-run validation before reopening onboarding or customer workflows.

## Post-Restore Validation

Minimum validation:

```bash
pnpm qa:gate
pnpm ops:check-prod-health
```

Then verify, using service-role inspection only when authorized:

- Workspaces and memberships exist for expected accounts.
- RLS still blocks cross-workspace access.
- Billing ledger and subscription state match Stripe records closely enough to avoid double charge or wrongful lockout.
- Report artifact metadata points to existing storage objects.
- Recent invitations, exports, and usage events after the restore point are either replayed or explicitly written off.

## Drill Log Template

Create a dated drill note under `docs/ops/`:

```markdown
# OpenPlan Restore Drill — <short slug>

**Date:** YYYY-MM-DD
**Operator:** <name>
**Source environment:** production | staging | local
**Target environment:** staging | local
**Backup id / timestamp:** <value>
**Started:** HH:MM TZ
**Completed:** HH:MM TZ
**Result:** pass | fail | partial

## Steps Run
- <command or dashboard action, sanitized>

## Validation
- <checks and outcomes>

## Gaps Found
- <missing step, permission issue, slow restore, data mismatch>

## Follow-Up
- <owner and next action>
```

## Customer Communication Boundary

If a paid customer is affected, use plain language:

- what happened,
- what data/time window is affected,
- what Nat Ford is doing,
- what the customer should avoid doing until cleared,
- when the next update will arrive.

Do not claim an SLA, RPO, RTO, or guaranteed recovery window beyond the signed managed-hosting service schedule.
