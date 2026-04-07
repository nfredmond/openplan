# OpenPlan Operator Remediation Executed — 2026-04-06

Owner: Bartholomew Hale

## Completed

1. Restored a usable `SUPABASE_SERVICE_ROLE_KEY` in the canonical `natford/openplan` Vercel project for the proof lane.
   - Production and preview now have a non-blank encrypted service-role env entry.
   - The stale blank preview-only service-role entry was removed.

2. Confirmed a working Vercel automation-bypass path for the canonical alias.
   - The canonical alias accepts a valid protection-bypass header and returns a non-401 response.
   - The bypass secret was stored locally in the secure secrets directory, not in public docs.

3. Repointed the live Stripe OpenPlan webhook to the canonical alias.
   - Updated from `https://openplan-zeta.vercel.app/api/billing/webhook`
   - Updated to `https://openplan-natford.vercel.app/api/billing/webhook`

## Result

The three concrete operator blockers from the 2026-04-07 proof-rerun refresh are now closed at the configuration level.

## Remaining follow-through

- Rerun the supervised canary preflight against the canonical proof workspace.
- If preflight is green, run the supervised billing canary and then the read-only webhook-proof checker.
- Attach the refreshed evidence packet under `docs/ops/`.
