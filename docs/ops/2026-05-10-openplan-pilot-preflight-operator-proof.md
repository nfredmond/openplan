# OpenPlan Pilot Preflight Operator Proof — 2026-05-10

**Status:** Current operator proof note
**Command:** `pnpm ops:check-pilot-preflight`
**Scope:** read-only pre-conversation readiness bundle for supervised buyer, demo, and pilot diligence
**Posture:** OpenPlan remains a supervised planning workbench and managed implementation/support offer, not a self-serve SaaS launch, legal-compliance engine, grant-award predictor, calibrated behavioral forecast, or autonomous planning authority.

## Why this exists

`pnpm ops:check-pilot-preflight` gives an operator one bundled preflight before a serious OpenPlan conversation. It collects the minimum posture checks that should be fresh before Nathaniel or the team talk with a buyer, demo prospect, or supervised pilot partner:

1. local Supabase/env guard posture, including non-local URL attention flags without printing secret values;
2. Supabase migration inventory posture, including duplicate timestamp/slug checks and review flags;
3. production health endpoint posture for the canonical OpenPlan deployment;
4. read-only Vercel deployment readiness posture, normalized to deployment status fields only.

The command is deliberately an evidence gate, not a mutation tool. It helps decide whether the team can proceed into a conversation with clean operational footing, whether a caveat must be disclosed, or whether the conversation should pause until the issue is resolved.

## When to run it

Run this preflight immediately before any of these events:

- **Buyer diligence call:** before discussing managed hosting, onboarding, support, or pilot readiness.
- **Public/product demo:** before screen-sharing the production site or sending a fresh demo link.
- **Pilot kickoff or renewal conversation:** before claiming current operational readiness for a supervised pilot workspace.
- **Sales packet refresh:** before updating buyer-safe proof language that refers to current production or migration posture.
- **Post-deploy confidence check:** after a meaningful `main` push has deployed and before using that build in a conversation.

Recommended default:

```bash
cd openplan
pnpm ops:check-pilot-preflight
```

Local/offline-safe documentation sample, when production/Vercel checks are intentionally out of scope:

```bash
cd openplan
pnpm ops:check-pilot-preflight -- --skip-health --skip-vercel
```

Machine-readable evidence for an operator log:

```bash
cd openplan
pnpm ops:check-pilot-preflight -- --json
```

## Safety boundary

This command is intentionally safe to run as a pre-conversation check:

- **Read-only:** it does not insert, update, delete, or upsert application data.
- **No production writes:** it does not create pilot workspaces, support intake rows, billing records, comments, reports, or smoke-test artifacts.
- **No schema apply:** it does not run `supabase db push`, `supabase migration up`, `supabase db reset`, SQL migrations, or any equivalent schema-changing command.
- **No secret exposure:** it reports whether required/optional env keys are present, missing, local, or non-local, but it does not print key values, tokens, service-role secrets, database URLs, or Supabase project refs.
- **Vercel inspection is normalized:** the Vercel lane is a read-only `inspect` posture check; output is reduced to deployment status fields such as ready state, environment, deployment URL, commit SHA, and issues.

If a future change expands the command beyond this safety boundary, this proof note must be updated in the same PR and the command should no longer be treated as routine pre-conversation tooling.

## Expected PASS shape

A clean full run should have this shape. Timestamps, migration counts, latest migration names, deployment URLs, and commit SHAs will naturally change.

```text
OpenPlan pilot-readiness preflight bundle (read-only)
Status: OK
checkedAt=2026-05-10T23:00:00.000Z

Local Supabase status guard:
  status: OK
  env file: /path/to/openplan/.env.local (found)
  required keys: NEXT_PUBLIC_SUPABASE_URL=set/local, NEXT_PUBLIC_SUPABASE_ANON_KEY=set, SUPABASE_SERVICE_ROLE_KEY=set
  optional keys: SUPABASE_DB_URL=set/local, SUPABASE_ACCESS_TOKEN=missing, SUPABASE_PROJECT_REF=missing

Supabase migration inventory:
  status: OK
  directory: /path/to/openplan/supabase/migrations (found)
  migrations: 85 (283.7 KB)
  first/latest: 20260219000001_gtfs_schema.sql / 20260508000079_modeling_caveat_kpi_sql_gate.sql
  review flags: 55
  duplicate timestamps/slugs: 0/0

Production health:
  status: OK
  health URL: https://openplan-natford.vercel.app/api/health
  checkedAt: 2026-05-10T23:00:01.000Z

Deployment readiness:
  status: OK
  target: https://openplan-natford.vercel.app/
  readyState: READY
  environment: production
  deployment: https://openplan-natford.vercel.app/
  commit: <current-deployment-commit>

Safety: read-only; no schema apply, production writes, or secret values emitted.
```

Acceptance for a buyer/demo/pilot conversation:

- `Status: OK`, or
- `Status: ATTENTION` only when every attention item is understood, non-critical for the conversation, and explicitly carried as a caveat.

Do not silently ignore `ATTENTION` before a buyer-facing conversation. That is the small loose strap that becomes a pack dump at the trailhead.

## Expected ATTENTION shape

This is a representative local documentation run from a fresh worktree using intentional skips and no `.env.local`. It proves the command fails closed and reports missing posture without leaking values.

Command run:

```bash
cd openplan
node scripts/ops/check-pilot-preflight.mjs --skip-health --skip-vercel
```

Representative output:

```text
OpenPlan pilot-readiness preflight bundle (read-only)
Status: ATTENTION
checkedAt=2026-05-10T23:12:21.555Z

Local Supabase status guard:
  status: ATTENTION
  env file: /path/to/openplan/.env.local (missing)
  required keys: NEXT_PUBLIC_SUPABASE_URL=missing/unset, NEXT_PUBLIC_SUPABASE_ANON_KEY=missing, SUPABASE_SERVICE_ROLE_KEY=missing
  optional keys: SUPABASE_DB_URL=missing/unset, SUPABASE_ACCESS_TOKEN=missing, SUPABASE_PROJECT_REF=missing

Supabase migration inventory:
  status: OK
  directory: /path/to/openplan/supabase/migrations (found)
  migrations: 85 (283.7 KB)
  first/latest: 20260219000001_gtfs_schema.sql / 20260508000079_modeling_caveat_kpi_sql_gate.sql
  review flags: 55
  duplicate timestamps/slugs: 0/0

Production health:
  status: SKIPPED
  note: production health check skipped by operator flag

Deployment readiness:
  status: SKIPPED
  note: Vercel deployment inspection skipped by operator flag

Attention items:
  - local Supabase: env file not found: /path/to/openplan/.env.local
  - local Supabase: missing required local Supabase env keys: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
  - production health: production health check skipped by operator flag
  - deployment readiness: Vercel deployment inspection skipped by operator flag

Safety: read-only; no schema apply, production writes, or secret values emitted.
```

Expected exit behavior:

- `0` when all enabled sections are `OK`.
- non-zero when any enabled or intentionally skipped section contributes an attention item.

## How to read each section

| Section | What OK means | What ATTENTION usually means |
|---|---|---|
| Local Supabase status guard | Required env keys are present and local/loopback where local harness safety requires it. | Missing `.env.local`, missing keys, or non-local Supabase URLs that require operator review before local smokes or demos. |
| Supabase migration inventory | Migrations directory exists, is countable, and has no duplicate timestamps/slugs. | Directory missing, duplicate migration identifiers, or inventory flags that need review before claiming readiness. |
| Production health | Canonical `/api/health` answered successfully. | Production health fetch failed, URL invalid, deployment down, or check intentionally skipped. |
| Deployment readiness | Vercel reports a `READY` deployment for the target. | Vercel CLI unavailable, inspect failed, deployment not ready, target invalid, or check intentionally skipped. |

## Buyer-safe wording after a clean run

Use restrained language. This preflight supports operational confidence, not overclaiming:

> We ran OpenPlan's read-only pilot preflight immediately before this conversation. It checked local environment guard posture, migration inventory, production health, and deployment readiness without applying schema changes, writing production data, or exposing secrets. The result supports a supervised pilot/demo conversation; it is not a claim of autonomous planning, legal compliance automation, grant-award prediction, or calibrated demand forecasting.

## Maintenance notes

- Keep this document aligned with `scripts/ops/check-pilot-preflight.mjs` whenever output fields or safety boundaries change.
- Keep proof language anchored to the supervised planning workbench posture.
- Prefer fresh command output in dated proof packets when a conversation depends on current production state; this note is the standing operator proof pattern, not a substitute for a fresh run.
