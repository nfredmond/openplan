# OpenPlan Proof Ops Runbook — 2026-04-05

## Purpose

Give OpenPlan a repeatable, operator-friendly proof lane for supervised pilot launch work:
- run the right smoke proofs in the right order,
- keep alias/env defaults consistent,
- capture evidence into `docs/ops/`,
- monitor a supervised canary honestly,
- and clean up production QA residue deliberately.

## Canonical defaults

- **Canonical production alias:** `https://openplan-natford.vercel.app`
- **Legacy compatibility alias:** `https://openplan-zeta.vercel.app`
- **Harness env resolution:** `OPENPLAN_ENV_PATH` → `openplan/.env.local` → repo-root `.env.local`
- **Evidence output root:** `docs/ops/<YYYY-MM-DD>-test-output/`
- **Harness package root:** `qa-harness/`
- **Canary preflight script:** `openplan/scripts/openplan-supervised-paid-canary-preflight.sh`

If an operator intentionally targets a non-canonical deployment, they must set `OPENPLAN_BASE_URL` explicitly and record that override in the resulting evidence packet.

## Operator principles

1. **Local validation first.** Run syntax/build checks before touching production.
2. **Dedicated QA identities only.** Harness proofs should create isolated test users/workspaces, never piggyback on human operator records.
3. **Evidence or it did not happen.** Every production proof should emit screenshots and a markdown summary under `docs/ops/`.
4. **Cleanup is deliberate.** QA data is real production data until removed. Review cleanup plan first; apply second.
5. **Principal gate still stands.** Passing proofs does not bypass Elena’s final QA/QC review or the existing approval file requirement.

## Recommended proof sequence

### 0) Prep the harness

From repo root:

```bash
cd qa-harness
npm install
```

Optional local sanity checks:

```bash
node --check harness-env.js
node --check openplan-prod-auth-smoke.js
node --check openplan-prod-managed-run-smoke.js
node --check openplan-prod-qa-cleanup.js
bash -n ../openplan/scripts/openplan-supervised-paid-canary-preflight.sh
```

If Vercel Authentication is enabled for the target deployment, export a bypass secret before running browser-based proofs.

## 1) Core authenticated continuity proof

Run first:

```bash
cd qa-harness
npm run prod-auth-smoke
```

This proves:
- signed-out redirect continuity,
- sign-in return path,
- authenticated workspace creation,
- project/plan/model/program continuity,
- billing page reachability.

Expected evidence:
- `docs/ops/<date>-openplan-production-authenticated-smoke.md`
- screenshots under `docs/ops/<date>-test-output/`

## 2) County onramp / scaffold proof

Run when county-run workflows are in scope:

```bash
cd qa-harness
npm run prod-county-scaffold-smoke
```

This proves:
- county run creation,
- manifest ingest,
- scaffold seed/readback,
- CSV download/import/save,
- validation invalidation after scaffold edits.

## 3) Managed-run proof

Run before scenario comparison:

```bash
cd qa-harness
npm run prod-managed-run-smoke
```

This proves:
- live model launch control wiring,
- run-history visibility,
- scenario-entry continuity off a production-created model run.

## 4) Scenario comparison proof

Run after managed-run proof:

```bash
cd qa-harness
npm run prod-scenario-comparison-smoke
```

This proves the comparison board can render against live QA-created scenario data.

## 5) Optional engagement/report lane proofs

Run only when engagement/report release scope is active:

```bash
cd qa-harness
npm run prod-engagement-smoke
npm run prod-engagement-report-handoff-smoke
npm run prod-report-traceability-smoke
```

These cover:
- engagement workspace activation,
- category/item/moderation flow,
- engagement → report handoff,
- report backlink / traceability continuity.

## 6) Layout / responsive audit

Use when app-shell, navigation, or module-surface layout changed.

Default desktop pass:

```bash
cd qa-harness
npm run prod-layout-overlap-audit
```

Target narrower widths explicitly:

```bash
cd qa-harness
OPENPLAN_AUDIT_WIDTH=390 OPENPLAN_AUDIT_HEIGHT=1600 npm run prod-layout-overlap-audit
OPENPLAN_AUDIT_WIDTH=768 OPENPLAN_AUDIT_HEIGHT=1600 npm run prod-layout-overlap-audit
OPENPLAN_AUDIT_WIDTH=1024 OPENPLAN_AUDIT_HEIGHT=1600 npm run prod-layout-overlap-audit
```

## 7) Supervised paid canary preflight + monitoring

Run preflight before any supervised billing canary:

```bash
cd openplan
./scripts/openplan-supervised-paid-canary-preflight.sh \
  --workspace-id <workspace-uuid> \
  --billing-email <operator-or-owner-email>
```

What preflight now does by default:
- uses the canonical `openplan-natford` alias unless overridden,
- pulls/loads production env,
- verifies public alias behavior,
- verifies live Starter price posture,
- verifies Stripe webhook endpoint posture,
- snapshots workspace/billing state,
- captures a monitor snapshot,
- writes a summary into the dated evidence folder.

During the supervised canary, run the exact monitor command emitted by preflight. Do not improvise a different workspace id or alias midstream.

Immediately after the supervised canary, run the read-only webhook proof checker from `openplan/openplan`:

```bash
npm run ops:webhook-proof -- --workspace-id <workspace-uuid> --since-minutes 240 --env-file /tmp/openplan.vercel.env
```

Use `--email <operator-email>` when you need to disambiguate recent Stripe events for a shared test window. Treat a non-zero exit as a real blocker, not a soft warning.

## 8) Cleanup — dry-run first, apply second

Review the cleanup plan first:

```bash
cd qa-harness
npm run prod-qa-cleanup -- --created-after 2026-04-05
```

Apply only after confirming the candidate list is test-only:

```bash
cd qa-harness
npm run prod-qa-cleanup:apply -- --created-after 2026-04-05
```

Cleanup coverage now includes:
- QA workspaces
- QA projects / reports / campaigns
- county runs and county run artifacts
- related project subrecords
- matching auth users
- matching open Stripe checkout sessions

## 9) Release decision packet

After proofs are complete:

1. Confirm the relevant markdown evidence files exist under `docs/ops/`.
2. Confirm cleanup evidence exists if production QA residue was removed.
3. Summarize any holds, caveats, or skipped proofs explicitly.
4. Update or attach the principal QA approval artifact before external release claims.

## Mutation honesty matrix

| Proof | Creates production QA data? | Cleanup expected? |
|---|---:|---:|
| `prod-auth-smoke` | Yes | Yes |
| `prod-county-scaffold-smoke` | Yes | Yes |
| `prod-managed-run-smoke` | Yes | Yes |
| `prod-scenario-comparison-smoke` | Yes | Yes |
| `prod-engagement-smoke` | Yes | Yes |
| `prod-engagement-report-handoff-smoke` | Yes | Yes |
| `prod-report-traceability-smoke` | Yes | Yes |
| `prod-layout-overlap-audit` | Yes | Yes |
| `prod-qa-cleanup` (dry-run) | No | No |
| `prod-qa-cleanup --apply` | Yes — deletes QA residue | n/a |
| `openplan-supervised-paid-canary-preflight.sh` | No direct app data creation | No |

## Abort conditions

Abort the release/canary lane if any of the following is true:
- the alias under test is unclear or inconsistent across proofs,
- the smoke harness is writing against the wrong environment file,
- a proof requires manual operator improvisation to pass,
- cleanup plan matches anything that looks user-authored rather than test-only,
- billing or webhook posture diverges from the expected live configuration,
- Elena has not issued final PASS in the principal approval artifact.

## Related evidence

- `docs/ops/2026-04-05-openplan-alias-reference-policy.md`
- `docs/ops/2026-04-05-openplan-production-authenticated-smoke.md`
- `docs/ops/2026-04-05-openplan-production-county-scaffold-smoke.md`
- `docs/ops/2026-04-05-openplan-production-managed-run-smoke.md`
- `docs/ops/2026-04-05-openplan-production-scenario-comparison-smoke.md`
- `docs/ops/2026-04-05-openplan-production-qa-cleanup.md`
- `docs/ops/2026-04-06-openplan-operator-remediation-packet.md`
