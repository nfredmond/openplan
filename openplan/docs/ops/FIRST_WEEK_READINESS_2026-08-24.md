# First-week readiness closure — 2026-08-24

## Verdict

Release v0.29.0. Fresh-account review found user-visible dead ends, the fixes
survived new-workspace reruns, and every completed journey reached its named
planner outcome without constructing routes by hand. Lower-severity findings
remain in [the dated work list](FIRST_WEEK_READINESS_WORK_LIST_2026-08-24.md).

Tenant screenshots and raw agent runs remain local under
`/home/nathaniel/.local/state/openplan/first-week-runs/`; they are not part of
the repository or release artifact.

## Fresh-context evidence

The complete baseline run at `2026-08-24T07-18-50-771Z` completed all seven
jobs with zero blocked or failed jobs. The harness confirmed 9 findings and
discarded 6 whose submitted evidence did not establish the claim. Account and
California setup, neutral Oregon setup, public engagement, and the shared
corridor workflow reached their outcomes. Project intake and safety evidence
were incomplete. The land-use journey correctly refused to invent real legal
completion dates, so deterministic exercise evidence covers the mechanics
instead of weakening the operative workflow.

The affected-journey run at `2026-08-24T08-22-15-277Z` completed setup,
project, and safety jobs with zero blocked or failed jobs. It confirmed the
earlier safety corrections and exposed three remaining dead ends: no reviewed
CSV-to-project path, no project-visible corridor handoff, and no PDF download
from the report preview.

The post-fix run at `2026-08-24T08-58-52-418Z` completed the same three jobs
with zero blocked or failed jobs. From visible navigation, the planner reviewed
`projects.csv`, applied the selected candidate's name, description, $4.2 million
cost, currency, and source; attached the corridor through the project map;
generated, previewed, and downloaded the board packet PDF. Setup reached its
outcome. Safety produced ranked KSI and community-context evidence, refreshed a
stale packet, and downloaded the PDF; its remaining road-name and basemap gaps
are recorded limitations, not invented evidence.

## Confirmed fixes

- Interrupted first-week runs now record quota exhaustion, server loss,
  timeouts, and missing reports as resumable blocked or unfinished states.
  Completed jobs are retained when a run resumes, and Codex fallback sessions
  use isolated user context and the browser-only contract.
- Corridor setup uses the geography submitted on the first click. Safety
  packets retain valid crash evidence when an optional screen fails, detect
  evidence added since generation, and render ranked KSI concentrations with
  limited Census-tract community context.
- A project can store and index a CSV, map its columns, review one candidate,
  and apply identity, planning-level cost, currency, price year, and source in
  one existing-project write. The project map points to the existing corridor
  upload, and the report Packet tab exposes the generated PDF download.
- Generated HTML uses the report-artifact bucket's registered `text/html` MIME
  type. This closed the fresh local engagement-to-report failure.
- The project Funding surface now fits a 390-pixel viewport. Browser
  measurement changed the cost panel from a 459-pixel scroll width inside a
  344-pixel body to 344/344, with no clipped file control.

No new assistant write was introduced. The project change extends the existing
project PATCH and Knowledge Base upload paths, so the action registry gained no
silent write surface. The three schema changes are additive, tenant-scoped, and
covered by live RLS proof.

## Regression journeys

- Land-use review, withdrawal, second review, exact-hash adoption, publication,
  public map field filtering, plan packet, and implementation report: PASS at
  desktop and mobile widths.
- RTP cycle, board packet generation, registry handoff, and release-review
  anchor: PASS.
- Anonymous engagement submission, moderation, public publication, report
  provenance, and HTML artifact: PASS after the exact MIME correction.
- Grant need, opportunity, award, obligation, reimbursement, closeout, and
  project posture: PASS.
- Dual-model agreement packet reached the grant draft. The external narrative
  request was BLOCKED, not passed: the configured Anthropic account reported
  its usage limit and a 2026-09-01 UTC reset. No output was fabricated.
- Aerial mission, AOI, custody package, project posture, map feature, and
  390-by-844 detail page: PASS with no console or page errors. Real ODM
  orthophoto processing was NOT RUN because this checkout had no known genuine
  overlapping photo set and no proved worker; the deterministic custody and
  evidence seams did run.

The generated cross-module smoke records live in the repository's top-level
`docs/ops/` directory. Their tenant screenshots remain ignored and local.

## Mutation evidence

Each new or changed regression was made to fail against the defect it guards:

- removing quota detection, resume isolation, or the new-workspace output root
  failed the corresponding first-week harness rule;
- restoring the stale corridor-geography read, allowing failed safety screens
  to clear evidence, or removing KSI/community rows failed their focused route
  or report regression;
- dropping the CSV-applied project name, breaking the corridor link, removing
  the PDF action, reverting `text/html` to `text/html; charset=utf-8`, or
  reintroducing the narrow project grid failed by the intended assertion;
- removing v0.29.0 from the release-ordering table failed because three
  migrations would sit beyond the recorded latest release.

The initial full release gate also failed usefully: it found the new project
editor missing from the inline-write-form census, then found four TypeScript
integration errors that transpile-only unit tests could not see. The form is
now explicitly classified under R2 as an existing-project editor; the final
typecheck and build pass without weakening either guard.

## Exact verification

- First-week evidence rules: 17/17 PASS.
- First-week interruption and resume rules: 17/17 PASS.
- First-week regression outcome rules: 9/9 PASS.
- Focused release and changed-surface tests: 109/109 PASS.
- Full Vitest suite: 1,082 files passed, 1 skipped; 12,376 tests passed, 68
  skipped.
- Live RLS: 8 files, 98 tests PASS.
- Python workers: 28 discovered `test_*.py` suites, 28 PASS using the worker
  virtual environment.
- ESLint: PASS with zero warnings. Dead-code ratchets: PASS. Production npm
  audit: 0 vulnerabilities. Next.js 16 webpack production build: PASS,
  including TypeScript and 122 static pages.
- Desktop and phone browser walks: affected project, Safety, Reports, land-use,
  engagement, RTP, grants, and aerial pages inspected from visible entry
  points. No affected mobile page retained horizontal overflow after the
  project grid correction.

## Remaining limits

Safety-by-model crash rates remain deferred: modeled VMT coverage still cannot
support a defensible denominator. California remains the only configured
land-use legal bundle; the neutral workflow discloses that other legal rules
are not configured. Road labels require a provenance-carrying geocoder, and a
printable street background requires a frozen open-data renderer. Worker
liveness still relies on explicit deployment posture rather than a heartbeat.
Agentic control remains wanted and deferred; this closure did not begin it.
