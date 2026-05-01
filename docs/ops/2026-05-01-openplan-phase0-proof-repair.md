# OpenPlan Phase 0 Proof Repair

**Date:** 2026-05-01  
**Status:** PASS for implemented proof-repair slice  
**Roadmap anchor:** `2026-05-01-openplan-full-os-roadmap.md`

## What Changed

- Public demo preflight now checks the current `/request-access` service-intake copy: self-hosting, managed hosting, or implementation review.
- Admin Pilot Readiness parsing now treats line-item `PASS:` evidence as PASS when no explicit status header exists.
- Pilot Readiness parsing moved into a focused server-side helper with unit coverage.
- [docs/ops/README.md](README.md) now points to the active full OS roadmap and recent proof artifacts.
- Local `.env.local` public Mapbox posture was cleaned without printing token values: the invalid `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` entry was blanked, and the remaining `NEXT_PUBLIC_MAPBOX_TOKEN` entry passes the `pk.*` public-token check.
- The NCTC demo seed now includes a deterministic Data Hub connector, three ready datasets, one succeeded validation job, and project links so `/data-hub` can be recaptured with populated lineage state.
- The app theme provider now uses OpenPlan's local class toggler instead of the `next-themes` inline script component, removing the React dev warning that appeared in denied-route workspace-isolation screenshots.

## Validation Run

All commands were run from `openplan/` unless noted.

```bash
pnpm exec vitest run src/test/public-demo-preflight-script.test.ts src/test/pilot-readiness-status.test.ts
```

Result: PASS, 2 files, 11 tests.

```bash
pnpm exec eslint scripts/ops/check-public-demo-preflight.mjs src/lib/operations/pilot-readiness.ts src/app/'(app)'/admin/pilot-readiness/page.tsx src/test/public-demo-preflight-script.test.ts src/test/pilot-readiness-status.test.ts src/test/fixtures/public-demo-preflight-mock-fetch.mjs
pnpm exec tsc --noEmit
git diff --check
```

Result: PASS.

```bash
pnpm test
pnpm lint
pnpm build
pnpm audit --prod --audit-level=moderate
```

Result:

- `pnpm test`: PASS, 253 files, 1273 passing, 4 skipped.
- `pnpm lint`: PASS.
- `pnpm build`: PASS.
- `pnpm audit --prod --audit-level=moderate`: PASS, no known vulnerabilities found.

```bash
pnpm ops:check-prod-health
```

Result: PASS against `https://openplan-natford.vercel.app/api/health`.

```bash
pnpm ops:check-public-demo-preflight -- --mapbox-env-file .env.local
```

Result: PASS.

Checked:

- Mapbox public token format is `pk.*`; token values were not printed.
- `GET/HEAD /api/health` shallow no-store contract.
- `GET /request-access` services intake page.
- `GET /api/billing/readiness` is not publicly readable.
- CSP includes Mapbox API, events, tile/image, and worker allowances.

## Data Hub Seed Fixture Validation

```bash
pnpm seed:nctc -- --dry-run
pnpm exec vitest run src/test/seed-nctc-demo.test.ts
pnpm exec eslint scripts/seed-nctc-demo.ts src/test/seed-nctc-demo.test.ts
pnpm exec tsc --noEmit
git diff --check
```

Result: PASS.

Checked:

- The NCTC artifact tree still loads and the dry run reports the screening-grade evidence bundle without writes.
- `buildSeedRecords` now emits stable Data Hub connector, dataset, refresh-job, and project-link records.
- The seeded datasets exercise tract, corridor, and crash-point thematic attachment modes used by `/data-hub`.

## UI Watch Recapture

```bash
pnpm seed:nctc
OPENPLAN_UI_UX_STORAGE_STATE=/tmp/openplan-nctc-local-storage-state.json \
OPENPLAN_UI_UX_SETTLE_OUTPUT_DIR=docs/ops/2026-05-01-test-output/ui-ux-watch-recapture \
npm run local-ui-ux-settle-capture -- --route data-hub --route pilot-readiness
```

Result: PASS, 4 captured rows.

Checked:

- `/data-hub` desktop/mobile now requires and captures the seeded NCTC Data Hub connector plus three seeded datasets.
- `/admin/pilot-readiness` desktop/mobile now captures the parser-repaired readiness page with four passing checks and no pending/failing checks.
- The shared cartographic backdrop no longer triggers a Next dev hydration issue during the capture.

## Workspace URL Isolation Smoke

```bash
pnpm seed:workspace-isolation --base-url http://localhost:3000
cd ../qa-harness
npm run local-workspace-url-isolation-smoke -- --fixture fixtures/workspace-url-isolation.local.json
```

Result: PASS, 2 synthetic users and 2 URL checks.

Checked:

- Workspace A can load its project detail while Workspace B receives the app not-found state for the same URL.
- Workspace B can load its project detail while Workspace A receives the app not-found state for the same URL.
- Each denied navigation is followed by an own-workspace URL check, proving the browser session remains attached to the correct workspace after denial.
- Fresh screenshots are recorded in `2026-05-01-test-output/`, and denied-route captures are clean of the prior React script-tag dev warning.

## RC Proof Log

`2026-05-01-openplan-rc-proof-log.md` records the fresh release-candidate gate after this proof-repair pass.

Result: PASS.

Included:

- `pnpm test`: PASS, 253 files, 1274 passing, 4 skipped.
- `pnpm lint`: PASS.
- `pnpm build`: PASS.
- `pnpm audit --prod --audit-level=moderate`: PASS.
- `pnpm ops:check-prod-health`: PASS.
- `pnpm ops:check-public-demo-preflight`: PASS with expected local-token warning.
- `pnpm ops:check-public-demo-preflight -- --mapbox-env-file .env.local`: PASS.

## Remaining Phase 0 Work

- UI/UX settle proof pack is reviewed in `2026-05-01-openplan-ui-ux-settle-review.md`; the original Pilot Readiness and Data Hub watch items are closed by `2026-05-01-openplan-ui-ux-watch-recapture.md`.
- Admin operations public preflight is recorded in `2026-05-01-openplan-admin-operations-smoke-preflight.md`; the production authenticated reviewer browser proof is recorded in `2026-05-01-openplan-production-admin-operations-authenticated-smoke.md`.
- The fresh RC proof packet is recorded in `2026-05-01-openplan-rc-proof-log.md`.
