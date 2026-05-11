# OpenPlan prod health evidence-log helper

## Purpose

After a push to `main`, do not close the production gate on memory alone. Record two pieces of evidence together:

1. Vercel shows the latest production deployment as `Ready`.
2. `npm run ops:check-prod-health` passes against the public `/api/health` contract.

The helper added in this slice keeps that evidence in a small local Markdown log without requiring secrets, Supabase access, production writes, or Vercel API tokens.

## Canonical command and artifact path

Use this command shape when the deploy can be represented by saved Vercel inspect JSON:

```bash
npm run ops:log-prod-health-evidence -- --vercel-inspect-json /tmp/openplan-vercel-inspect.json --require-vercel-ready
```

The generated artifact path shape is:

```text
docs/ops/YYYY-MM-DD-test-output/prod-health-evidence/YYYYMMDDTHHMMSSZ-prod-health-evidence.md
```

Keep this exact command and path synchronized with the ops README index and the final pilot-readiness checklist so post-deploy proof handoffs do not drift.

## Standard post-main-push flow

Run from the app directory:

```bash
cd openplan
npm run ops:check-prod-health
```

Then inspect the latest production deployment in Vercel dashboard or with the Vercel CLI. Once it is actually `Ready`, write the evidence log:

```bash
npm run ops:log-prod-health-evidence -- \
  --vercel-url https://openplan-natford.vercel.app \
  --vercel-state Ready \
  --require-vercel-ready
```

For fewer manual transcription steps, save Vercel CLI JSON and let the helper read the deployment URL/state from that file:

```bash
vercel inspect https://openplan-natford.vercel.app --json > /tmp/openplan-vercel-inspect.json
npm run ops:log-prod-health-evidence -- \
  --vercel-inspect-json /tmp/openplan-vercel-inspect.json \
  --require-vercel-ready
```

The helper records only the deployment URL and Ready state from the JSON; it does not copy the full inspect payload into the evidence log.

By default the helper writes to:

```text
docs/ops/YYYY-MM-DD-test-output/prod-health-evidence/YYYYMMDDTHHMMSSZ-prod-health-evidence.md
```

## Operator notes

- A passing health check does **not** prove the latest Vercel deployment is Ready; record the Vercel state explicitly.
- `--require-vercel-ready` is recommended for main-push closure because it fails fast if the resolved state was not recorded as `Ready`.
- Use `--vercel-inspect-json <path>` when you have a saved `vercel inspect --json` payload; explicit `--vercel-url` / `--vercel-state` flags still take precedence.
- Use `--dry-run` if you only need to preview the evidence packet.
- Use `--health-url <url>` only when intentionally checking a preview or alternate deployment.
- The helper reads a public URL and writes a local file only. It does not call Supabase, mutate production, or consume secret tokens.


## Admin Operations Bridge

When the deploy being closed touches `/admin/operations`, request-access intake, reviewer gating, manual owner-invite provisioning guardrails, pilot-readiness exports, or admin/support proof docs, pair this helper with the [Admin Ops → Production Health Evidence Bridge](2026-05-10-openplan-admin-ops-to-prod-health-evidence-bridge.md).

The bridge keeps Vercel Ready + public health evidence adjacent to the no-write Admin Operations proof flow. It does not authorize prospect PII capture, triage/provisioning clicks, emails, Supabase service-role access, billing changes, or production writes.

## Acceptance gate

Close the post-push evidence gate only when the generated log says:

```text
Gate decision: PASS
```

If the generated log says `HOLD`, wait for Vercel Ready verification and rerun the helper.
