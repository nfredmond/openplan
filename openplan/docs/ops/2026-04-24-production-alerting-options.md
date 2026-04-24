# Production alerting options

**Date:** 2026-04-24 Pacific
**Decision:** use a no-vendor GitHub Actions health check for C.5b.

This note compares low-friction production alerting paths for the current first-customer readiness window. The goal is not full observability yet. It is a dependable first alarm on the public app route without creating spend, new vendor accounts, or customer-data exposure.

## Chosen path

Use the existing public health route:

```text
https://openplan-natford.vercel.app/api/health
```

Add a scheduled/manual GitHub Actions workflow that runs the repo-local health-check script every 15 minutes. The script validates both `GET` and `HEAD`, requires a non-cached `200`, and locks the shallow contract: `database` and `billing` must remain `not_checked`.

This is intentionally a coarse uptime signal. A passing check means the deployed Next.js route can execute. It does not prove Supabase, Stripe, Mapbox, Anthropic, PDF generation, or billing meters are healthy.

## Option matrix

| Option | Fit for C.5b | Cost posture | Notes |
|---|---:|---:|---|
| GitHub Actions health check | Best | No vendor spend | Already available in-repo, manually dispatchable, no secrets. GitHub documents that scheduled jobs can be delayed or dropped during high load, so this is not a formal SLA monitor. |
| Upptime | Good later | No service spend | GitHub Actions + Issues + Pages based status-page stack. Useful when OpenPlan wants public incident history, but heavier than one internal health check. |
| Vercel native alerts | Good if already enabled | Plan-dependent | Vercel alerts are beta on Pro/Enterprise with Observability Plus; useful for 5xx/usage anomalies, not a direct public `/api/health` probe. |
| Vercel drains | Good for log retention/alerts | Plan and usage billed | Drains are Pro/Enterprise and billed by data volume. Useful once log retention and structured alerting are worth a spend decision. |
| Sentry | Good for runtime errors | Free starter, external account | Developer plan includes one user, error monitoring/tracing, email alerts, and one uptime monitor. Requires SDK/project setup and an account decision. |
| Better Stack | Strong uptime product | Free tier exists | Free personal tier includes monitors/heartbeats and email/Slack alerts. Requires external account ownership and notification policy. |
| Axiom | Strong logs/monitors | Free personal tier exists | Useful for logs/querying; Vercel drain path may add Vercel-side plan/cost constraints. Better as a log-retention slice. |
| Logflare | Good Vercel/Supabase-adjacent logs | Free tier exists, paid path for faster alerts | Free tier has short retention and rate limits. Vercel marketplace path depends on log-drain availability. |
| Datadog | Overpowered now | Paid/trial path | Best reserved for a later observability budget and formal support posture. |

## Operator behavior

Use GitHub Actions failure visibility as the first alert surface for this slice:

```bash
cd /home/narford/.openclaw/workspace/openplan/openplan
pnpm ops:check-prod-health
```

Manual workflow dispatch:

```bash
gh workflow run production-health.yml --ref main
gh run list --workflow production-health.yml --limit 5
gh run view <run-id> --log-failed
```

If the workflow fails, follow `docs/ops/RUNBOOK.md` starting with the app-down path. Capture the failed run URL, request time, and current production deployment id.

## Sources

- GitHub scheduled workflows: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
- GitHub manual workflow dispatch: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow
- Upptime configuration and scheduling: https://upptime.js.org/docs/configuration/
- Vercel Alerts: https://vercel.com/docs/alerts/
- Vercel Drains: https://vercel.com/docs/drains
- Sentry pricing: https://sentry.io/pricing/
- Better Stack pricing: https://betterstack.com/pricing
- Axiom pricing: https://axiom.co/pricing
- Logflare pricing: https://logflare.app/pricing
- Datadog pricing: https://www.datadoghq.com/pricing/list/

Pricing and product availability are time-sensitive. Re-check source pages before signing up for any external service or committing to a paid monitoring path.
