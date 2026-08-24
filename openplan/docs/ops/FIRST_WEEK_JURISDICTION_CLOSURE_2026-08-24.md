# First-week jurisdiction closure — 2026-08-24

## Verdict

Release v0.30.0. The v0.29.0 fresh-account review found three related setup
problems: California retained the federal interim stage gates, Oregon described
that shared floor too much like local configuration, and Oregon land-use plans
defaulted to California law. Fresh California and Oregon workspaces now reach
the honest configured or neutral outcome from visible entry points.

Tenant screenshots remain local at
`/home/nathaniel/.codex/scratch/openplan-v030-evidence/`. The local database and
smoke-test records are test evidence, not release fixtures.

## Confirmed findings and fixes

- Saving a California home geography did not rebind an automatically selected
  stage-gate template. The geography write now resolves the registry match and
  stores the geography plus California binding in one workspace update.
- The shared US federal floor was described as though it were Oregon's
  configured template. Country-floor copy now names `US-OR`, says no
  subdivision pack is registered, and says the gates do not state requirements
  unique to Oregon.
- The land-use creator relied on selectable-array order and therefore opened on
  California in Oregon. Legal bundle coverage now lives in the registry;
  exactly one match is recommended and every absent or ambiguous match selects
  the neutral **Local requirements not configured** workflow.
- Template provenance was not durable, so an automatic rebind could not be
  distinguished from a planner's deliberate override. The additive nullable
  `stage_gate_template_selection` column records `jurisdiction_matched`,
  `explicitly_requested`, or `interim_unconfigured_default`. Existing rows are
  not backfilled. Geography changes preserve explicit and legacy selections,
  while an optimistic condition refuses concurrent selection changes.
- The first-week regression harness could fill server-rendered sign-in fields
  before hydration replaced them, then wait 90 seconds on an empty submission.
  It now waits for the loaded form and reports visible page state if sign-in
  still cannot leave the route. The dual-model smoke uses the same hydrated
  boundary and targets the active report tab rather than any hidden copy.

No assistant write was added. Workspace geography and stage-gate template
selection remain human-only, and the executable refusal test rejects both as
assistant actions. The migration is additive and changes no RLS policy.

## Fresh browser evidence

The California journey began at the public **Create free workspace** action,
created a new account, chose Nevada County from the dashboard geography setup,
and then opened **Land Use Plans** from the visible sidebar. The dashboard
showed **California Stage-Gate Scaffold v0.1.0** and the creator selected
**California** with the statement that it was recommended from the workspace
home geography.

The neutral journey signed out, created another account, chose Multnomah County,
and opened the same surfaces through navigation. The dashboard showed the US
federal floor with the missing-Oregon-pack disclosure. Land Use Plans selected
**Local requirements not configured** and stated that the checklist does not
claim applicable law. The same state was checked at 390 by 844 pixels.

The Oregon planner then explicitly chose the California stage-gate scaffold,
changed the home geography to Washington County, Oregon, and reloaded. The
workspace remained explicitly bound to California while the land-use creator
remained neutral from Oregon geography. The database recorded the California
workspace as `jurisdiction_matched` and the Oregon override as
`explicitly_requested`.

## Regression and mutation evidence

Each new or changed guard was made to fail for the defect it protects:

- removing California registry coverage or the workspace subdivision read
  broke the California recommendation tests;
- restoring array-order selection broke the neutral and unreadable first-run
  page tests;
- removing the explicit-selection branch, country-floor disclosure,
  automatic California rebind, explicit-choice preservation, clear-to-interim
  reset, or concurrent-change refusal broke its focused binding or route test;
- removing the explicit provenance write from manual rebind or bootstrap broke
  the corresponding route test;
- adding a migration backfill broke the no-backfill guard;
- registering either workspace jurisdiction write as an assistant action broke
  the human-only refusal test;
- removing selection provenance from project/decision projections broke the
  reachability guard;
- changing the harness hydration wait back to `domcontentloaded` broke its
  executable rule and reproduced the empty sign-in submission;
- bypassing the page-wide read-failure collector removed the home-jurisdiction
  failure notice and broke the rendered-page regression;
- recording 218 rather than 219 migrations for v0.30.0 broke both release
  high-water assertions.

A comment-only mutation stayed green, establishing that the guards respond to
behavior rather than any edit.

## Cross-module replay

- Land-use review, withdrawal, second review, exact-hash adoption,
  publication, public map filtering, plan packet, and implementation report:
  PASS.
- RTP cycle, packet generation, registry handoff, and release-review anchor:
  PASS.
- Anonymous engagement submission, moderation, public publication, report
  provenance, and generated HTML: PASS.
- Grant need, opportunity, award, obligation, reimbursement, and closeout:
  PASS.
- Aerial mission, AOI, custody package, project posture, map feature, and
  390-by-844 detail page: PASS. Real ODM processing was not rerun because no
  operator-supplied overlapping photo set was in scope.
- Dual-model selection, frozen report packet, and grant evidence handoff:
  PASS through the external narrative request. The request returned the known
  external `502 narrative_generation_failed` condition, so narrative generation
  is BLOCKED rather than passed; no text was fabricated.

The first parallel replay attempt overloaded the single dev server: RTP timed
out at network idle, Engagement timed out waiting for its success state, and
Land Use aborted a report navigation. Sequential reruns passed those same
steps, so the parallel failures are discarded as harness-load evidence rather
than product findings.

## Exact verification

- First-week evidence rules: 17/17 PASS.
- First-week interruption and resume rules: 17/17 PASS.
- First-week regression outcome rules: 10/10 PASS.
- Browser regression catalog: stage-gate rebind PASS; public-engagement
  regression INCONCLUSIVE because the selected `mapaudit` campaign had no
  public link. The separate hermetic engagement journey passed the public path.
- Full Vitest suite: 1,086 files passed, 1 skipped; 12,400 tests passed, 68
  skipped.
- Live RLS: 8 files, 98 tests PASS. Local migration state retains 151 legacy
  null-provenance workspaces and records provenance on 15 newer workspaces,
  confirming no backfill.
- Python workers: 42 discovered suites PASS across ActivitySim, AequilibraE,
  OCR, and ODM workers.
- ESLint: PASS. Dead-code ratchets: PASS. Production npm audit: 0
  vulnerabilities. Next.js 16 webpack production build: PASS, including
  TypeScript and 122 static pages.
- The combined `qa:gate` shell was interrupted by a Konsole `/bin/bash` crash.
  Its exact lint, dead-code, full-test, live-RLS, audit, and build stages were
  rerun separately and all passed.

## Remaining limits

California remains the only configured land-use legal bundle. Other
jurisdictions retain the shared workflow and disclose that their legal rules
are unconfigured. Safety-by-model crash rates remain deferred because modeled
VMT coverage cannot support a defensible denominator. Agentic control remains
wanted and deferred. Local development and build logs still warn that
`metadataBase` is unset; it affects generated social-card URL resolution, not
the signed-in planner outcomes reviewed here.
