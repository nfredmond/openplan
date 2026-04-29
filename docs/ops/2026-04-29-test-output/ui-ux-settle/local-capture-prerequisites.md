# Local Capture Prerequisites And Existing Tooling

Date: 2026-04-29
Scope: P0 proof-pack preparation only. These notes record what should be true before a future capture run starts.

## Local Prerequisites

Run app commands from `openplan/`:

```bash
corepack pnpm install
pnpm supabase start
pnpm supabase db reset
pnpm seed:nctc -- --dry-run
pnpm dev
```

For the actual future proof-pack capture, after confirming the Supabase URL is local-only, the NCTC seed can be run against local Supabase:

```bash
pnpm seed:nctc
```

Do not run that seed in this preparation lane. It writes Supabase rows and should happen only during an approved local capture pass.

Required local environment:
- `NEXT_PUBLIC_SUPABASE_URL` pointing at the local Supabase API.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` for local auth/client reads.
- `SUPABASE_SERVICE_ROLE_KEY` for local-only demo seeding.
- `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` or `NEXT_PUBLIC_MAPBOX_TOKEN` for `/explore` and map-backed surfaces.

Auth/session note:
- `scripts/seed-nctc-demo.ts` creates or reuses `nctc-demo@openplan-demo.natford.example` but does not set a password in the source code inspected during this prep.
- Establish a local-only browser session through an approved operator method before capture, such as a local Supabase Studio password reset, magic-link flow, or existing local auth storage.
- Do not write passwords, magic links, refresh tokens, or session cookies into this folder.

## Existing Tooling Inspected

Application scripts in `openplan/package.json`:
- `pnpm dev` starts the local Next.js app.
- `pnpm build` builds production Next.js output.
- `pnpm test` runs Vitest.
- `pnpm seed:nctc` seeds the deterministic NCTC demo workspace.
- `pnpm seed:workspace-isolation` seeds local synthetic workspace-isolation fixtures.
- `pnpm ops:check-admin-operations-smoke` performs a non-mutating admin-operations preflight and prints the manual smoke checklist.

QA harness scripts in `qa-harness/package.json`:
- `npm run local-ui-ux-settle-capture` is the local-only read-only capture harness for this manifest. It consumes an existing Playwright storage-state file, refuses production/Vercel base URLs, captures desktop/mobile screenshots for populated local routes, and writes the screenshot ledger under this proof-pack folder.
- `npm run local-workspace-url-isolation-smoke` is a read-only local Playwright browser proof after its local fixture exists. It is useful as an auth/session/browser harness reference, but its route coverage is workspace URL isolation rather than the UI settle route manifest.
- `npm run prod-layout-overlap-audit` captures screenshots and checks visible container overlap, but it creates a production QA user and production QA records. Do not run it for this checkpoint under the no-mutation boundary.
- Other `prod-*` harnesses also create production QA users and records. Treat them as implementation references only unless Nathaniel separately approves a production smoke lane.
- `harness-env.js` centralizes output directory selection, base URL handling, env loading, and optional Vercel protection bypass headers.

Existing screenshot pattern:
- The QA harness uses Playwright `chromium`, fixed browser contexts, and `page.screenshot({ fullPage: true })`.
- Current harness output defaults to `docs/ops/<date>-test-output/`; this settle pack should stay under `docs/ops/2026-04-29-test-output/ui-ux-settle/`.

Exact local capture command from `qa-harness/`:

```bash
BASE_URL=http://localhost:3000 OPENPLAN_UI_UX_STORAGE_STATE=/absolute/path/to/local-storage-state.json \
  npm run local-ui-ux-settle-capture
```

Optional local-only overrides:
- `--viewports desktop,mobile` limits or expands the viewport set supported by the harness.
- `--route <route-key>` can be repeated to capture a smaller local slice.
- `OPENPLAN_UI_UX_SETTLE_OUTPUT_DIR=docs/ops/<local-output-dir>` may redirect output, but only inside `docs/ops/`.
- `--allow-local-network` permits an explicit private local base URL such as `http://192.168.x.x:3000`; Vercel URLs remain refused.

## Safe Capture Path

For this UI settle proof pack, the safest executable path is:
1. Use local Supabase and local Next.js only.
2. Seed deterministic NCTC data locally.
3. Establish a local browser session for the demo workspace without storing credentials.
4. Capture the route queue in `capture-manifest.md` at `desktop` and `mobile`; add `tablet` only where the layout changes materially.
5. For routes not populated by the NCTC seed, record the missing fixture as a dependency instead of accepting empty screenshots.
6. Run `git diff --check` after docs are updated.

## No-Go Checks

Do not proceed with capture if any of these are true:
- `BASE_URL` is not `localhost` or `127.0.0.1`, unless it is an explicit private local URL and `--allow-local-network` is documented in the ledger.
- `BASE_URL` points at Vercel or production.
- No already-authenticated local Playwright storage state is available. The harness should produce a missing-auth prerequisite report instead of attempting login or credential extraction.
- The output directory is outside `docs/ops/`.
- The app points at production Supabase.
- The Mapbox token is missing for map-route proof.
- The page is still loading, signed out, or showing workspace-membership-required state for a route that is meant to prove populated workspace UX.
- The route requires a plan, program, report, scenario, grant, or dataset fixture that is not present.
- The only available tooling path is a production harness that creates QA users or records.
