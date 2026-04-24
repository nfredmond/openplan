# Production alerting hookup proof

**Shipped:** 2026-04-24 Pacific
**Scope:** C.5b no-vendor production health alerting around the existing shallow `/api/health` route.

## What changed

Added a repo-native health-check command:

```bash
pnpm ops:check-prod-health
```

The command runs `scripts/ops/check-prod-health.mjs`, which performs both `GET` and `HEAD` against `https://openplan-natford.vercel.app/api/health` by default. It fails if either response is non-200, if `Cache-Control` is not `no-store, max-age=0`, if the JSON payload stops reporting `status: "ok"` / `service: "openplan"` / `checks.app: "ok"`, or if the shallow route starts claiming dependency readiness for `database` or `billing`.

Added `.github/workflows/production-health.yml`:

- scheduled at `7,22,37,52 * * * *`,
- manually runnable via `workflow_dispatch`,
- uses Node 24,
- needs no install step and no secrets,
- runs the same standalone Node script from `openplan/`.

Added `docs/ops/2026-04-24-production-alerting-options.md`, comparing GitHub Actions, Upptime, Vercel alerts/drains, Sentry, Better Stack, Axiom, Logflare, and Datadog. The decision is to use GitHub Actions now and defer vendor/account/spend decisions.

Updated `docs/ops/RUNBOOK.md` with the scheduled health-check workflow, manual dispatch commands, and the limitation that GitHub scheduled workflows can be delayed or dropped under platform load.

Also added a narrow `pnpm.overrides` pin for `postcss@<8.5.10` after `pnpm qa:gate` surfaced a new moderate production audit advisory through `next > postcss`. The lockfile now resolves `postcss@8.5.10`, and production audit is clean again.

## Guardrails

No monitoring vendor was configured. No Sentry, Better Stack, Axiom, Logflare, Datadog, Vercel drain, Slack integration, email integration, or paid service was created.

No production data was mutated. The health check is unauthenticated, public, and does not use Supabase, Stripe, billing, provisioning, Anthropic, or service-role secrets.

The `/api/health` route itself remains unchanged and intentionally shallow. This slice adds an alarm around route availability, not a dependency readiness probe.

## Verification

Targeted tests:

```text
pnpm test src/test/health-route.test.ts src/test/prod-health-check-script.test.ts src/test/security-headers.test.ts src/test/rls-isolation.test.ts
# 4 files passed
# 9 tests passed, 4 skipped
```

Live production health command:

```text
pnpm ops:check-prod-health
# OpenPlan health check passed: https://openplan-natford.vercel.app/api/health
```

TypeScript:

```text
pnpm exec tsc --noEmit
# passed
```

Production audit after the PostCSS override:

```text
pnpm audit --prod --audit-level=moderate
# No known vulnerabilities found
```

Full gate:

```text
pnpm qa:gate
# lint passed
# test passed: 226 files, 1144 tests, 4 skipped
# pnpm audit --prod --audit-level=moderate: no known vulnerabilities
# next build --webpack passed and listed /api/health
```

## Post-push operator check

The new workflow is only dispatchable after it exists on `main`. Closeout command:

```bash
gh workflow run production-health.yml --ref main
gh run list --workflow production-health.yml --limit 5
gh run view <run-id> --log-failed
```

## Customer-readiness effect

OpenPlan now has a no-spend first alarm for app-route uptime. It is enough for supervised first-customer access while preserving the future option to add external uptime checks, error tracking, log drains, or a public status page after Nathaniel approves account ownership and spend.
