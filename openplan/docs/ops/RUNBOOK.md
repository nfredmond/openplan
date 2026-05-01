# OpenPlan Ops Runbook

**Last updated:** 2026-05-01
**Audience:** Nathaniel and trusted operators preparing OpenPlan for first external paid access.

This runbook favors fast triage, data safety, and clear customer communication. Do not run destructive database commands during an incident unless there is a written restore plan and Nathaniel explicitly approves.

## Signals

Use these first because they do not require customer credentials or privileged database writes:

```bash
curl -i https://openplan-natford.vercel.app/api/health
vercel ls --format json --scope natford
vercel inspect <deployment-url> --scope natford
vercel logs --environment production --since 1h --scope natford
pnpm supabase status --linked
pnpm supabase db advisors --linked --type security --level info -o json
```

`GET /api/health` only proves the deployed Next.js route can execute. It does not check Supabase, Stripe, Mapbox, Anthropic, report storage, or billing meters.

## Scheduled Health Check

The repo has a no-vendor production health workflow:

```bash
gh workflow run production-health.yml --ref main
gh run list --workflow production-health.yml --limit 5
gh run view <run-id> --log-failed
```

It runs every 15 minutes from `.github/workflows/production-health.yml` and calls:

```bash
cd openplan
pnpm ops:check-prod-health
```

The workflow validates `GET` and `HEAD` on `/api/health`. It intentionally fails if the shallow route starts claiming dependency readiness for database or billing, because that endpoint is only the public uptime probe.

GitHub scheduled workflows can be delayed or dropped during platform load. Treat this as the first no-spend alarm, not a formal uptime SLA. If the workflow fails, capture the run URL and continue with the app-down path below.

## First Five Minutes

1. Identify the affected surface: public site, sign-in, workspace pages, map, reports/PDF, billing, invites, or model runs.
2. Capture one failing request id when possible: response header `x-request-id` or Vercel `x-vercel-id`.
3. Check `/api/health`.
4. Check latest Vercel production deployment status.
5. Check Vercel logs for `level:"error"` and the route name.
6. Decide severity:
   - `SEV-1`: app down, cross-tenant data exposure, auth bypass, destructive data loss, billing double-charge risk.
   - `SEV-2`: authenticated product surface broken for one customer workflow.
   - `SEV-3`: degraded non-critical workflow, copy, slow background task, analytics gap.
7. If `SEV-1`, pause new customer onboarding and do not invite new users until resolved.

## App Down Or Health Failing

Symptoms:

- `/api/health` is non-200.
- Vercel deployment is failed or stuck building.
- Root page returns 5xx.

Actions:

1. Inspect latest deployment:

```bash
vercel ls --format json --scope natford
vercel inspect <deployment-url> --scope natford
```

2. If latest deployment failed, inspect build logs in Vercel. Reproduce locally:

```bash
pnpm qa:gate
```

3. If the previous deployment was known good, prefer Vercel rollback from the dashboard or CLI over hot-editing code.
4. Document the failed deployment URL, commit SHA, and failing route in the incident note.

Do not change Supabase schema while debugging an app-only outage.

## Supabase Degraded Or Auth Broken

Symptoms:

- Sign-in loops or workspace pages show membership required for known users.
- API logs show Supabase fetch errors, JWT errors, or connection failures.
- `/api/health` is OK but authenticated routes fail.

Actions:

1. Check Supabase project status in the Supabase dashboard.
2. Check linked project status:

```bash
pnpm supabase status --linked
```

3. Validate no new migration is pending unexpectedly:

```bash
pnpm supabase migration list --linked
```

4. If RLS is suspected, do not disable RLS. Reproduce locally against the specific route test or add a narrow failing test.
5. For workspace isolation concerns, rerun the live local harness:

```bash
OPENPLAN_RLS_LIVE_TEST=1 pnpm test src/test/rls-isolation.test.ts
```

## Billing Checkout Or Webhook Failure

Symptoms:

- Customer cannot reach checkout.
- Stripe webhook returns non-2xx.
- Subscription status is stale.
- `billing_webhook_receipts` contains no new receipt for a known Stripe event.

Actions:

1. Check route logs:

```bash
vercel logs --environment production --since 2h --query billing --scope natford
```

2. Run the service-only readiness check only with the configured secret. Do not paste secrets into chat or docs.
3. Inspect Stripe event delivery in Stripe dashboard.
4. Re-send a Stripe webhook event only after confirming the handler is idempotent for that event id.
5. If identity review appears, do not auto-attach a Stripe customer to a workspace without Nathaniel approval.

## Usage Flush Failure

Symptoms:

- Usage events remain unreported after a closed billing period.
- Stripe meter event API rejects a group.
- `/api/billing/usage/flush` returns partial failures.

Actions:

1. Run dry-run first with the service secret:

```bash
curl -sS -X POST https://openplan-natford.vercel.app/api/billing/usage/flush \
  -H "content-type: application/json" \
  -H "x-openplan-billing-usage-flush-secret: $OPENPLAN_BILLING_USAGE_FLUSH_SECRET" \
  -d '{"dryRun":true}'
```

2. Confirm `OPENPLAN_STRIPE_METER_EVENT_NAME_RUNS` is configured in Vercel Production.
3. If live mode fails after some groups report, do not manually mark rows as reported. Fix the failed group cause and rerun; the route skips already reported rows.

## Quota Lockout

Symptoms:

- Paid customer receives unexpected `402` or `429`.
- Model run launch, comparison snapshot, report generation, or network-package ingest is blocked.

Actions:

1. Confirm workspace subscription state from the billing page or service-role inspection.
2. Check recent `usage_events` for the workspace and bucket.
3. If the customer is blocked during an active demo or support window, Nathaniel decides whether to raise quota, change plan state, or keep strict enforcement.
4. Do not bypass quota gates in code for one customer.

## CSP Violations

Symptoms:

- Browser console shows CSP blocking.
- Logs contain `event:"csp_violation"`.
- Mapbox tiles, Supabase calls, or report assets stop loading after a deployment.

Actions:

1. Query recent violation logs:

```bash
vercel logs --environment production --since 2h --query csp_violation --json --scope natford
```

2. Read `effectiveDirective`, `blockedUri`, and `documentUri`.
3. If the blocked origin is expected product functionality, add the narrowest directive allowance and write a regression test against `next.config.ts`.
4. If the blocked origin is unexpected, do not allow it until the source is understood.

## PDF Generation Failure

Symptoms:

- `/api/reports/[reportId]/generate` fails for `format:"pdf"`.
- Report artifacts do not appear.
- Vercel logs mention Chromium, timeout, memory, or storage upload errors.

Actions:

1. Reproduce HTML generation first if possible.
2. Check function duration and memory in Vercel logs.
3. Confirm `report-artifacts` storage access remains configured.
4. If PDF rendering is the only failed piece, communicate that HTML export remains available while PDF is repaired.

## Mapbox Or Map Backdrop Failure

Symptoms:

- Cartographic map is blank.
- Tiles fail to load.
- Layer routes return data but no visual layer appears.

Actions:

1. Check browser network for Mapbox status codes.
2. Confirm `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` exists in the deployed environment.
3. Query the relevant map feature route directly.
4. If only one layer fails, run the matching route and helper tests.

## Backup And Restore

OpenPlan's durable state lives in Supabase Postgres and Supabase Storage. Everything else (Vercel deployments, Stripe, Mapbox, Anthropic, GitHub) is recoverable from upstream sources or rebuilt from `main`. Detailed operator commands live in `docs/ops/2026-05-01-openplan-backup-restore-procedure.md`. This section covers triage and decision posture during an incident.

What is backed up:

- Supabase Postgres: all workspace tables, RLS policies, billing ledger, evidence backbone, modeling artifacts metadata, GTFS/Census/LODES public data, auth users and memberships.
- Supabase Storage buckets: `gtfs-uploads`, `network-packages`, `report-artifacts`.
- Vercel project environment variables: snapshotted offline via `vercel env pull` on a defined cadence; not part of Supabase backup.

What is not backed up by OpenPlan:

- Vercel build/deployment artifacts. Rebuild from `main`.
- Stripe records. Vendor-managed.
- Mapbox account state. Vendor-managed.
- GitHub repository. Origin of truth for code; GitHub-managed.
- Customer-supplied originals (drone imagery, source GIS, internal documents) once handed off and removed from OpenPlan storage. Client retention duty per the managed-hosting service schedule.

Recovery point and time posture:

- Baseline Supabase tier: ~24h RPO from automatic daily backups. RTO is best effort during business support hours and depends on the size of the dataset.
- Paid Supabase tier with PITR enabled: up to 7-day point-in-time recovery. RTO measured in hours during business support hours.
- Per-engagement RPO/RTO commitments belong in the managed-hosting service schedule (`docs/sales/2026-05-01-openplan-managed-hosting-service-schedule.md`, "Backup And Restore Posture"), not in this runbook. If a buyer needs a stricter target, attach an enhanced support addendum before signature.

When to consider a restore:

1. Confirmed destructive data loss (dropped table, mass row deletion, encrypted/corrupted column) that cannot be reproduced from logs or upstream sources.
2. Cross-tenant exposure that requires reverting to a known-clean snapshot.
3. Migration failure that mutated production data in a way the migration cannot itself reverse.

Do not restore for:

- Single-row mistakes a customer can fix in-app.
- Auth/billing confusion that has not lost data.
- Performance issues.

Pre-restore checklist:

1. Treat the incident as `SEV-1` and pause new customer onboarding.
2. Capture the current state before restoring: a fresh `supabase db dump` and storage manifest, even if it is the broken state. Loss of forensic evidence is its own incident.
3. Identify the target restore point: timestamp, backup id, or PITR moment.
4. Identify what data created after the restore point must be recovered separately (recent invitations, recent reports, recent usage events). Plan to replay these from logs if possible.
5. Confirm with Nathaniel before proceeding. A restore is a written decision, not a runtime convenience.

Restore-drill cadence:

- A non-production restore drill is run quarterly into a staging Supabase project.
- Each drill is logged under `docs/ops/` with the dated filename pattern `YYYY-MM-DD-openplan-restore-drill-<slug>.md`. The log records: drill date, source backup id, target environment, time-to-restore, post-restore validation results, and any failure modes observed.
- A drill that fails or reveals a missing operator step blocks the next external release until the gap is closed in the procedure doc.

For exact command sequences (Supabase CLI, storage download, env-var capture, restore validation queries) see `docs/ops/2026-05-01-openplan-backup-restore-procedure.md`.

## Customer Data Exposure Concern

Symptoms:

- A user reports seeing another workspace's data.
- A route returns data for a workspace the user does not belong to.
- Logs indicate a membership or RLS anomaly.

Actions:

1. Treat as `SEV-1`.
2. Stop inviting external users until triage is complete.
3. Preserve logs and request ids. Do not delete evidence.
4. Identify exact route, user id, workspace id, and resource id.
5. Add a failing test that reproduces the boundary before patching.
6. Verify RLS locally with:

```bash
OPENPLAN_RLS_LIVE_TEST=1 pnpm test src/test/rls-isolation.test.ts
```

7. Patch, run `pnpm qa:gate`, deploy, and document the incident.

## Post-Incident Closeout

Every incident gets a short note in `docs/ops/` with:

- start/end time,
- affected customer/workspace if any,
- route or subsystem,
- root cause,
- commands run,
- data mutation summary,
- tests added,
- prevention follow-up.

Do not include secrets, raw customer PII, auth tokens, cookies, or private Stripe payloads in the note.
