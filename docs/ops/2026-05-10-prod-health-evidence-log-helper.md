# OpenPlan prod health evidence-log helper

## Purpose

After a push to `main`, do not close the production gate on memory alone. Record two pieces of evidence together:

1. Vercel shows the latest production deployment as `Ready`.
2. `npm run ops:check-prod-health` passes against the public `/api/health` contract.

The helper added in this slice keeps that evidence in a small local Markdown log without requiring secrets, Supabase access, production writes, or Vercel API tokens.

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

By default the helper writes to:

```text
docs/ops/YYYY-MM-DD-test-output/prod-health-evidence/YYYYMMDDTHHMMSSZ-prod-health-evidence.md
```

## Operator notes

- A passing health check does **not** prove the latest Vercel deployment is Ready; record the Vercel state explicitly.
- `--require-vercel-ready` is recommended for main-push closure because it fails fast if the state was not recorded as `Ready`.
- Use `--dry-run` if you only need to preview the evidence packet.
- Use `--health-url <url>` only when intentionally checking a preview or alternate deployment.
- The helper reads a public URL and writes a local file only. It does not call Supabase, mutate production, or consume secret tokens.

## Acceptance gate

Close the post-push evidence gate only when the generated log says:

```text
Gate decision: PASS
```

If the generated log says `HOLD`, wait for Vercel Ready verification and rerun the helper.
