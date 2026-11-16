# OpenPlan QA Harness

Purpose: keep one-off but reusable production QA scripts outside the app runtime while preserving the exact evidence-generation path used for ship-critical checks.

## The first-week harness — read `FIRST-WEEK-HARNESS.md`

Everything else in this directory checks something somebody already thought of.
The first-week harness is the one that does not: it hands a **fresh agent with
no repository context** a planner's job written as an outcome, and a real
browser, and records where it got stuck. It exists because twenty minutes of
Nathaniel using OpenPlan produced a better defect list than eleven thousand
tests had, and he is not a repeatable instrument.

- `first-week-discovery.js` — the discovery layer. Runs the jobs in
  `first-week-jobs/*.job.md`, one child agent each, and verifies every reported
  finding against its own screenshot and page snapshot before a person reads it.
  Local-only, no override. Not a gate — it produces a work-list.
- `first-week-evidence.js` / `first-week-evidence.test.js` — the evidence rule
  and its unit test. No browser, no server. A finding with no evidence, or one
  contradicted by the page tree it attached (the did-not-scroll failure), is
  discarded and counted rather than investigated.
- `first-week-regression.js` — the regression layer. One deterministic script
  per confirmed dead end in `first-week-regressions/*.regression.js`, each
  required to name the run it came from. Cheap, and the only thing that keeps a
  fixed problem fixed.

## First proven job: one repeatable journey

`first-job-journey.js` drives one place through the whole first job on screen:
sign up, confirm by email, project, study place, crash retrieval, high-injury
network, safety plan report, countermeasures, a saved BCA from stored crashes,
a campaign with public comments, moderation, an approved staff review, the
report PDF, SS4A tracked, seeded, six sections typed and finalized, a budget document
attached, the SS4A PDF, sign out, then a second account asks for the first
account's report and application. It uses `puppeteer-core` and axe-core 4.11.1
from `openplan/node_modules` (axe-core is not a declared dependency). It never
uses a service-role key, never writes to the database and never calls an API in
place of a screen step; it only reads responses the screens request, for ids.

- `--mode rehearsal` runs on a local origin only (the local guard in
  `harness-env.js`). `--mode proof` runs on the hosted proof origin only
  (`PROOF_ORIGIN` in `openplan/scripts/ops/capability-evidence.mjs`) and also
  needs `--inputs`, `--budget-file` and `--expected-commit`, so rehearsal values
  never enter a proof.
- Workspace names: `organization` names the first account's workspace and
  `secondOrganization` the second account's. A file that sets the first must
  set the second, and the second may not contain the first, because the
  cross-workspace check searches what the second account sees for the first
  workspace's name. With neither set, the names are the place plus a label.
- Inputs: a JSON file of what a planner types, including the six SS4A section
  texts and the facts behind them (each with its source and the date read).
  The script types each text into the section's "Final text" box and saves it
  as final, refuses text that still holds `[VERIFY]` or `[OPERATOR: ...]`,
  and records each text's SHA-256 and the screen's unverified count after
  saving (must be 0), plus the export's DRAFT stamp text if any. Rehearsal
  without `--inputs` uses `fixtures/first-job-rehearsal-inputs.json`, whose
  section texts start "Rehearsal text, not an application." Proof mode refuses
  any inputs file that carries that label.
- The campaign is a demonstration (since November 16, 2026). The inputs carry
  `campaign.title` and `campaign.invitation`, each saying "Demonstration by
  an automated OpenPlan proof run", and the invitation needs a sentence the
  title lacks. Every entry of `comments` says it was entered by an automated
  proof run and represents no one. The campaign, comments, review reason and
  staff review text hold no email address, DRAFT or `[VERIFY]` marker. The
  validator refuses anything else in both modes, and refuses the old
  `campaignTitle` field.
- Before activation the journey replaces the template's public description
  with the invitation (Setup tab, "Public-facing description"), then reads
  the portal and its about page as an anonymous participant at 1440 and
  390 px. It stops unless each shows the invitation and none shows the
  template's "We are studying traffic safety in this area" or any other
  sentence of the text the campaign was created with. The run file keeps the
  readings (`demonstrationText`).
- Close at the end: finished or stopped early, the journey sets the campaign
  to Closed in its settings form and reads the portal, its about page and the
  public portal data as a participant; the pages must show only the ended
  notice and none of the campaign's title or comments. The run file's
  `close` says whether it tried and whether it worked, and a close that did
  not work fails the run.
- The run file also records `mode`, `harness` (the `git rev-parse HEAD` of
  the checkout the script ran from, and `clean`: no tracked file changed) and
  the SHA-256 of the inputs and budget files typed (`inputsSha256`,
  `budgetSha256`). A proof refuses to start from a checkout with changes.
- Confirmation: the link is never an argument. When sign-up asks for
  confirmation the script waits for the file named by `--confirm-link-file`
  (and `--second-confirm-link-file` for the second account), opens the link and
  records only a SHA-256 of its token.
- Each key screen is checked at 1440 and 390 px, light and dark: screenshot,
  console errors (scrubbed), page-level horizontal scroll and serious or
  critical axe nodes (tags wcag2a, wcag2aa, wcag21a, wcag21aa).
- Each PDF: SHA-256, bytes, pages, DRAFT stamp, the page of each of the five
  items, and the page and line of any email address. Text items are found
  with `findPdfPhrase` from `openplan/scripts/lib/pdf-text-match.mjs`, the
  matcher the record checker re-reads with; the record keeps each item's
  page and the heading searched. The map is found by its heading and a
  highlight-red pixel count (`pdftoppm`).
- Poppler only. The script and the checker read pages through
  `openplan/scripts/lib/poppler-text.mjs`, which refuses a `pdftotext` or
  `pdftoppm` that is not Poppler's. In Git Bash on Windows, Git's
  `/ucrt64/bin` puts xpdf first: put Poppler's `Library/bin` first on PATH.
- It stops at the first step whose expected state is missing and writes
  `journey-<role>.json` with the furthest step passed. A step never passes by
  skipping.
- The campaign's public address: the run file and the record hide it (its
  share token is a secret). The journey writes it to `public-address.txt` in
  the run folder and nowhere else, so the operator can check the closed page
  independently: after the run, open that address in a fresh browser session
  (no sign-in), confirm it shows only that the comment period has ended, then
  delete the file. Never commit it or copy it into a record. The engagement
  journey writes the same file.

```bash
# rehearsal, from qa-harness/ (local stack and dev server already running)
node first-job-journey.js --mode rehearsal --base-url http://localhost:3450 \
  --place-query "Sierra County, CA" --place-kind county --role california-county \
  --email journey-1@openplan.test --second-email journey-2@openplan.test \
  --confirm-link-file ../../journey-confirm-1.txt --second-confirm-link-file ../../journey-confirm-2.txt \
  --out ../../journey-runs/sierra-1
# --place-query is the full label the place search shows, matched exactly:
#   "Lincoln County, NV", "Pyramid Lake Paiute Reservation, NV"
# proof: same, with --mode proof --base-url <the hosted origin> --inputs <sourced inputs JSON>
#   --budget-file <budget document> --expected-commit <40-character commit>
# assemble three journeys into one record for the evidence checker
node first-job-journey.js --assemble --journeys a.json,b.json,c.json --commit <40 hex> \
  --base-url <the hosted origin> --out record.json
# --assemble refuses a run made on another origin, a run that stopped, a run
# that names another expected commit, and under the hosted origin a rehearsal
# run or one with no expected commit (review 59). Since lane 65 it also
# refuses a run that left its campaign open or names no harness checkout, and
# under the hosted origin one run from a checkout with changes; it carries
# each run's mode, close and harness into the record. The checker requires
# all three of records dated from 2026-11-16 (the job's newRecordRules).
npm run check:first-job-journey   # unit tests; the PDF tests need Poppler
```

## Second proven job: the engagement journey

`engagement-job-journey.js` runs one place through the engagement job
(`engagement-campaign-review-and-response-in-three-places` in
`schemas/proven_job_definitions.v1.json`) on screen, with the first journey's
guards: rehearsal on a local origin only, proof on the hosted proof origin
only, the confirmation link read from a file, health readbacks against
`--expected-commit`, axe-core 4.11.1 at 1440 and 390 px in light and dark, the
shared PDF matcher and Poppler reader, and a run file with no email address
and no secret. Per journey:

- A staff account signs up and confirms, makes a project, sets its place by
  the full label the search shows, records a proposed decision, and creates
  and activates a campaign. The campaign's title and invitation must say
  "Demonstration by an automated OpenPlan proof run", in both modes.
- Before activation the journey replaces the template's public description
  with the invitation (Setup tab, "Public-facing description"). As an
  anonymous participant it reads the portal and its about page at 1440 and
  390 px, and later both review PDFs, and stops unless each page and page 1
  of each PDF shows the invitation and no surface, on any PDF page, shows the
  template's "We are studying traffic safety in this area" or any other
  sentence of the text the campaign was created with. The run file keeps the
  readings (`demonstrationText`). A journey that stops before it has a public
  link closes the campaign and records it as closed and never public.
- Anonymous participants, each in a fresh browser context: one map point and
  one comment with no map point at 1440 px by pointer, one contribution at
  390 px with the keyboard only (Tab, Enter, Space; the focus trail is saved),
  and one comment that staff then reject. The kind recorded is what the
  portal sent (a point or none), not what the script meant to send.
- Staff approve three and reject one, each with a review reason that must be
  in the request; correct and approve the staff review so one group holds the
  two comments the response will answer; publish the response linked to those
  comments; link it to the decision and the group.
- Staff request the internal and public review files and wait for the
  document-export worker (`--export-timeout-minutes`, default 15).
- Counts: received, approved, withheld, published responses and answered are
  read from both PDFs (their count sentences), both workbooks (Summary rows
  and the cells the checker counts) and the public response page (the
  Comments and "You said / We did" tabs and the "Answers these comments"
  links) at both widths and modes. Any disagreement with the journey's own
  counts stops the run.
- The rejected comment's text and id are searched for in the public PDF, every
  cell of the public workbook, the portal and response pages (text and HTML)
  and every same-origin response those pages fetched. The same search must
  find the text in the internal PDF and workbook, or the run stops: a search
  that cannot find it where it is would pass a leak too.
- Axe on the portal, the public response page and the four staff campaign
  tabs. An anonymous participant asks for the campaign, its items and both
  internal downloads (401, 403 or 404 expected) and reads the public portal
  API for staff-only field names. A second account asks for the same
  downloads and the campaign (data checks) and opens the staff campaign page
  (page check).
- Close at the end: finished or stopped early, the journey sets the campaign
  to Closed in its settings form and reads the portal and its about page as a
  participant; both must show only the ended notice. The run file's `close`
  says whether it tried and whether it worked, and a close that did not work
  fails the run. The public address goes to `public-address.txt` in the run
  folder, as for the first job: read it once in a fresh session after the
  run, then delete it.
- No AI feature is used, and the run file says so.

Inputs: `--inputs` names a JSON file of every string typed
(`fixtures/engagement-job-rehearsal-inputs.json` shows the shape). Every
comment must say it was entered by an automated proof run and represents no
one; no string may hold an email address, DRAFT or a `[VERIFY]` marker; the
comment to be rejected must not contain, or be contained in, any other string.
A proof refuses the rehearsal fixture.

```bash
# rehearsal, from qa-harness/ (local stack, dev server, document-export worker and mail catcher running)
node engagement-job-journey.js --mode rehearsal --base-url http://localhost:3482 \
  --place-query "Coos County, OR" --place-kind county --role county \
  --email staff-1@openplan.test --second-email second-1@openplan.test \
  --confirm-link-file ../../confirm-1.link --second-confirm-link-file ../../confirm-2.link \
  --out ../../engagement-runs/county
# roles and place kinds: county (county), city-or-town (city or cousub), tribal-area (aiannh)
# assemble three journeys into one record for the evidence checker
node engagement-job-journey.js --assemble --journeys a.json,b.json,c.json --commit <40 hex> \
  --base-url <the hosted origin> --out record.json
# --assemble applies the first job's run rule and also refuses a run that left
# its campaign open; it carries each run's mode and close into the record and
# names each participant refusal's journey (review 59)
npm run check:engagement-job-journey   # unit tests, and review 59's changed copies of the dress rehearsal
```

## Third proven job: the ATP application journey

`atp-job-journey.js` runs one place through the California Active
Transportation Program job (`california-atp-application-in-three-places` in
`schemas/proven_job_definitions.v1.json`) on screen, with the other journeys'
guards: rehearsal on a local origin only, proof on the hosted proof origin
only, the confirmation link read from a file, health readbacks against
`--expected-commit`, axe-core 4.11.1 at 1440 and 390 px in light and dark, the
shared PDF matcher and Poppler reader, and a run file that never holds an
address, a token or a password. The steps it shares with the first job's
journey (sign-up, the project, the study place, crash retrieval, the screen
readings) are in `journey-browser-lib.js`. Per journey:

- An account signs up and confirms by the emailed link only, makes a project
  with the inputs' demonstration name, and sets its place by the full label
  the search shows. The role is `county`, `city` or `tribal-area`, each held
  to the definition's rule. For the tribal area the journey records the
  Census states the search answer listed (its state code and the letters that
  close its label) and stops unless both are exactly California.
- It retrieves crashes and stops unless the retrieval names California's
  crash file (the name the definition's Appendix B fact gives), stored at
  least one crash and stored no more than it reported. The record states the
  years as the export prints them.
- It runs the corridor analysis the ATP packet reads its screening scores
  from, linked to the project, and records whether the run retrieved Census
  tract data (retrieved, none retrieved, or not recorded by the run). The job
  does not require tract data.
- It tracks the ATP from its catalog card and sets the application up. The
  template picker must start on ATP without the journey choosing it; the
  request must carry catalog key `atp`; the application must list the 2027
  template's ten sections and 26 checklist rows in order.
- It types each section's text into its "Final text" box and saves it as
  final. No draft is asked for: the journey counts draft requests and reads
  the application back for a stored draft.
- It marks each row the inputs call not applicable, with its reason as the
  row's note, and leaves every other row outstanding. Nothing is attached. It
  then reads all 26 rows back from a fresh load of the screen.
- It exports the application PDF and downloads it. The count of required
  attachments outstanding must be one number in the inputs, the rows on
  screen, the export panel, the export's answer, the export result on screen
  and the PDF's DRAFT stamp.
- It reads the PDF back with the shared matcher: the study place line and
  "Applicant not entered in OpenPlan" on the cover and in Appendix A, the
  program, the ten section titles in order, every section final and opening
  with the demonstration label, the fixed note in Questions 5 and 7 only, the
  six appendix headings with their facts, the crash source, years and
  reported count as whole values, the screening score labels, the two
  sentences only the tribal area's PDF prints, and no phrase the definition
  refuses ("to be provided" among them).
- Axe on the Project, Safety, Corridor Analysis and application screens. The
  owner asks for its own application and PDF (200 expected), then a second,
  confirmed account reads its own workspace (200) and is refused the
  application, the PDF and the project page.
- The job opens no public page. A request that would make an engagement
  campaign or a share link stops the journey.

The journey applies the definition's per-journey rules as the checker will.
A proof stops on a refusal. A rehearsal records it as a finding and goes on,
and the run file lists what the checker would refuse (`definitionRefusals`).

Inputs: `--inputs` names a JSON file (`fixtures/atp-job-rehearsal-inputs.json`
shows the shape, for one place). It carries `projectName` (with the
demonstration label), `projectSummary`, `organization` and
`secondOrganization` (demonstration names), `sections` (the template's ten
keys, each text opening with "Demonstration by an automated OpenPlan proof
run" and a sentence that the named agency or tribe did not prepare it),
`checklist` (every one of the template's 26 row keys, `outstanding` or
`not-applicable` with a `reason`), `requiredAttachmentsOutstanding` and
`facts` (statement, source, date read). `role`, `placeKind`, `placeQuery` and
`placeGeoid`, when present, must be the run's own. `planType` and
`analysisQuestion` are optional. The validator refuses, in both modes, a
section key the template lacks or a missing one, text without the
demonstration sentence, an email address, a `[VERIFY]` marker, a placeholder,
the word DRAFT, a phrase the definition refuses, a checklist key the template
lacks, a not-applicable row without a reason, and an attached row. A proof
also refuses the rehearsal fixture.

```bash
# rehearsal, from qa-harness/ (local stack, dev server and mail catcher running; Poppler on PATH)
node atp-job-journey.js --mode rehearsal --base-url http://localhost:3530 \
  --place-query "Trinity County, CA" --place-kind county --role county \
  --email owner-1@openplan.test --second-email second-1@openplan.test \
  --confirm-link-file ../../confirm-1.link --second-confirm-link-file ../../confirm-2.link \
  --out ../../atp-runs/county
# roles and place kinds: county (county), city (city), tribal-area (aiannh)
# proof: --mode proof --base-url <the hosted origin> --inputs <sourced inputs JSON>
#   --expected-commit <40-character commit> --executor-agent <harness> --executor-model <model id>
# assemble three journeys into one record for the evidence checker
node atp-job-journey.js --assemble --journeys a.json,b.json,c.json --commit <40 hex> \
  --base-url <the hosted origin> --root <folder the record's PDF paths are relative to> --out record.json
# --assemble refuses a run of another job, a run made on another origin, a run
# that stopped, a run that names another expected commit or no harness
# checkout, and under the hosted origin a rehearsal run, a run with no
# expected commit or one from a checkout with changes
npm run check:atp-job-journey   # unit tests
```

## Current scripts
- `openplan-local-workspace-url-isolation-smoke.js` — read-only browser smoke for local synthetic workspace A vs workspace B URL isolation. It signs in synthetic users from a fixture, verifies each user can load its own workspace-scoped URL, verifies the other user is denied, verifies the denied session still loads its own workspace URL afterward, and rejects leaked page text. It refuses non-local base URLs by default and does not seed or mutate Supabase data.
- `openplan-local-ui-ux-settle-capture.js` — read-only local Playwright capture harness for the UI/UX settle route manifest. It requires an already-authenticated local Playwright storage state, refuses production/Vercel URLs, captures desktop/mobile screenshots for populated local routes, and ledgers fixture-required routes instead of accepting empty-state proof.
- `openplan-local-rtp-release-review-smoke.js` — local browser/API smoke for RTP cycle creation, board-packet creation, artifact generation, registry linked-packet navigation, and report-detail release-review anchor landing.
- `openplan-local-grants-flow-smoke.js` — local browser/API smoke for the Grants OS flagship flow: project funding need, awarded opportunity, committed award, project RTP posture write-back, obligation milestone, paid reimbursement invoice, closeout reconciliation, closeout milestone, and project-detail funded/reimbursed posture.
- `openplan-local-engagement-report-handoff-smoke.js` — local browser/API smoke for public portal feedback submission, pending moderation persistence, staff approval, public feedback publication, handoff report provenance, generated HTML packet verification, and artifact source-context traceability.
- `openplan-local-analysis-report-linkage-smoke.js` — local browser/API smoke for the Analysis flow: corridor run-template model, managed run launch, persisted source analysis output, scenario attachment, Analysis Studio deep link, analysis-summary report linkage, generated artifact, and artifact source-context traceability.
- `local-spine-smoke.js` — local-only NCTC seed/API/browser smoke proving one canonical project flows through RTP, grants, engagement, analysis/county-run, reports, map, Data Hub, and aerial evidence rows without duplicate project creation. Before creating its report, it removes prior harness-owned `NCTC Phase 1 Spine Smoke%` reports and dependent report rows in local Supabase.
- `local-aerial-evidence-smoke.js` — local-only Aerial evidence spine smoke. It refuses hosted URLs, creates a hermetic QA user, workspace, project, mission, AOI, and ready evidence package, verifies the resulting aerial posture counts, renders `/aerial` and mission detail, and confirms the map AOI feature without relying on a named-place fixture.
- `local-aerial-ortho-render-smoke.js` — local-only real processing proof. It requires an operator-supplied directory of genuine overlapping mission photos, uploads them through the mission UI, dispatches the self-hosted v1.1 ODM worker, waits for held preview custody, verifies the signed PNG bytes and SHA-256, and renders the preview on both the mission map and planner-selected shared Aerial map. It never commits the source photos, coordinates, or screenshots.
- `map-reading-geometry.test.js` — no browser, no server. Verifies the rectangle arithmetic in `map-reading-geometry.js` against the cartographic shell's own CSS box geometry at 1920x1080: with the page panel showing, under a quarter of the window is map (~13%); with map-reading mode on, over 60% is. Run it with `npm run check:map-reading-geometry`.
- `openplan-local-map-reading-audit.js` — local signed-in Playwright audit of the same question against a real page. It measures every element painting over the map by computed style (not by selector, so a hidden panel counts as hidden), presses the "Read the map" control by keyboard, and asserts the uncovered map area clears the floor, the page panel is `inert`, the layers panel survives, and Escape brings the page back. jsdom has no layout, so this is the only check that can see the covered fraction at all. Needs `OPENPLAN_BASE_URL`, `OPENPLAN_MAP_READING_EMAIL` and `OPENPLAN_MAP_READING_PASSWORD`.
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
npm run check:local-guards
npm run check:workspace-isolation-fixture
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
npm run local-analysis-report-linkage-smoke
npm run local-spine-smoke
npm run local-aerial-evidence-smoke
OPENPLAN_AERIAL_SMOKE_PHOTOS_DIR=/absolute/path/to/photos npm run local-aerial-ortho-render-smoke
npm run check:map-reading-geometry
npm run check:first-week-evidence
OPENPLAN_BASE_URL=http://localhost:3200 OPENPLAN_FIRST_WEEK_EMAIL=you@example.test \
  OPENPLAN_FIRST_WEEK_PASSWORD=… npm run first-week-discovery
OPENPLAN_BASE_URL=http://localhost:3200 OPENPLAN_FIRST_WEEK_EMAIL=you@example.test \
  OPENPLAN_FIRST_WEEK_PASSWORD=… npm run first-week-regression
OPENPLAN_BASE_URL=http://localhost:3000 OPENPLAN_MAP_READING_EMAIL=you@example.test \
  OPENPLAN_MAP_READING_PASSWORD=… npm run local-map-reading-audit
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
- Uses `harness-env.js` for repo-root discovery, env loading, canonical base URL selection, mutating-local target guards, and optional Vercel protection bypass headers.
- Reads OpenPlan env from `OPENPLAN_ENV_PATH`, `openplan/.env.local`, or repo-root `.env.local` (first match wins).
- `OPENPLAN_BASE_URL` is REQUIRED for any proof that targets a deployment — OpenPlan has no canonical hosted instance, so you always name your own.
- Mutating local smokes guard both the app URL and Supabase URL before any service-role auth/REST mutation. They allow loopback/local targets such as `localhost` and `127.0.0.1`, and refuse Vercel, `*.supabase.co`, and arbitrary remote hosts.
- Mutating local smokes are safe to rerun only against local Supabase. The NCTC spine/aerial smokes clean their own deterministic harness rows before writing fresh proof rows; the timestamped RTP, Grants, Engagement, and Analysis smokes intentionally create fresh local QA users/workspaces/records unless the local database is reset or cleaned manually.
- If Vercel Authentication is enabled, set `VERCEL_AUTOMATION_BYPASS_SECRET` (or one of the accepted bypass env aliases in `harness-env.js`) so Playwright contexts can reach the protected deployment.
- OpenPlan also auto-loads `secrets/openplan_vercel_protection_bypass.env` from the workspace root when present, so canonical proof runs can use the secure local bypass path without copying the secret into app env files.
- Uses Playwright in headless mode.
- **A closed tab can still be in the DOM, hidden, so `getByText(...).first()` is a trap on any tabbed
  page.** Since 2026-10-02 `PageTabPanel` wraps each tab in React's `Activity`: the server leaves closed
  tabs out of the HTML, then React renders them hidden (`display: none`) once the page is running, so
  form drafts survive a tab switch. Playwright's `.first()` takes DOM order, not visibility, and can lock
  onto a hidden copy in an earlier panel. That kept `QA Harness Nightly` red from 2026-08-05 through
  2026-08-15, on `/Funded/i` matching the hidden Overview badge instead of the visible Funding one.
  **Scope to the panel you mean**:
  `page.locator('[data-page-tab-panel="funding"][data-page-tab-panel-state="open"]')`. That also
  asserts the deep link landed where it said it would. Name the panel, because several tabs carry the
  same words. A smoke that navigates straight to a record page should ask for its tab (`?tab=record`).
- The UI/UX settle capture harness never logs in, creates users, seeds data, writes Supabase rows, touches billing/email, or persists credentials/tokens. It consumes an existing local storage-state file only for the Playwright browser context.
- The UI/UX settle capture harness accepts `BASE_URL` values on `localhost` or `127.0.0.1` by default. It always refuses Vercel URLs. Use `--allow-local-network` only for explicit private local URLs such as `192.168.x.x`, and record that choice in the generated ledger.
- The UI/UX settle capture harness writes only under `docs/ops/2026-04-29-test-output/ui-ux-settle/` unless `OPENPLAN_UI_UX_SETTLE_OUTPUT_DIR` or `--output-dir` points to another directory under `docs/ops/`.
- The local workspace URL isolation fixture is a template: replace placeholder IDs/text with records from a local synthetic seed and export the password env vars before running it. Every check must include `allowedText` and `leakText`; every denied user must also have an own-workspace URL check so the harness can prove session continuity after a cross-workspace denial. When user entries include `workspaceName`, denied users must belong to a different workspace name than the allowed user.
- Intended for controlled operator use, not CI.
- Production smoke scripts create real production QA users/workspaces/records unless their description says read-only. Run cleanup after proof so production residue does not accumulate.
- `openplan-prod-qa-cleanup.js` is intentionally non-destructive by default; use `--apply` only after reviewing the printed plan.
