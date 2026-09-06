# OpenPlan Ops Runbook

> **DATED RECORD — date not in filename.** This describes what was true on the day it was written.
> It is kept because it records *why* decisions were made, which nothing else captures.
> **Do not treat any factual claim here as current** — verify against the code, the
> database, or `CHANGELOG.md` before acting on it. A stale doc that reads as current
> costs more than a missing one: on 2026-07-30 a roadmap in this folder listed two
> "remaining" items that had both already shipped, and nearly cost a full rebuild of a
> feature that already exists.


**Last updated:** 2026-07-27
**Audience:** whoever operates an OpenPlan deployment (self-hosted on Vercel + Supabase or any
compatible stack)

This runbook favors fast triage, data safety, and clear communication with your deployment's
users. Do not run destructive database commands during an incident unless there is a written
restore plan and the deployment owner explicitly approves. Commands below assume your own Vercel
scope and deployment URL — OpenPlan has no canonical hosted instance, so substitute your own
(`$OPENPLAN_ORIGIN` here means your deployment's base URL).

## Signals

Use these first because they do not require user credentials or privileged database writes:

```bash
curl -i "$OPENPLAN_ORIGIN/api/health"
vercel ls --format json
vercel inspect <deployment-url>
vercel logs --environment production --since 1h
npm exec -- supabase status --linked
npm exec -- supabase db advisors --linked --type security --level info -o json
```

`GET /api/health` only proves the deployed Next.js route can execute. It does not check Supabase,
Mapbox, Anthropic, or report storage.

## Scheduled Health Check

The repo has a no-vendor production health workflow (`.github/workflows/production-health.yml`)
that calls `npm run ops:check-prod-health` against the origin the repository operator configures.
It validates `GET` and `HEAD` on `/api/health` and intentionally fails if the shallow route starts
claiming dependency readiness it cannot actually verify.

```bash
gh workflow run production-health.yml --ref main
gh run list --workflow production-health.yml --limit 5
gh run view <run-id> --log-failed
```

GitHub scheduled workflows can be delayed or dropped during platform load. Treat this as the
first no-spend alarm, not a formal uptime SLA. If the workflow fails, capture the run URL and
continue with the app-down path below.

## First Five Minutes

1. Identify the affected surface: public site, sign-in, workspace pages, map, reports/PDF,
   invites, or model runs.
2. Capture one failing request id when possible: response header `x-request-id` or Vercel
   `x-vercel-id`.
3. Check `/api/health`.
4. Check latest Vercel production deployment status.
5. Check Vercel logs for `level:"error"` and the route name.
6. Decide severity:
   - `SEV-1`: app down, cross-tenant data exposure, auth bypass, destructive data loss.
   - `SEV-2`: authenticated product surface broken for a workflow users rely on.
   - `SEV-3`: degraded non-critical workflow, copy, slow background task, analytics gap.
7. If `SEV-1`, tell your deployment's users and avoid inviting new ones until resolved.

## App Down Or Health Failing

Symptoms:

- `/api/health` is non-200.
- Vercel deployment is failed or stuck building.
- Root page returns 5xx.

Actions:

1. Inspect the latest deployment (`vercel ls`, `vercel inspect <deployment-url>`).
2. If the latest deployment failed, inspect build logs in Vercel. Reproduce locally:

```bash
npm run qa:gate
```

3. If the previous deployment was known good, prefer Vercel rollback from the dashboard or CLI
   over hot-editing code.
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
npm exec -- supabase status --linked
```

3. Validate no new migration is pending unexpectedly:

```bash
npm exec -- supabase migration list --linked
```

4. If RLS is suspected, do not disable RLS. Reproduce locally against the specific route test or
   add a narrow failing test.
5. For workspace isolation concerns, rerun the live local harness:

```bash
OPENPLAN_RLS_LIVE_TEST=1 npm test -- src/test/rls-isolation.test.ts
```

## CSP Violations

Symptoms:

- Browser console shows CSP blocking.
- Logs contain `event:"csp_violation"`.
- Mapbox tiles, Supabase calls, or report assets stop loading after a deployment.

Actions:

1. Query recent violation logs:

```bash
vercel logs --environment production --since 2h --query csp_violation --json
```

2. Read `effectiveDirective`, `blockedUri`, and `documentUri`.
3. If the blocked origin is expected product functionality, add the narrowest directive allowance
   and write a regression test against `next.config.ts`.
4. If the blocked origin is unexpected, do not allow it until the source is understood.

## PDF Generation Failure

Symptoms:

- `/api/reports/[reportId]/generate` fails for `format:"pdf"`.
- Report artifacts do not appear.
- Logs mention Chromium, timeout, memory, or storage upload errors.

Actions:

1. Reproduce HTML generation first if possible.
2. Check function duration and memory in Vercel logs.
3. Confirm `report-artifacts` storage access remains configured.
4. On a non-serverless host, confirm `CHROME_EXECUTABLE_PATH` points at a real Chrome; without it
   the pipeline falls back to the built-in typesetting tier (disclosed in the PDF itself).
5. If PDF rendering is the only failed piece, tell users HTML export remains available while PDF
   is repaired.

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

OpenPlan's durable state lives in Supabase Postgres and Supabase Storage. Application code is
rebuilt from `main`; operator-owned configuration is protected separately. Detailed free,
self-hosted commands live in `docs/ops/BACKUP_AND_RESTORE.md`. This section covers triage and
decision posture during an incident.

Durable state surfaces (full inventory in the procedure doc):

- Supabase Postgres: workspace, membership, project, evidence, report-metadata,
  modeling-metadata, public-data, and policy state.
- Supabase Storage metadata plus every object byte, without assuming a fixed bucket list.
- Deployment configuration and secrets, snapshotted offline; not part of the database backup.

Recovery objective posture:

- No RPO/RTO is promised by OpenPlan. Your recovery posture is whatever your backup cadence and
  drill discipline actually support; never
  promise users a recovery window you have not drilled.

When to consider a restore:

1. Confirmed destructive data loss (dropped table, mass row deletion, encrypted/corrupted
   column) that cannot be reproduced from logs or upstream sources.
2. Cross-tenant exposure that requires reverting to a known-clean snapshot.
3. Migration failure that mutated production data in a way the migration cannot itself reverse.

Do not restore for:

- Single-row mistakes a user can fix in-app.
- Auth confusion that has not lost data.
- Performance issues.

Pre-restore checklist:

1. Treat the incident as `SEV-1` and pause new sign-ups/invitations.
2. Capture the current state before restoring: a fresh database dump and storage-byte archive,
   even if it is the broken state. Loss of forensic evidence is its own incident.
3. Identify the target restore point and verify its recorded hashes.
4. Identify what data created after the restore point must be recovered separately (recent
   invitations, recent reports). Plan to replay these from logs if possible.
5. Confirm with the deployment owner before proceeding. A restore is a written decision, not a
   runtime convenience.

Restore-drill cadence:

- Run `npm run ops:restore-drill` quarterly; it uses disposable isolated local projects.
- Log each drill with the dated filename pattern `YYYY-MM-DD-openplan-restore-drill-<slug>.md`:
  drill date, source backup id, target environment, time-to-restore, post-restore validation
  results, and any failure modes observed.
- A drill that fails or reveals a missing operator step blocks the next release of your
  deployment until the gap is closed in the procedure doc.

## Workspace Data Exposure Concern

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
OPENPLAN_RLS_LIVE_TEST=1 npm test -- src/test/rls-isolation.test.ts
```

7. Patch, run `npm run qa:gate`, deploy, and document the incident.

## Post-Incident Closeout

Every incident gets a short note in `docs/ops/` with:

- start/end time,
- affected workspace(s) if any,
- route or subsystem,
- root cause,
- commands run,
- data mutation summary,
- tests added,
- prevention follow-up.

Do not include secrets, raw PII, auth tokens, or cookies in the note.
