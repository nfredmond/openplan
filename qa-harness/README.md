# OpenPlan QA Harness

Purpose: keep one-off but reusable production QA scripts outside the app runtime while preserving the exact evidence-generation path used for ship-critical checks.

## Current scripts
- `openplan-local-workspace-url-isolation-smoke.js` — read-only browser smoke for local synthetic workspace A vs workspace B URL isolation. It signs in synthetic users from a fixture, verifies each user can load its own workspace-scoped URL, verifies the other user is denied, verifies the denied session still loads its own workspace URL afterward, and rejects leaked page text. It refuses non-local base URLs by default and does not seed or mutate Supabase data.
- `openplan-local-ui-ux-settle-capture.js` — read-only local Playwright capture harness for the UI/UX settle route manifest. It requires an already-authenticated local Playwright storage state, refuses production/Vercel URLs, captures desktop/mobile screenshots for populated local routes, and ledgers fixture-required routes instead of accepting empty-state proof.
- `openplan-local-rtp-release-review-smoke.js` — local browser/API smoke for RTP cycle creation, board-packet creation, artifact generation, registry linked-packet navigation, and report-detail release-review anchor landing.
- `openplan-local-grants-flow-smoke.js` — local browser/API smoke for the Grants OS flagship flow: project funding need, awarded opportunity, committed award, project RTP posture write-back, obligation milestone, paid reimbursement invoice, closeout reconciliation, closeout milestone, and project-detail funded/reimbursed posture.
- `openplan-local-engagement-report-handoff-smoke.js` — local browser/API smoke for public portal feedback submission, pending moderation persistence, staff approval, public feedback publication, handoff report provenance, generated HTML packet verification, and artifact source-context traceability.
- `openplan-prod-auth-smoke.js` — creates a dedicated QA auth user plus QA records in production, verifies redirect continuity and authenticated route flow, and writes screenshots/report artifacts into `docs/ops/<date>-test-output/` and `docs/ops/<date>-openplan-production-authenticated-smoke.md`.
- `openplan-prod-engagement-smoke.js` — creates a dedicated QA auth user, proves the unprovisioned `/engagement` state, bootstraps a workspace, and then drives the live engagement catalog/detail UI through campaign creation, category creation, intake item entry, moderation approval, and catalog refresh. Writes screenshots/report artifacts into `docs/ops/<date>-test-output/` and `docs/ops/<date>-openplan-production-engagement-smoke.md`.
- `openplan-prod-engagement-report-handoff-smoke.js` — proves the engagement → report handoff flow on production and records screenshots/evidence markdown.
- `openplan-prod-managed-run-smoke.js` — proves managed model-run launch and downstream scenario attachment continuity on production.
- `openplan-prod-report-traceability-smoke.js` — proves report detail backlink continuity against live engagement artifacts.
- `openplan-prod-report-funding-smoke.js` — proves Grants → Reports funding posture capture, report-registry digest visibility, grants-lane navigation, and post-generation funding drift on production.
- `openplan-prod-grants-registry-smoke.js` — proves the shared `/grants` workspace surface can create a funding opportunity, surface grants queue pressure, update decision posture, and link back into the canonical program funding lane on production.
- `openplan-prod-rtp-release-review-smoke.js` — proves the RTP packet create/generate/release-review loop on a live production alias and captures registry plus report-detail evidence.
- `openplan-prod-scenario-comparison-smoke.js` — proves live scenario comparison rendering from production-created QA data.
- `openplan-prod-county-scaffold-smoke.js` — proves county scaffold seed/readback/download/import/save/invalidation behavior on production.
- `openplan-prod-layout-overlap-audit.js` — audits authenticated production surfaces for overlap/overflow at the configured viewport and writes screenshot-backed findings.
- `openplan-prod-qa-cleanup.js` — inventories test-only QA artifacts and removes them from production only when run with `--apply`.

## Usage
From `openplan/qa-harness`:

```bash
npm install
npm run local-workspace-url-isolation-smoke -- --example-fixture
OPENPLAN_SYNTH_WORKSPACE_A_PASSWORD=dummy OPENPLAN_SYNTH_WORKSPACE_B_PASSWORD=dummy \
  npm run local-workspace-url-isolation-smoke -- --fixture fixtures/workspace-url-isolation.local.example.json --validate-fixture
# from ../openplan, seed local synthetic users/workspaces/projects and write the ignored local fixture:
corepack pnpm seed:workspace-isolation
# then export the printed synthetic password env vars and run the browser proof:
npm run local-workspace-url-isolation-smoke -- --fixture fixtures/workspace-url-isolation.local.json
BASE_URL=http://localhost:3000 OPENPLAN_UI_UX_STORAGE_STATE=/absolute/path/to/local-storage-state.json \
  npm run local-ui-ux-settle-capture
npm run local-rtp-release-review-smoke
npm run local-grants-flow-smoke
npm run local-engagement-report-handoff-smoke
npm run prod-auth-smoke
npm run prod-managed-run-smoke
npm run prod-report-funding-smoke
npm run prod-grants-registry-smoke
npm run prod-rtp-release-review-smoke
npm run prod-scenario-comparison-smoke

# cleanup now defaults to plan-only / dry-run
npm run prod-qa-cleanup

# apply cleanup deliberately
npm run prod-qa-cleanup:apply
```

## Notes
- Uses `harness-env.js` for repo-root discovery, env loading, canonical base URL selection, and optional Vercel protection bypass headers.
- Reads OpenPlan env from `OPENPLAN_ENV_PATH`, `openplan/.env.local`, or repo-root `.env.local` (first match wins).
- Defaults active proofs to the canonical production alias `https://openplan-natford.vercel.app`. Override with `OPENPLAN_BASE_URL` only when intentionally targeting another lane.
- If Vercel Authentication is enabled, set `VERCEL_AUTOMATION_BYPASS_SECRET` (or one of the accepted bypass env aliases in `harness-env.js`) so Playwright contexts can reach the protected deployment.
- OpenPlan also auto-loads `secrets/openplan_vercel_protection_bypass.env` from the workspace root when present, so canonical proof runs can use the secure local bypass path without copying the secret into app env files.
- When the canonical alias is still protected and no bypass secret is available in the harness env, use `OPENPLAN_BASE_URL=https://openplan-zeta.vercel.app` deliberately for a fallback production proof run, and record that alias choice explicitly in the generated smoke memo.
- Uses Playwright in headless mode.
- The UI/UX settle capture harness never logs in, creates users, seeds data, writes Supabase rows, touches billing/email, or persists credentials/tokens. It consumes an existing local storage-state file only for the Playwright browser context.
- The UI/UX settle capture harness accepts `BASE_URL` values on `localhost` or `127.0.0.1` by default. It always refuses Vercel URLs. Use `--allow-local-network` only for explicit private local URLs such as `192.168.x.x`, and record that choice in the generated ledger.
- The UI/UX settle capture harness writes only under `docs/ops/2026-04-29-test-output/ui-ux-settle/` unless `OPENPLAN_UI_UX_SETTLE_OUTPUT_DIR` or `--output-dir` points to another directory under `docs/ops/`.
- The local workspace URL isolation fixture is a template: replace placeholder IDs/text with records from a local synthetic seed and export the password env vars before running it. Every denied user must also have an own-workspace URL check so the harness can prove session continuity after a cross-workspace denial.
- Intended for controlled operator use, not CI.
- Most smoke scripts create real production QA users/workspaces/records. Run cleanup after proof so production residue does not accumulate.
- `openplan-prod-qa-cleanup.js` is intentionally non-destructive by default; use `--apply` only after reviewing the printed plan.
