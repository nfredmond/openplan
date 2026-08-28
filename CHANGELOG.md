# Changelog

What changed in OpenPlan, written for whoever operates a deployment rather than
for whoever wrote the code. Each entry says what is new, and — where it matters
— what you have to do about it.

**Upgrading, in short:** pull the new code, run
`npm exec -- supabase migration up --linked` **before** the app deploys, then
deploy. That order matters; see the note under 0.2.0. **If you are upgrading from
0.2.0 or earlier, read the security note under 0.3.0 first** — that fix lives
entirely in the migrations, so it takes effect as soon as they run.

OpenPlan uses [semantic versioning](https://semver.org). While the major version
is `0`, the database schema is still changing in ways that need care on upgrade —
which is exactly what a `0.x` version is for. `1.0` will mean the schema is
stable enough to promise smooth upgrades indefinitely.

---

## Unreleased

## 0.40.0 — 2026-08-28

**Migration required.** Run `npm exec -- supabase migration up --linked`
before deploying the app. Migration
`20260828000003_model_validation_structural_diagnosis_custody.sql`
(`model_validation_structural_diagnosis_custody`) adds append-only custody for
one exact structural-diagnosis artifact bound to the same workspace, run,
inconclusive assessment, and assessment hash. Members may read it; only the
service role may create it; custody rows and bound artifacts reject mutation
and deletion.

OpenPlan now publishes the assignment-blind structural diagnosis of the frozen
v0.39 seven-county instrument. The diagnosis measures missing usable
coordinates, full-link versus centroid distance, candidate counts, name and
facility evidence, ambiguous lineage, exclusions, and genuine network absence
without opening model output or changing a match. Only after all seven frozen
readiness gates pass does it inspect loaded, zero-volume unloaded, and absent
output rows and compare AequilibraE with ActivitySim on identical frozen links.
Raw method values, differences, and ratios remain separate; there is no average,
ranking, winner, calibration, new threshold, or opened acceptance holdout.

Every county/method artifact uses
`openplan.model-validation-structural-diagnosis.v1` and binds the exact release
source, preregistration, network, observation package, match audit, model
output, comparison basis, assignment profile, and existing assessment. The
evidence ledger keeps model year, day/period, direction, vehicle/PCE basis,
population vintage, and coefficients `unknown` when the frozen artifacts do
not prove them.

The existing Models assessment panel now explains “Why this is inconclusive,”
shows the full diagnosis hash, and downloads the exact artifact. The same hash,
findings, unknown facts, and unchanged scientific outcome travel into cited
reports, assistant evidence, and project evidence bundles. First-week job 11
now requires that visible diagnosis journey. The Models landing page also shows
the completed frozen study and provides authenticated, hash-bearing downloads
of the exact study result, report, and fourteen county/method diagnosis files.
California and nationwide model validation remain `partial`.

## 0.39.0 — 2026-08-28

OpenPlan now has a frozen seven-county development validation instrument. Each
county preserves one exact polygon, subdivision set, national and state source
attempt, observation package, network, and assignment-blind match audit. The
pre-volume audit cannot read model volumes and binds the exact network,
observations, preregistration, and matcher version before either baseline is
evaluated.

The sealed runner refused to reveal any model output until all seven county
packages passed custody. It then reused each county's exact network,
observation package, and match audit for unchanged AequilibraE and ActivitySim
runs. Both methods remain separate. Unproved model year, day basis,
coefficients, population vintage, and acceptance rule remain `unknown`.

All fourteen county/method assessments are scientifically `inconclusive`.
There was no frozen use-specific acceptance rule and no decisive fully
comparable observation. Two counties had no matched links; several matched
links were unloaded; and raw diagnostic error varied sharply where a
comparison was possible. These findings did not change defaults, calibrate a
candidate, open an acceptance holdout, or support a California or nationwide
accuracy claim.

The existing Models assessment now shows the frozen network, observation
package, and pre-volume audit hashes beside the comparison-basis and model
output hashes. California and nationwide capability remain `partial`.

## 0.38.1 — 2026-08-28

The California instrument-readiness test now resolves its script import from
the test file's location. This fixes the modeling-script CI job when it runs
each suite from `scripts/modeling/tests`; v0.38.0's product behavior and data
contracts are unchanged.

## 0.38.0 — 2026-08-28

**Migrations required.** Run `npm exec -- supabase migration up --linked`
before deploying the app. Migrations
`20260828000001_model_validation_assessment_custody.sql`
(`model_validation_assessment_custody`) and
`20260828000002_validation_custody_fail_closed.sql`
(`validation_custody_fail_closed`) add append-only rules-v4 validation custody,
exact artifact and hash binding, member-scoped reads, service-only transactional
recording, immutable bound artifacts, and exact-polygon subdivision resolution.
The second migration makes every metadata comparison fail closed when a field is
missing and applies that correction to databases that received the first
migration during release verification.

Observed traffic and model output now have separate versioned contracts for the
observation, comparison basis, and assessment. The shared rules-v4 core refuses
scientific claims until year/day/period, direction/carriageway, and vehicle/PCE
bases are proven comparable. It preserves raw residuals and APE, uses intervals
only when a source or preregistered authority supplies them, limits decisive
metrics to Grade A/B evidence, retains Grade C diagnostics and Grade D/unloaded
coverage, resolves duplicate lineage once, and keeps build forecasts
inconclusive against base-year counts. Rules 1–3 rows remain unchanged and are
identified as legacy point-count diagnostics.

The source registry now asks for every state and national adapter intersecting
the exact project polygon. It distinguishes unsupported, unresolved, source
unavailable, and supported-but-empty states. A complete 2024 FHWA TMAS adapter
preserves exact archive bytes and hashes; HPMS keeps unsupported method, QA, and
uncertainty fields unknown. Caltrans adjacent-section values remain separate
unless route/LRS evidence selects a side.

Planners can inspect scientific outcome, basis mismatches, coverage, grade,
partition, planning use, and hashes on the model Validation surface and in
cited reports, assistant context, and project evidence bundles. The exact input
bundle, comparison basis, and assessment are downloadable artifacts. A custody
failure remains visible as `validation evidence write failed` and the
calculation is scientifically unchecked.

First-week job 11 covers the visible signed-in baseline assessment and evidence
download journey. The seven-county California development instrument readiness
study honestly stopped at zero ready counties: existing method pairs share the
network, but not the observation package, and their match audits were not frozen
before modeled volumes. No model outputs were opened, no method was selected or
averaged, and California and nationwide validation remain partial.

## 0.37.0 — 2026-08-27

**Migrations required.** Run `npm exec -- supabase migration up --linked`
before deploying the app. Migrations
`20260826000004_governed_decision_packages.sql`
(`governed_decision_packages`),
`20260826000005_decision_package_creator_submission.sql`
(`decision_package_creator_submission`),
`20260826000006_decision_package_approver_membership_visibility.sql`
(`decision_package_approver_membership_visibility`), and
`20260826000007_scenario_model_link_cascade_delete.sql`
(`scenario_model_link_cascade_delete`), followed by the release-corrective
`20260827000001_model_truth_completion.sql`
(`model_truth_completion`),
`20260827000002_governed_decision_enforcement.sql`
(`governed_decision_enforcement`), and
`20260827000003_evidence_dependency_freshness.sql`
(`evidence_dependency_freshness`), add append-only package
submissions and decisions, exact ready-bundle hash checks, assigned-approver
authority, My Work review queues, and the live-RLS role lookup needed to assign
a different owner or admin. The corrective work completes exact guided-model
custody, adds database gates for complete current manifests and one disposition
per exact hash, verifies stored private bundle bytes in the submission and
approval routes, preserves the canonical receipt bytes covered by its SHA-256,
and marks packages stale when dependent evidence changes. A stale package can
still be returned, but it cannot be approved.

Migration `20260826000007_scenario_model_link_cascade_delete.sql` also preserves
direct immutability for exact guided-model run links while allowing their
containing scenario, project, or workspace to perform its declared parent
cascade. The earlier trigger refused both paths and could block normal tenant
cleanup.

Guided project comparison now binds exactly four completed assignment outputs:
baseline and build from AequilibraE, and baseline and build from ActivitySim.
Each track selects its deterministic latest artifact, records the exact artifact
hash plus shared network and assignment digests, retains current build
assumptions, and requires a track-matched claim decision. Bound snapshots,
deltas, artifacts, and decisions are immutable. Missing or unavailable
ActivitySim assignment evidence remains explicitly behavioral-demand or
prototype evidence; OpenPlan does not promote it to an assigned-volume result.

Project evidence bundles now use the backward-compatible
`project_evidence_manifest.v2` contract. A governed package binds one project,
one selected linked-plan revision, and exactly one current board/report PDF to
the frozen ZIP. Every manifest entry carries the shared evidence descriptor:
source, dates, observed/modeled status, claim tier, uncertainty, limits,
revision, checksum, and stable evidence ID. Known report and model numeric
artifacts without adequate point-of-use provenance make the package
unapprovable.

The GeoPackage includes project-scoped observed crash/KSI points and geometry
only from approved public comments in campaigns with a live public page. It
excludes comment text, submitter identity, moderation notes, and private
records. Its
`openplan_layer_status` table carries the same evidence descriptor and labels
each expected layer `included`, `unavailable`, `reference_only`, or
`not_selected`; absent data never reads as zero. The renderer accepts exact
supplied AequilibraE links, ActivitySim links, and land-use designations as
separate layers. Current bundle generation does not yet supply those upstream
geometries, so it marks those layers unavailable instead of inferring or
combining them; exact model artifacts remain separate bundle files.

Evidence descriptors are validated when runtime records are read and again at
freeze. Generated entries bind their checksum, retrieval time, and revision to
the exact source or rendered bytes, and the terminal bundle records the
authenticated generator. The review dialog auto-selects a sole linked plan,
lists every remaining freeze blocker, and prior-bundle history exposes the full
copyable manifest SHA-256 beside the already-full bundle and receipt hashes.

Members may prepare and submit a ready package. Its assigned approver must be a
different owner/admin from both creator and submitter. That person approves or
returns it from My Work; a return requires a reason and a new-hash replacement.
The immutable receipt preserves the original bundle SHA-256. Approval does not
publish the package, assert statutory adoption, or validate a model. A later
project revision preserves historical custody while marking the package stale
for current use.

My Work remains scoped to one active workspace. When a caller-specific pending
review or returned package waits in another workspace, a caller-RLS probe names
that fact and offers a direct membership-checked switch instead of presenting
an apparently empty queue.

## 0.36.1 — 2026-08-26

**Migration required.** Run `npm exec -- supabase migration up --linked`
before deploying the app. Migration
`20260826000003_model_truth_correction.sql` (`model_truth_correction`) adds immutable links from a guided
comparison snapshot to its exact four model runs and output hashes, plus a
project study-area readiness check against usable Census tracts.

Guided modeling no longer treats a successful status or ActivitySim preflight
as assigned-volume evidence. Completion requires verified baseline and build
link-volume artifacts from AequilibraE and ActivitySim, current build
assumptions, and claim decisions attached to those exact project runs.
Unrelated county validation and generic, stale, archived, wrong-project, or
unbound comparison snapshots cannot complete the sequence.

Project model launches now stop with an explicit repair state when the stored
project geometry is missing, invalid, outside every usable Census tract, or
cannot be read. OpenPlan does not infer replacement geography. ActivitySim
assignment checks are recorded as behavioral-demand evidence, separately from
the AequilibraE assignment decision. The direction check now also refuses a
roadmap whose recorded current release differs from the application version.

## 0.36.0 — 2026-08-26

**Migration required.** Run `npm exec -- supabase migration up --linked`
before deploying the app. Migration
`20260826000002_project_evidence_bundles.sql`
(`project_evidence_bundles`) adds immutable project evidence-bundle records,
tenant and project scope guards, and the private
`project-evidence-bundles` Storage bucket.

Projects can now download their stored study area, site marker, and cartographic
corridors as a standard GeoPackage for QGIS and other GIS tools. The file carries
an EPSG:4326 manifest that explicitly identifies missing or invalid geometry;
OpenPlan does not repair or invent geometry during export.

The Projects page can also download the active workspace's portfolio as an XLSX
workbook that mirrors the reviewed create-only importer. Project type, status,
delivery phase, cost currency, and price year travel per row; literal text is
never emitted as a spreadsheet formula. A planner still selects the Projects
worksheet and reviews every row, while the exact OpenPlan headers prefill the
column mapping. Place identity, cost provenance, and timestamps remain visible
reference columns; location text does not silently create geography. Exports
fail rather than truncate more than 2,000 rows or invent a missing cost price
year. No migration is required for this slice.

The project's Evidence and documents surface now lets a planner review and
freeze an immutable ZIP handoff. Every bundle carries a canonical manifest,
SHA-256 inventory, project record, current GeoPackage, linked-data provenance,
and linked model source, validation, and claim records. Selected documents use
the same tenant-scoped byte readers as their individual downloads. A stale
project or file revision, missing bytes, path-scope violation, checksum mismatch,
or size violation refuses the entire artifact; viewers may review and download
ready bundles but cannot create one. The synchronous limit is 200 selected
files, 50 MiB per file, and 100 MiB total. Larger known records remain visible
as reference-only evidence.

This is a retained evidence snapshot, not approval, publication, or backup.
Per-plan bundles and GeoPackage layers for crash points, model links,
engagement pins, and land-use designations remain open interoperability work.

## 0.35.0 — 2026-08-26

**Migration required.** Migrations
`20260825000003_safety_road_context_cache.sql` (`safety_road_context_cache`),
`20260825000004_safety_road_context_scope_guard.sql`
(`safety_road_context_scope_guard`) add the service-authored,
workspace-readable road geometry cache used for named Safety concentrations and
tile-free printable street context, plus its cross-workspace scope guard.
`20260826000001_safety_exact_acquisition_screens.sql`
(`safety_exact_acquisition_screens`) adds exact-acquisition concentration and
tract screens so overlapping crash pulls are never summed silently.

OpenPlan now keeps one authenticated navigation rail and one page-specific
primary action. Workspace geography, stage gates, integration keys, team
administration, and deployment health live together on Workspace setup &
health; Overview is the daily attention and next-action page.

Project context now travels through Corridor Analysis, Travel modeling,
Scenarios, Model Validation, Safety, Engagement, Reports, Documents, Grants,
and Aerial Imagery. Creators preselect only a project confirmed inside the
active workspace, invalid or foreign IDs are rejected visibly, and project
readiness links open the exact project-scoped workflow.

Travel modeling is presented as one baseline-versus-build job. A project-scoped
starter creates an empty baseline, build scenario, AequilibraE record, and
separate ActivitySim record without inventing assumptions or results. Both
methods require separate baseline and build jobs. Before a build job, the
planner must enter a non-zero assigned-auto-trip change and name its basis;
changing it makes the previous build result stale. Missing
networks, workers, runs, observed-count checks, unloaded links, comparison
packets, traffic, VMT, and value conclusions remain explicit. Specialist URLs
remain available through the command palette and Help.

Safety can now match KSI concentrations to cached, versioned Census TIGER/Line
road geometry, disclose match quality or unavailable identity, and render a
printable local street-context figure without a paid tile service. National
FARS retrieval uses NHTSA's bounded annual CSV archives and filters the requested
area locally; configured state sources continue to retain their own coverage
limits. Generated project packets carry the named-road context and retain the
imported document that supplied a planning-level cost estimate. A packet whose
supported evidence counts are all zero is labeled an empty draft shell, not
evidence-backed or release-ready. Safety totals now describe one exact crash
acquisition, and planners explicitly select that acquisition before a report
freezes it into a generated packet.

The v1 capability matrix now has a machine-readable, review-expiring registry,
and the product-direction check fails if a required proof dimension disappears
or becomes stale. The nationwide validation program is preregistered in a
frozen, hashed record before candidate calibration. Configured public
application origins now generate absolute canonical and social URLs; an
unconfigured self-host omits unsupported URLs instead of advertising localhost.

## 0.34.0 — 2026-08-25

**Migration required.** Run `npm exec -- supabase migration up --linked`
before deploying the app. Migration
`20260825000002_direct_workbook_portfolio_import.sql`
(`direct_workbook_portfolio_import`) backfills v0.33 CSV provenance as worksheet
0/header row 1, adds per-sheet row identity, and adds the versioned atomic
workbook-import transaction. The v0.33 CSV transaction remains available during
rolling deploys.

Projects now reads CSV, XLS, XLSX, and ODS sources directly. A planner can
inspect all worksheets, select several, configure each header and mapping, copy
setup only across exact normalized-header matches, and review one combined
create-only batch in physical sheet and source-row order. No worksheet is
selected automatically.

Formula cells are never recalculated. OpenPlan uses a cached value only after
individual row confirmation; missing or error results remain blocked. The
10 MiB source and 2,000-row limits remain, selected sheets are limited to 256
columns, and compressed XLSX/ODS sources are drained through archive expansion
limits before parsing. Location text remains immutable import provenance and
never sets project geography.

## 0.33.0 — 2026-08-25

**Migration required.** Run `npm exec -- supabase migration up --linked`
before deploying the app. Migration
`20260825000001_reviewed_portfolio_import.sql`
(`reviewed_portfolio_import`) adds immutable import batches and row outcomes,
plus a service-role-only transaction that rechecks the planner's current role
and source scope before creating projects.

Projects now accepts a stored CSV of up to 2,000 rows and 10 MiB. The planner
maps columns, reviews every row, and explicitly selects only the projects to
create. Repeated source IDs and invalid rows stay blocked, name matches require
individual confirmation, and a rerun cannot create the same source row twice.
Location text remains source provenance and never becomes verified geography.

CSV is the only parsed spreadsheet format in this release. An original XLS,
XLSX, or ODS workbook can be retained beside the CSV, but OpenPlan does not
parse it yet.

## 0.32.0 — 2026-08-24

**Migration and worker restart required.** Run
`npm exec -- supabase migration up --linked`, restart both modeling workers,
then deploy. Migration
`20260824000006_worker_health_reminder_preferences_and_crash_cutoff.sql`
(`worker_health_reminder_preferences_and_crash_cutoff`)
adds service-role-only modeling-worker heartbeats, workspace reminder
preferences, and optional exact crash-source publication cutoffs.

Deployment and model-run pages now distinguish fresh, stale, absent,
conflicting, and unknown worker capabilities. A stale observation requires a
planner to acknowledge that exact observation before enqueue; it never stops
or cancels work already underway.

My Work now lets owners and admins choose a 1–30 day reminder window and turn
off email digests. In-app reminders always stay on, and missing preference rows
retain the existing seven-day behavior. Scheduler failures remain visible even
when older unread reminders are present.

Safety evidence records an exact source publication cutoff only when the source
publishes one. Corridor scores with missing Census, transit, demographic, or
crash evidence are withheld consistently from the interface, reports,
comparisons, exports, and assistant facts. The underlying arithmetic remains
stored for reproducibility; no unvalidated low/medium/high bands are shown.

## 0.31.0 — 2026-08-24

**Migration and worker restart required.** Run
`npm exec -- supabase migration up --linked`, rebuild the county modeling worker
with `npm run modeling:up`, then deploy the app. Migration
`20260824000005_county_run_worker_lifecycle.sql`
(`county_run_worker_lifecycle`) records queued, running,
cancelling, cancelled, completed, and failed attempts, plus worker heartbeat and
cancellation timestamps.

County-run retries now have separate artifact directories keyed by both the run
and job. Worker callbacks must carry the currently stored job id; delayed
callbacks from an older attempt are refused before run state or artifact
custody changes. Setup failures now produce terminal callbacks, and a planner
can cancel a queued or running attempt without imposing a runtime limit on
legitimate work that takes hours or days. The assistant is explicitly refused
from cancelling model runs.

Operators who enable the county worker must set two different bearer tokens:
`OPENPLAN_COUNTY_ONRAMP_WORKER_TOKEN` authenticates job, status, and cancel
requests, while `OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN` authenticates
job-bound callbacks. The local compose service reads the same `.env.local` as
the app.

Recovery no longer assumes a hosted or paid backup product. The new disposable
restore drill backs up representative tenant and evidence records plus a real
private Storage object, restores them into an isolated local stack, verifies
hashes and relationships, and runs live RLS against the restored target. The
upgrade rehearsal now carries evidence custody and Storage metadata across the
previous-release-to-current migration path.

## 0.30.0 — 2026-08-24

**Migration required.** Run `npm exec -- supabase migration up --linked`
before deploying the app. Migration
`20260824000004_workspace_stage_gate_template_selection.sql`
(`workspace_stage_gate_template_selection`) records whether a workspace's
stage-gate template was matched from geography, explicitly chosen by a planner,
or applied as the disclosed interim default. Existing rows are left unchanged
and retain legacy reconciliation behavior.

Fresh-workspace legal setup now follows the place the planner selected. A
California workspace automatically binds the registered California stage-gate
pack and recommends the California land-use bundle. A workspace in a state
without a configured bundle keeps the shared federal stage-gate floor and the
neutral land-use workflow, with plain language that neither represents unique
state or local requirements.

Changing or clearing a workspace geography updates only automatically selected
stage gates. A planner's explicit template choice survives later geography
changes, and concurrent edits refuse with a review prompt instead of silently
overwriting that choice. The first-week and dual-model browser harnesses now
wait for hydrated sign-in and tab controls, so a client-side transition is not
misreported as a product failure.

## 0.29.0 — 2026-08-24

**Migration required.** Run `npm exec -- supabase migration up --linked`
before deploying the app. Migrations
`20260824000001_safety_ksi_concentrations.sql`,
`20260824000002_safety_ksi_tract_burden.sql`, and
`20260824000003_project_estimated_cost_and_csv_provenance.sql`
(`project_estimated_cost_and_csv_provenance`) add tenant-isolated spatial
screening for observed KSI concentrations (`safety_ksi_concentrations`) and
Census-tract community context (`safety_ksi_tract_burden`), plus a planning-level
project cost with currency, price year, and a linked source document.

Fresh-account testing closed three first-week dead ends: a corridor wizard now
uses the geography submitted on the first click, report packets notice safety
data added after generation, and safety work produces ranked KSI locations with
plainly limited community context. A failed optional screening calculation can
no longer erase crash counts from an otherwise readable packet.

Project candidates can now be reviewed from a CSV attached to the project. A
planner maps the file's columns, chooses one row, and applies its name,
description, cost, currency, and source together. Project setup points corridor
files to the existing Map-tab upload, and a generated PDF is downloadable from
the report's main preview instead of only from the audit history.

Report HTML now uploads with the storage bucket's registered MIME type, so the
engagement-to-report handoff works on a fresh local deployment. The project
cost editor also stays within a phone-width project page instead of forcing its
card and file control off screen.

## 0.28.0 — 2026-08-23

**Migration required.** Run `npm exec -- supabase migration up --linked`
before deploying the app. Migration
`20260823000007_land_use_plan_review_reporting.sql`
(`land_use_plan_review_reporting`) adds immutable review
releases and process records, freezes adoption manifests, finalizes GIS feature
hashes, and gives land-use-plan reports their own target types.

### Public review and reporting now complete the land-use-plan workflow

A planner can release an exact frozen draft at a public link, use either an
Engagement campaign or documented external process, freeze the comment outcome,
revise and run another review round, adopt only the latest closed review hash,
and publish a readable plan packet. Closed rounds remain public records. A
mistaken release can be withdrawn without deleting its audit row.

Review and adopted pages display the exact finalized designation-map version.
Only fields the planner selected are public; dense views draw nothing and state
the true intersecting-feature count instead of showing a misleading subset.
The “future land use is not zoning” disclosure remains attached.

Reports now name the land-use plan, render printable frozen plan content or an
implementation-status snapshot, offer JSON provenance, and link back from the
plan workbench. My Work lists dated incomplete process steps and review closing
dates. Required descriptor steps must be completed for that exact version;
optional steps do not lower completion.

The [dated v0.27.0 correction](docs/ops/2026-08-23-v027-land-use-plan-correction.md)
records why that release's end-to-end claim was premature.

## 0.27.0 — 2026-08-23

**Migration required.** Run `npm exec -- supabase migration up --linked`
before deploying the app. This release adds and then hardens the land-use-plan
schema in five additive migrations:

- `land_use_plans` (`20260823000002`)
- `land_use_plan_policy_compaction` (`20260823000003`)
- `land_use_plan_workspace_cascade` (`20260823000004`)
- `land_use_plan_append_only_cascade` (`20260823000005`)
- `land_use_plan_report_target` (`20260823000006`)

### Land-use plans can now be authored from setup through annual reporting

A planner can start a California general plan, write and organize every
applicable element, connect exact versions of mapped designations and delivery
work, save review and consultation history, freeze the public draft, adopt the
exact reviewed hash, publish the frozen plan, and produce annual implementation
reports. Amendments fork a new working version; adopted content is never edited
in place.

California is the first configured legal source bundle. Other places can use
the neutral workflow with an explicit notice that local legal requirements are
not configured. OpenPlan tracks requirements and evidence but does not certify
legal sufficiency. Confidential tribal-consultation notes and sensitive
locations remain private and are excluded from publication.

## 0.26.0 — 2026-08-23

**Migration required.** Run `npm exec -- supabase migration up --linked`
before deploying the app. Migration
`20260823000001_report_artifact_aerial_preview_mime.sql` adds PNG to the
existing private report-artifact bucket's MIME allowlist without replacing any
locally configured types (`report_artifact_aerial_preview_mime`).

### Held orthophotos can now travel through reports into grant drafts

A planner can explicitly choose one held orthophoto preview on report detail.
Nothing is selected automatically, and report generation does not publish the
image. The generated packet freezes the unchanged PNG together with both
SHA-256 hashes, mission and project identity, capture/custody/freeze dates,
resolution, map bounds, coordinate system, and the mandatory non-survey caveat.

The in-app report preview serves those private bytes only after workspace access
and a fresh size-and-hash custody check. PDF generation embeds the same bytes so
the downloadable packet is self-contained.

Grant narrative evidence reads only the frozen report artifact, never the live
mission or custody record. An altered or unreadable snapshot blocks drafting
instead of silently disappearing, and choosing imagery remains a recorded
planner judgment that the assistant is explicitly refused from making.

## 0.25.0 — 2026-08-23

**No migrations.** Rebuild and restart the self-hosted ODM worker, then deploy
the app. Re-run any mission that the previous self-hosted worker marked
successful without map placement; NodeODM may have returned a 25-byte JSON
error where that worker expected an image.

### Real orthophotos now survive processing and appear on the map

The ODM worker now collects NodeODM's supported `all.zip` export, extracts only
the known deliverables, and renders the browser preview from the real GeoTIFF
with GDAL. It refuses NodeODM's unusual HTTP-200 JSON error response instead of
hashing and storing those bytes as if they were TIFF, PNG, elevation, and point
cloud artifacts.

Selected aerial imagery now includes a **Zoom to preview** control on shared
planning maps. This makes a small mission raster visible instead of leaving it
effectively hidden at the default city or regional scale.

A repeatable local browser smoke processed 16 genuine overlapping photos,
verified the held preview's signed bytes and SHA-256, rendered the raster on the
mission and shared Aerial maps, and proved the shared map canvas changed when
the layer was switched off. Source photos, exact coordinates, and screenshots
remain local.

## 0.24.0 — 2026-08-23

**No migrations.** Pull and deploy. Existing aerial processing jobs and held
previews remain usable; no imagery is switched on automatically.

### Processed aerial imagery can follow the planner's work

A held, georeferenced orthophoto preview can now be shown on authenticated
workspace, safety, project, exploration, and engagement-planning maps. The
same explicit selection follows the planner between those maps in that browser.
The Aerial mission map also offers the switch beside the preview. New previews
start off, and a selection is cleared if its verified custody record disappears.

OpenPlan rechecks workspace and mission ownership, artifact kind and held state,
storage path, SHA-256 custody record, file type, and map placement before it
offers a preview. It creates a short-lived display link only after the planner
selects that exact layer. A failed catalog or image read is disclosed rather
than presented as no imagery, and the layer panel shows the project, capture and
custody dates, hash, source coordinate system, resolution, and orientation-only
caveat.

Resident-facing maps do not receive these private layers. Publishing aerial
imagery to the public remains a separate, explicit workflow that has not been
added in this release.

Aerial mission pages now own their map outright, so the shell map dock no
longer covers the mission's Evidence chain. The browser smoke checks this at
desktop width and checks for horizontal overflow at 390 pixels.

## 0.23.0 — 2026-08-23

**No migrations.** Pull and deploy. Reports generated before this release keep
working, but they do not contain the frozen dual-model evidence described below;
regenerate a report after selecting any corridors that belong in the packet.

### Dual-model agreement now travels into reports and grants

A planner can cite a successful dual-demand run on a report, review its verified
aggregate agreement evidence, and explicitly choose named corridors for the
packet. No corridor is selected automatically. Generated packets freeze both
model volumes, GEH, classification, source run, custody hashes, attribution
scale, and caveats so later grant work does not silently read a changed model
artifact.

Linked grant opportunities now show that frozen report evidence and give the
grant drafting flow one deterministic aggregate fact plus one fact for each
planner-selected corridor. A missing, altered, cross-project, failed, averaged,
or otherwise unverifiable agreement artifact blocks the handoff instead of
quietly disappearing. Every surface states that agreement measures sensitivity
to the demand method, not accuracy; the two model values are never averaged.

## 0.22.0 — 2026-08-23

**No migrations.** Pull and deploy. Existing runs remain readable, but only a
new run can record the expanded observed-count and independent-validation
provenance described below.

### Nationwide count evidence, without a nationwide accuracy claim

OpenPlan can now retrieve eligible road-section AADT from FHWA's public 2024
HPMS spatial dataset anywhere in the United States. A registered state DOT feed
still takes precedence where one is available. The run record preserves the
source, vintage, supported road classes, exclusions, and why a search produced
no usable count; an unsupported class is never displayed as zero traffic.

Alaska, Hawaii, multi-state areas, and study areas crossing the antimeridian use
the same bounds-based source path. HPMS is a nationwide validation floor, not
complete road coverage: lower rural collectors and local roads may have only
summary coverage, and a roadway count may be three to six years old.

### The gateway correction was tested and rejected

A hash-locked study tested one specific change on 32 previously unexamined
counties, split before results into 16 development and 16 untouched holdout
counties. The candidate replaced flat gateway traffic with defensibly matched
observed AADT and lifted the eight-gateway cap only for measured crossings.

It failed the pre-registered adoption rules on both demand methods. On the
holdout half, AequilibraE improved in 5 of 16 counties and ActivitySim in 6 of
16; median county improvement was zero percentage points for both. The pooled
station median error remained 100% for AequilibraE and moved from 100% to 99.84%
for ActivitySim. The matched stations did not change and the accounting guards
passed, so this is a usable negative result rather than a broken run.

**The default model is unchanged.** OpenPlan did not fit regional scalars, lift
the cap for inferred crossings, or select another candidate after seeing the
holdout. The dated protocol, hashes, county-level results, and rejection are in
`docs/modeling/GATEWAY_VOLUME_STUDY_2026-08-23.md`.

### Selection evidence is not accuracy evidence

Both calibration drivers now use one fail-closed acceptance rule: the objective
must improve by the required amount and held-out median APE must not worsen.
The worker and county script can no longer disagree about whether a calibration
step is accepted.

The run page and downloadable provenance document now show observed-count
source, gateway volumes measured versus inferred, baseline versus selected
calibration, and any separate independent validation. The calibration holdout
is labelled as parameter-selection evidence, not accuracy. Only an untouched,
passing validation for that run and a link-capable zone system can earn the
count-backed claim tier; a national average cannot promote an individual run.

## 0.21.0 — 2026-08-22

**Seven migrations. Run them before the new code is serving traffic.**

```
npm exec -- supabase migration up --linked
```

- `…000019` **measure_period_reserve** — the last gap in a public fund's
  arithmetic: what an ordinance holds back before anything is apportioned.
  Without it the measure-fund reserve feature errors against a missing table.
- `…000001` **workspace_gis_workspace_binding** (2026-08-16) — **security.**
  Postgres checks foreign keys with table-owner rights, so a member of one
  workspace could attach version, feature and reference rows to another
  workspace's GIS layer. Composite keys close it. Apply this one promptly.
- `…000001` **kb_search_chunks_extraction_source** (2026-08-17) — carries each
  retrieved passage's extraction source, so text that was read by OCR is
  labelled as such wherever it is quoted into a draft.
- `…000002` **cron_job_heartbeats** — each scheduled job stamps a heartbeat when
  it succeeds, so My Work can say whether reminders are actually running instead
  of inferring it from a secret being set.
- `…000001` **run_artifacts_markdown** (2026-08-20) — adds `text/markdown` to the
  private run-artifacts bucket's allowlist; without it agreement reports register
  as local-only and the run page cannot retrieve them.
- `…000001` **engagement_crash_corroboration** (2026-08-21) — the function behind
  the engagement↔safety panel: what the crash record says about the places
  residents mapped.
- `…000001` **work_notification_recipient_can_mark_read** (2026-08-22) — a
  viewer who is assigned work and reminded of it can now clear the reminder.
  Until this, the restrictive writer gate refused their update and the unread
  badge could only be cleared by a role change. The same migration narrows the
  column grant so a recipient can set only `is_read` and `read_at`, not rewrite
  what the reminder says.

### Traffic models: re-run anything you rely on

**Existing model runs report roughly 27% more traffic than they should.** Two
unit errors were fixed in the trip-based travel model, and a run made before
this change is the wrong one:

- **Person-trips were assigned to the road network as though each were a car.**
  Three people sharing a car are three trips and one car. The model divided by
  nothing, so every road carried about 1.6 times too many vehicles.
- **Walking and cycling trips were put on the road network too.** They now go
  through the same mode-choice model the worker already used.

Measured across five counties against published federal traffic data and against
state traffic counts, holding the road network and the count stations fixed:
modelled traffic fell from **2.29× to 1.67×** the published figure, and the
median error against real traffic counts fell from **97.4% to 78.2%**. Nothing
was tuned to produce that — both changes are corrections to units.

**What you have to do:** re-run any model whose numbers you have quoted or
exported. **You do not have to work out which runs are affected** — open a run's
provenance document and it says whether it counted cars or people, and an
affected one states that its traffic figures are about 1.6 times too high.

The accuracy check against published traffic counts was corrected too, in three
ways that all made the model look better than it was: counts on a divided
highway were compared against one carriageway of two, freeway ramp counts were
graded against the freeways they leave, and a road segment was graded once per
count station on it. A run graded under the old rules now says so rather than
being compared against one graded under the new ones.

**The model is still about 1.67 times high and should not be used for a number
you have to defend.** It says so itself: a run that cannot support a claim
refuses to make it rather than printing a figure anyway.

### Two demand models, one network, no blended answer

OpenPlan can now assign both its trip-based demand and an ActivitySim demand
package to the same retained road network with the same assignment settings.
The run page draws an agreement map: corridors where the methods concur and
where they diverge. It never averages the two outputs. Assignment noise and
loose convergence are shown separately, so a difference caused by the solver
is not described as a behavioral finding.

ActivitySim bundles can use Census PUMS households fitted to the selected study
area instead of households invented from the model's own inputs. The behavioral
coefficients still carry the place where they were estimated; a coefficient set
that has not been independently validated for the run's geography cannot support
a local accuracy claim.

The model now routes measured FHWA through-travel across the national highway
network instead of drawing county-centroid chords. Unrouted flow stays disclosed
and is never replaced with a straight line. Alaska's split geometry and study
areas anywhere in the United States use the same geography front door.

### Calibration is opt-in, held out, and visible

A planner can upload observed traffic counts, see exactly which roads matched,
and ask OpenPlan to fit a run. Counts used for fitting and counts used for the
accuracy check are separated deterministically. Baseline and calibrated results,
road-class errors, convergence, count provenance, and the rules that graded the
run now appear on the run page and in the downloadable funder document.

Calibration still does not make the current model defensible by itself. The
best candidate is selected on held-out counts, and a corridor inherits only the
evidence for its own road class. A national average never promotes an individual
run. Several pre-registered model changes were tested and rejected; the defaults
were left alone when the evidence did not improve.

### Public engagement and safety meet on the map

The resident portal is now map-first, keeps its Spanish path from beginning to
end, and uses the same review-before-submit comment form at all three public
doors. A campaign can page past 1,000 responses. On the planner side, the safety
map places crash history beside the locations residents mapped, and grants can
cite both the corroboration and the places where no comparison was possible.

### Less hunting, fewer dead-end forms

- The dashboard has five planner-chosen figures instead of a fixed summary.
- Project boundaries can come from the files an agency already has, and those
  files can travel with the project into a board packet.
- Starting projects, programs, plan cycles, grants, awards, work plans, and
  flight records now uses short, bounded flows that a planner enters and leaves.
- My Work includes items waiting on a person. An assigned viewer can clear their
  own reminder without being given permission to rewrite it.
- A run in progress shows assignment progress and its live log. A finished run
  says what question it was run to answer.

### Measure funds close their own arithmetic

Measure-fund periods now record reserves explicitly, and retention is withheld
from payment rather than from the amount a subrecipient legitimately claimed.
The oversight statement's remaining exceptions are backed by probes, so adding a
new excuse in prose without making it measurable fails the test suite.

### Safer local operation

- A double-click launcher starts the local product and the control panel reports
  whether the web app, database, workers, and scheduled jobs are actually alive.
- The county worker's non-Docker server no longer listens without authentication
  on every network interface. NodeODM is local-only by default, rejects an image
  whose streamed bytes exceed the limit, and removes partial files after failure.
- Cross-workspace GIS references are rejected in Postgres, cited documents are
  not deleted before the database can refuse the deletion, and the public RTP
  page scopes every related read to its own workspace.
- CI now runs the live row-isolation proof and dynamically discovers every Python
  worker suite. Randomized test order exposed and fixed shared-state failures that
  a fixed order had hidden.

## 0.20.0 — 2026-08-12

**No migrations.** Pull and deploy.

### You can see your map layers now

The page panel used to cover the map almost completely — it is 94% opaque with
a blur behind it, so an uploaded layer was never really visible underneath.
On Safety, Aerial and Corridor Analysis there is now a **Read the map**
button: the page slides away, the map fills the window, and the layer
switches, legend and zoom stay where they are. Press it again or hit Escape to
bring the page back. A layer you upload now turns itself on, draws thicker,
and gets a colour nothing else in your workspace is using — and each layer in
Data Hub has a **Show on the map** link that takes you straight there.

### Small text is readable

Every colour theme now meets the accessibility standard for small text. This
is the colour OpenPlan uses for field hints, empty pages, and — the reason it
matters most — every caveat explaining what a number can and cannot tell you.
Those sentences were the hardest text in the product to read.

### The same number reads the same everywhere

Money was being formatted 44 different ways. Most visibly: the RTP financial
element rounded reimbursement figures that the invoicing register showed to
the cent — **the same records** — so reconciling one against the other gave
two answers. Summary screens may still round, but they now say so and point at
where the exact figure lives. Four screens were formatting money in the
browser's language rather than the fund's currency.

### Errors you can act on

Eleven screens were showing you the database's own error text. You now get a
sentence naming what to do, with the technical detail folded underneath for
whoever runs your deployment. The same for messages that used to name
environment variables and migration numbers at planners who cannot change
them.

### Deleting something asks properly

Every destructive action now uses one in-app confirmation instead of the
browser's grey box — and where OpenPlan knows what depends on the thing you
are deleting, it names those things and offers to archive instead.

### Finding things

Search your documents **by filename** — the old search only read inside
documents, so a file you remembered by name but not by contents was
unfindable. Sort by newest, oldest or name. And every "screening-grade" label
is now a link explaining what that means, what it is safe to conclude, and
what the current error range actually is for the run you are looking at.

### Fixed

- A search term containing a quotation mark could break out of the search and
  change the query. Terms with brackets silently matched nothing.
- Three messages said the wrong thing after a wording pass: a county run's
  quality tier read as though it simply had not been checked yet, a failed
  evidence read claimed no evidence existed, and packets needing regeneration
  were described as overdue, which in OpenPlan means past a real deadline.

## 0.19.0 — 2026-08-12

**Three migrations are required before the app deploys: `20260812000015`,
`20260812000016`, and `20260812000018`.** They add the layer catalogue, the
feature store (PostGIS), and the reference record that refuses to delete a
layer something depends on. All additive.

**Security:** this release upgrades `puppeteer-core` (23 → 25) for
[GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv). If
you generate PDFs with Chrome, redeploy rather than waiting.

### Your agency's own map layers

Upload the GIS files your agency already has — bike network, city limits,
zoning, whatever you keep in ArcGIS or QGIS — and turn them on over the map.
GeoJSON, KML, KMZ and zipped shapefiles.

**Old files are the point.** A shapefile in State Plane feet, with a `.prj`
or without one, is what most planning departments actually have. OpenPlan
reads 6,688 coordinate systems and reprojects your file to where it belongs.
When there is no `.prj`, it asks you which system the file is in and records
that **you** said so — permanently distinguishable from a system it read out
of the file, on every screen that shows the layer. If the result lands
somewhere the coordinate system is not used, OpenPlan refuses and tells you
what it expected and what it got, rather than drawing your city in the ocean.

A layer with more features than can be drawn cleanly draws **nothing** and
tells you how many there are, instead of showing you part of your data as if
it were all of it.

Layers appear on the Safety and Aerial maps today. Corridor Analysis draws
its own map and does not show them yet.

### Not in this release, so you know before you try

**Geodatabases (`.gdb`) are not read.** Export to shapefile or GeoJSON from
ArcGIS Pro or QGIS and upload that — OpenPlan says exactly this when you try
one, rather than calling the format unsupported. **Original files are not
kept**: OpenPlan stores the reprojected shapes, so if you pick the wrong
coordinate system, the fix is to upload again and delete the old layer.

## 0.18.0 — 2026-08-12

**Four migrations are required before the app deploys: `20260812000011`
through `20260812000014`.** They add the measure fund, its claims, the
reminder, and the off-the-top records with an atomic allocation function.
All additive and safe against a live database.

### If your agency administers a voter-approved measure

A county or city passes a transportation sales tax or an infrastructure levy;
money arrives every quarter, an ordinance says how it divides, cities and
districts claim against it, and a citizens' oversight committee wants to see
all of it. OpenPlan now runs that fund.

- **Receipts against forecast**, with a balance and the periods that have not
  been reported yet named as unreported — never counted as zero.
- **Your ordinance's own rules**, described rather than coded: percentage
  splits by purpose, return-to-source shares by a basis your agency records
  (population, road miles — whatever the ordinance names), off-the-top
  administration clauses with annual caps, and reserves. OpenPlan never
  supplies a population figure or an expected receipt; every input names
  where your agency got it.
- **Claims from cities and districts** — submitted, reviewed, approved, paid
  — checked against the categories your measure actually funds, with backup
  documents in the document library.
- **An oversight page and an annual statement** a committee can audit: what
  came in, what the ordinance took out first, what was left, and where it
  went. Both reconcile, and where the figures cannot fully close, the reason
  is printed rather than the gap being left to the reader.

Adding a second measure — a different county, a different ordinance, another
state — is a matter of describing it. Nothing about any particular measure is
built into OpenPlan.

### One limitation, stated

If your ordinance holds back a reserve, OpenPlan computes it but does not yet
record the amount held per period, so the subtraction on the oversight page
cannot fully close. The page says so and names a held-back reserve as a
possible cause rather than implying money went missing. Recording reserves
per period is the fix and it needs a future migration.

## 0.17.0 — 2026-08-11

**One migration is required, and the order matters more than usual:
`20260812000010` must be applied BEFORE this code deploys.** It adds a
nullable expenditure-deadline column to funding awards, and this release's
award close-out and project funding panel both ask for that column by name —
so code-first would break those two screens until the migration lands.

**Two money figures were wrong before this release. Read this if you invoice
a funder.**

- **A rejected invoice was counted as money you had claimed.** The register
  said "all non-rejected invoice records" above a total that included the
  rejected ones, and that same total was subtracted from your committed award
  dollars. On our worked example, a rejected $55,000 claim told the agency it
  had **$16,999.50 left to bill when the real figure was $80,999.50**. The
  same over-count reached RTP roll-ups, report snapshots, and what the AI
  assistant believed. Every one of those now excludes rejected claims and
  reports them separately.
- **"Claimed" meant two different things on one screen.** The project funding
  panel counted draft invoices as claimed; the printable form did not. Both
  now come from a single ledger, and drafts are shown separately as drafts.

Nothing in your database was wrong — the arithmetic reading it was. No data
migration is needed for either fix.

### The drawdown ledger

Every award now shows the whole picture in one place: authorized, claimed,
paid, outstanding, retention held, retention still to come, drafts not yet
claimed, rejected, and what authorization remains. An award with no recorded
authorization says so rather than showing $0. An over-claimed award shows a
negative remainder rather than hiding the overrun at zero.

### A reimbursement worksheet you can work from

Download an award's reimbursement packet: your recorded costs, in the shape
the exhibit expects, with the invoice register and the period you chose.
**It is deliberately not a funder's form** — it says on every page that
OpenPlan prepared it from your records and that you must check it against the
exhibit your funder currently publishes. That sentence now survives on
deployments without Chrome, where it previously appeared only on the first
and last pages.

### Lapse dates, before they lapse

Awards can carry an expenditure deadline — the date unspent money goes away —
and the daily reminder names the award, the date, and the amount at risk from
the ledger. Awards created before this release can be given one; previously
the field could only be set at creation.

### Beyond US funders

The reimbursement profile now declares its own currency, and packets name it.
Where no profile declares one, the document says US dollars are OpenPlan's
assumption rather than printing a dollar sign and hoping.

## 0.16.0 — 2026-08-11

**Three migrations are required before the app deploys: `20260812000001`,
`20260812000002`, and `20260812000003`.** They add the collision detail
columns, the people table, and a counting function. All additive and safe
against a live database.

**Read this if you already have crash data.** Two columns change meaning:
killed and injured counts used to be stored as `0` when the source did not
report them, which is indistinguishable from "nobody was hurt." They can now
be empty, and empty is shown as "not reported." Rows imported before this
release keep their zeros — OpenPlan will not rewrite history it cannot
verify. If you need those older rows corrected, re-import the years in
question.

### Collisions you can actually analyze

The safety map used to filter by severity and mode. It now filters by year,
severity, mode, collision type, violation category, lighting, weather, time
of day, and day of week — and clicking a collision shows every field the
source provided, saying plainly which fields it did not. Summary tables sit
beside the map with the coverage and completeness notes attached to the
numbers that depend on them, and **Export** downloads exactly what you are
looking at, filters stated in the file.

The California source (CCRS) publishes seventy-five fields about each
collision. OpenPlan was reading seven of them. It now reads the ones a safety
analysis needs, including the people involved — as role, age band, and
outcome. Names, exact ages, gender, race, licence and vehicle numbers are
never stored, and the AI assistant cannot read the people table at all.

### Crash evidence reaches your plan and your grants

The RTP safety criterion, benefit-cost screening, and grant narratives can
now cite observed collisions instead of asking you to retype counts from
memory. The evidence informs a rating **you** set; OpenPlan never turns
collisions into a priority score on your behalf.

### Ready for states beyond California

Crash severity, collision type, lighting, weather and the rest are now
described in words that mean the same thing anywhere. California's data is
one adapter behind that vocabulary, so adding another state's feed is a
matter of describing it, not rewriting the safety module.

## 0.15.0 — 2026-08-11

**Four migrations are required before the app deploys: `20260811000008`,
`20260811000009`, `20260811000010`, and `20260811000011`.** The first two create
the staging tables that hold what OpenPlan copied out of a plan document and add
one nullable column to four RTP tables recording which transcription a figure
came from. The third widens the document library to accept text recognised from
scans and adds the OCR job tables. The fourth is a fix — see below. All additive
and safe against a live database.

### Fixed: the My Work notification inbox was unreadable on 0.14.0

If you are running 0.14.0, opening **My Work** shows an error where the deadline
reminders should be, and marking one read does nothing. The reminders were
being created correctly by the nightly deadline sweep; the table they live in
was created without the database permission a signed-in person needs to read
it, so the app was refused before its own access rules were ever consulted.

`20260811000011` grants exactly that permission — read, and mark-read, and
nothing else. Reminders stay something only the daily sweep can create and only
you can mark read; nobody, including you, can delete one. No data was lost and
nothing needs re-running: the reminders were there the whole time and appear as
soon as the migration is applied.

**Optional new settings.** `OPENPLAN_RTP_EXTRACTION_MODEL` chooses the model
that reads plan documents (unset uses the strong default — see `.env.example`
for why the cheap one is the wrong economy here). The five
`OPENPLAN_KB_OCR_*` settings enable reading SCANNED plans; without them a
scanned PDF is stored and honestly marked unreadable, and everything else works
unchanged.

### OpenPlan can read last cycle's adopted plan

Upload an adopted RTP and OpenPlan reads it, copying out revenue and cost
lines, performance measures, planning periods, programmed project costs, the
plan's dollar year, and the plan's own policy and goal text — each one with the
page it came from and the sentence it was copied from.

**Nothing enters your plan until you save it**, and saving runs exactly the
same checks as a figure typed by hand. Every proposal is shown beside the
document's own words, and a figure that is not in the words it quotes is thrown
away rather than shown to you: a reading says "41 proposed; 6 dropped because
their figures were not in the text they cited" instead of quietly showing 35.

There is no confidence score anywhere, and no way to accept in bulk. Both are
deliberate.

**The most useful moment is the conflict.** Each proposal is compared — in
OpenPlan, not by the model — against what your plan already records. Same
revenue source, different figure, shown side by side with the page and the
quote. That is how you catch a ledger typed out of a draft the adopted plan
later superseded.

**Provenance follows the figure.** A saved figure names its source document and
page in the app, on your public plan page, and in the body of the board packet
— not in an appendix. Edit the figure afterwards and the chip says the agency
changed it, rather than continuing to cite a page that no longer says that.

Walkthrough: `openplan/docs/READING_AN_ADOPTED_PLAN.md`.

### The plan's own words, copied word for word

Policy, goal and action statements are transcribed verbatim or not at all —
never summarised, never paraphrased, never two statements joined together. They
wait in a staging queue where **you** choose which chapter of your plan each
block belongs in; OpenPlan never guesses that pairing. A chapter's published
text is still only what you write in the chapter editor.

### Scanned plans

Most adopted plans older than a few years are scans with no text in them.
OpenPlan now ships an OCR worker (`workers/ocr_worker/`) that turns them into
citable, page-anchored text. Without it configured, a scanned document says
this deployment has no OCR service — rather than saying scans are unsupported,
which would be untrue.

### Previous plans stay out of the way

Reading prior plans means loading them into the registry, where they live as
archived cycles. The registry now hides archived plans by default and offers
them behind a **Show archived plans** button carrying their count, so a decade
of history does not bury the plan you are writing. A cycle that has had a
document read into it is labelled with how many figures were saved and how many
are still waiting.

Deleting a document that backs saved figures is refused, and the refusal names
the plan and the count.

### No AI assistant can do any of this

Not reading a document, not accepting a figure, not setting one aside, and not
placing a paragraph into a chapter. Every one of those is an HTTP route a
signed-in person calls. The 2026-08-05 refusals covering RTP financial writes
are untouched and stay refused.

## 0.14.0 — 2026-08-11

**Two migrations are required before the app deploys: `20260811000006` and
`20260811000007`.** The first adds one nullable column to four project record
tables; the second creates the reminder table. Both additive and safe against
a live database. **Also new: a scheduled job.** `/api/cron/sweep-deadlines`
runs daily at 13:00 UTC and needs `CRON_SECRET` set, exactly like the two
existing reapers. Without it, nothing breaks — reminders simply never
generate.

### Work has an owner

Deliverables, milestones, submittals, and issues can now be assigned to a
teammate — and reassigned or cleared later from the project board. The old
free-text owner field stays for people outside your workspace (a
subconsultant, an agency contact with no login), and both show side by side.
When someone leaves the workspace, their work says "Unassigned — previously a
member" rather than showing a blank or a name that no longer means anything,
and it surfaces as work that needs picking up.

### My Work

A new daily page: everything assigned to you across every project, projects
blocked at a stage gate, and the workspace's own deadlines — grant decisions,
award obligation dates, invoice windows. Switch between what's assigned to
you, what nobody has picked up, and everything on your projects.

### Deadline reminders

One digest a day per person: what's due within a week and everything already
overdue, in your notification inbox and by email where email is configured.
Running the sweep twice in a day cannot send it twice.

### A portfolio view, and work plans that start full

The projects page opens with a table across every project — phase, budget
burn, next deadline, open assignments. A budget with incomplete spend records
shows "—" instead of a misleading number. And **23 starter work plans** now
ship with OpenPlan, covering transportation practice (corridor study, safety
action plan, active transportation, transit development, long-range plan,
programming cycle, complete streets, travel demand management, freight,
feasibility, grant-funded delivery, environmental review) and land-use
practice (comprehensive plan, specific/area plan, zoning update, housing
needs, annexation, design guidelines, downtown revitalization, parks and open
space, climate and hazard, historic preservation). Pick one, give it a start
date, and the deliverables and milestones land on the project ready to edit.
They are starting points drawn from standard practice, not requirements —
each says so, and none of them names who does the work.

### Fixed

- Linking an invoicing staff record to a teammate has never worked; the
  membership check could only ever see the person making the request. Fixed.

## 0.13.0 — 2026-08-11

**One migration is required before the app deploys: `20260811000005`.** It
widens the knowledge-base document types and adds one column; no existing
data changes. Safe against a live database.

### One place for every file: the Document Library

The Knowledge Base page is now **Documents** — one filterable view of every
file your workspace has uploaded *or produced*: knowledge-base documents,
generated report packets, grant application exports, invoice PDFs, drone
mission photos, and processed aerial products. Filter by where it came from,
which project it belongs to, what kind of file it is, or "citable only."
Every project page gains a **Documents panel** showing that project's
complete file record.

- **Upload more than text**: images, spreadsheets, CAD files, drawings, and
  exhibits now belong in the library. Files without indexed text are marked
  "stored — cannot be cited yet," honestly and by design; they never leak
  into the AI assistant's citation sources. (Text extraction for scans and
  spreadsheets is a planned worker capability; nothing pretends it exists
  yet.)
- **Downloads work everywhere**: uploaded knowledge-base documents are now
  downloadable at all (previously they could be uploaded but never
  retrieved), and every library row links through its module's own
  access-checked download.
- Files stay where their module keeps them — the library is an index with
  each module's own permissions doing the guarding, so a file can never
  appear to someone the module itself wouldn't show it to. Resident-submitted
  engagement photos are deliberately not listed; they stay with the
  moderation tools that understand their approval state.
- The upload size limit is now operator-configurable
  (`OPENPLAN_KB_DOCUMENT_MAX_BYTES`, default 100 MiB).

## 0.12.0 — 2026-08-11

**Three migrations are required before the app deploys: `20260811000002`,
`20260811000003`, and `20260811000004`.** They add the aerial imagery table
and its private storage bucket, georeferencing columns on artifact custody,
and manifest-job support on processing jobs. All additive; safe against a
live database. Nothing about existing missions changes until you use the new
capabilities.

### The drone pipeline is now complete inside OpenPlan

- **Upload your mission photos directly** — no more hosting a ZIP somewhere
  yourself. Photos are stored privately per mission, with camera GPS and
  capture times read from the files and shown honestly (a photo without
  location data says so; nothing is invented). Capture locations appear as
  dots on the mission map.
- **Process without the external service**: a new self-hostable worker
  (`workers/odm_worker`) wraps OpenDroneMap and speaks the same processing
  contract as before. Deployments using the existing external worker change
  nothing; deployments with neither keep the same honest "no worker
  configured" message. Setup is a step-by-step guide with what-success-looks-
  like at every step — including what a worker restart forgets and how
  OpenPlan surfaces it.
- **See the orthomosaic on the mission map.** Processing results now carry
  their map position; the ortho preview renders as a layer over the mission
  area. Results from the older contract (no position data) say plainly that
  no georeference was recorded rather than drawing something wrong.
- Mission photos can be deleted only before processing has been requested —
  after that they are potential evidence under a survey product, and the
  refusal says so.

## 0.11.0 — 2026-08-11

**One migration is required before the app deploys: `20260811000001`.** It
creates one new table, `aerial_flight_plans` (one row per drone mission), and
touches nothing existing. Safe against a live database; without it the flight
planner simply reports that it cannot save yet.

### The Planner Agent can read the evidence

The assistant now has real context in every module — including safety and
aerial, which it previously could not see at all — and five new abilities:
reading a model run's results with every stored caveat quoted verbatim,
explaining why a run carries the claim tier it does and what evidence would
support a higher one, searching Grants.gov live, listing your workspace's
records so you never have to paste an id into chat, and summarizing public
engagement responses (counts and approved excerpts only — never raw
per-resident rows). The agent still cannot create model runs, promote claim
tiers, or write flight plans — those refusals are recorded and enforced by
tests.

### Drone missions you can actually fly

- **Flight planning**: draw or seed a mission area, pick a camera (or use the
  generic default), set your target resolution and overlaps, and OpenPlan
  generates a real survey grid — flight lines, photo points, distance,
  duration, and battery estimates, with every assumption stated on screen.
- **Exports a controller accepts**: DJI WPML (.kmz), Litchi CSV, and generic
  KML. Exports come from the saved, fingerprinted plan — a stale plan refuses
  to export rather than flying old settings. (First DJI Pilot 2 import worth
  checking in the field: the file deliberately omits DJI's drone-model matrix
  rather than hardcode it.)
- **Your processed imagery is downloadable**: orthomosaics, point clouds, and
  elevation models that OpenPlan verified and stored can now be downloaded
  from the processing panel. Artifacts that failed custody say why, in the
  words recorded at the time.
- Missions can start from the Aerial page itself, and project aerial status
  updates the moment a mission is created or changes status.

## 0.10.0 — 2026-08-11

**Two migrations are required before the app deploys: `20260810000002` and
`20260810000003`.** The first adds one nullable, uniquely-indexed text column
to `engagement_campaigns` (printable link names). The second creates a new
table, `engagement_campaign_projects`, with a trigger and a backfill that
copies each campaign's existing lead project into it — safe against a live
database, and existing campaigns behave identically until you use the new
capability. If the app deploys first, campaign pages fall back to lead-project
behavior and say so rather than failing.

### The app finally introduces itself

The left navigation shows its labels and group titles all the time on desktop —
six planner-first groups instead of eighteen unlabeled icons. Modules say the
same name in the nav and on the page ("Corridor Analysis" everywhere, one name
for Model Validation). Command Center folded into Overview; old links redirect.
A new **Help** page describes every module and says plainly which fixes belong
to whoever operates the deployment. Empty pages now say what the module is for
and offer the first step as a button.

### First run starts with the AI key, and can't self-destruct

Setting up a workspace now leads with "Turn on your AI assistant" — with an
honest list of what stays off without a key (the Planner Agent, comment
synthesis, drafting, translation) and a plain statement that OpenPlan itself is
free; the key is your own account with the AI provider. The getting-started
checklist no longer disappears forever the moment you create your first record,
and a permanent "Getting started" button brings it back.

### Public engagement: publish in one flow, preview first, print the link

- One guided publish flow sits at the top of the campaign console — link,
  description, intake decision, go live — ending in the real public URL. No
  more three save buttons at the bottom of a twenty-section page.
- **Preview the resident view before going live**, in any campaign state.
  Residents still cannot see anything until the campaign is Active.
- **Printable link names**: give a campaign an address like
  `/engage/jefferson-street-study` for flyers and posters. It only works while
  the campaign is live; the long secure link keeps working too.
- **Campaign templates**: corridor safety, safe routes to school, long-range
  plan input, and project open house starters — categories and draft survey
  questions a planner reviews and publishes deliberately.
- **One campaign can cover several projects**; each project's page shows the
  campaigns that cover it.
- **Survey answers export** (CSV and JSON), preserving the question wording
  each resident actually saw. Spreadsheet formula injection is neutralized in
  every CSV export.
- A live campaign with submissions waiting and nothing yet approved tells the
  operator that residents currently see an empty feed.

### Work carries across modules

The project follows you into Corridor Analysis and Model Validation instead of
being re-selected; stage-gate evidence is picked from a list instead of pasted
as an id; grant narratives can cite a project's RTP programming status; drone
mission areas can start from the project's own boundary or corridors (with the
buffer width in your control and every transformation disclosed); campaigns
show and edit their RTP attachment; and report and RTP-chapter drafting can
cite documents from the knowledge base with title and page provenance.
Corridor Analysis boundary upload now accepts KML, KMZ, and zipped shapefiles
in addition to GeoJSON.

## 0.9.0 — 2026-08-10

**One migration is required before the app deploys: `20260810000001`.** It adds
two columns to `model_runs` (an integer defaulting to 0 and a nullable text
column); nothing existing changes shape, and it is safe to run against a live
database. If the app deploys first anyway, nothing breaks — relaunching a
failed run simply doesn't record its history until the migration lands, and the
gap is written to the audit log rather than passing silently.

### A run that fails again now says so

Relaunching a failed model run resets the run in place, so a run failing for
the third time used to look exactly like one failing for the first — and the
failure message suggested "re-launch to retry" forever. The relaunch now
preserves the failure count and the last recorded reason before the reset, and
the run card says "failed 3 times with the same recorded reason — relaunching
again without changing something is unlikely to end differently." A cancelled
run is not a failure and is never counted.

### An empty map now says why it is empty

Two surfaces rendered nothing at all when a deployment had no usable Mapbox
key: the community-input map on the public engagement portal (residents
silently lost the map) and the Analysis Studio's map stage (a permanently blank
pane). Both now say the map exists and cannot be drawn, what still works
without it, and which setting (`NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`, a `pk.`
token) whoever runs the deployment can set. A token that is set but is a
secret `sk.` key is called out as wrong rather than missing.

### The public plan page gets the project map

The read-only plan page a share link opens now carries the same per-cycle
project map the agency sees — every located project, coloured by whether it is
a commitment, illustrative, or a candidate, with the same honest counts for
projects that have no location recorded. Nothing new is exposed: every
property on the map is already published by the project lists on that page.

### Creating an RTP cycle uses the place search

The cycle form now offers the same place search as the rest of OpenPlan
(any US county, city, CDP, or metro): picking a place fills the geography
label and the map pin in one step. Both stay editable, and typing a custom
label still works exactly as before.

### The sketch model's arithmetic is now measured and pinned

Two audit passes sampled the sketch travel model's choice engines and its
population synthesis with deliberate mutations; the survivors are now pinned by
tests. One real fix came out of it: the pipeline had two disagreeing parking
cost models (destination choice and mode choice priced the same zone
differently), now unified — screening results may shift very slightly. Every
expanded sketch KPI also now carries a computed disclosure of how far the
synthetic sample's zone mix drifts from the ACS distribution (0.01% VMT effect
on the benchmark package; the number is computed per run because it grows with
zone count).

## 0.8.0 — 2026-08-07

**Two migrations are required before the app deploys: `20260805000010` and
`20260805000011`.**

The first adds two columns to `census_tracts` and rebuilds the two views over
it. The second adds one column to `engagement_survey_questions`. Both add
nullable or defaulted columns; nothing existing changes shape, and both are safe
to run against a live database.

### A Title VI finding may have under-identified your low-income tracts

**The service-equity comparison divided people below poverty by the wrong
population, and the error only ever pointed one way.**

The count of people below poverty comes from ACS table B17001, whose universe is
*the population for whom poverty status was determined* — which leaves out
anyone living in a prison, a nursing home, military barracks or a college
dormitory. OpenPlan divided that count by the tract's TOTAL population instead.
The total is always the larger number, so the poverty rate was always too low,
and every tract pushed below your adopted threshold moved out of the low-income
group and into the comparison group. That is the direction that makes a
disparity look smaller.

**How big it is, measured against live Census data** (ACS 2023 5-year, 20,033
tracts across California, Texas, Ohio and Oregon):

- about **1 tract in 100** changes side of a typical low-income threshold — 206
  at 20%, 205 at 15%, 153 at 25% — and every one of them in the same direction;
- 255 tracts (1.3%) were understated by more than 5 percentage points;
- the worst cases are university and prison tracts. Tract 41003010602 in
  Corvallis, Oregon is **70.7% below poverty and was reported as 29.5%**.

The equity choropleth had the same fault, which is also why its tract figures
disagreed with the corridor rollup for the same ground.

**What to do:** if you have published a Title VI service-equity finding or a map
showing tract poverty, **reload census tracts for your counties** — the
Workspace geography panel on the dashboard now counts how many of your tracts
predate this fix and offers the reload — then re-run the comparison and compare.
Until you reload, those tracts report **no** poverty rate rather than a wrong
one: they are left out of the low-income comparison, counted, and disclosed
alongside every figure. That is deliberate. A rate divided by the wrong
population is not a smaller error than no rate at all.

The minority share is computed against its own ACS universe now too. That change
corrects the arithmetic and moves no number we could measure: across all 20,033
tracts, the race universe and the total population were identical.

### The Planning Agent can draft a survey question, and cannot ask it

Survey questions now have a **draft** state. The Planning Agent may propose the
wording of a question; it lands in your survey builder marked "Draft — not
public", where nobody outside your workspace can see it, no answer can be
recorded against it, and it is not sent for translation. A person publishes it,
or deletes it.

Nothing about your own questions changes. What you write through the survey
builder is published exactly as it always has been.

### Also in this release

- The Title VI service-equity route had **no tests at all**, while its own code
  claimed its tenant checks were tested. It has them now.
- The `[fact:id]` grounding machinery — which decides whether an AI-drafted
  grant narrative or report is defensible — was measured for the first time. Two
  real gaps were found and closed: small dollar figures and small percentages
  were not being cross-checked against the facts a sentence cited, and a
  malformed stored record could decide which sentences you were told to review.
- Interface copy that showed you the database's name for something now uses
  yours — including the run-calibration checkbox, which named a claim tier one
  way while the run's own badge named it another.
- A dependency advisory (nanoid, GHSA-2v37-7h3g-55p8) is closed.

## 0.7.0 — 2026-08-07

**One migration is required before the app deploys: `20260805000009`.**

It adds the Title VI service-equity tables and two columns to
`gtfs_feed_versions`. It creates only new objects and adds nullable columns, so
it is safe to run against a live database and nothing existing changes shape.

### A number you may have already published has changed

**Corridor poverty rates were overstated, by as much as 10×.** The corridor
analysis divided people below poverty by a denominator that EXCLUDED every
census tract reporting zero poverty, while the numerator kept counting all of
them. One poor tract among nine affluent ones reported **30% below poverty where
the truth is 3%**.

That number is not decorative: at 20% it trips a flag rendered under a
"Title VI / Environmental Justice Considerations" heading in the corridor
report. So a report generated before this release may show both a poverty rate
and an environmental-justice finding that the corrected arithmetic does not
support.

**What to do:** if you have issued a corridor report or a grant narrative that
cites a poverty rate or a Title VI flag, re-run the analysis and compare. The
minority share is unaffected. Study areas where every tract reported some
poverty were already correct — the error only appears where at least one tract
reported none.

Poverty and minority shares are now computed against their own ACS universes
(B17001 and B03002), and each is withheld entirely when its universe is missing
rather than published as 0%.

### Title VI service equity

OpenPlan can now compare transit service in a workspace's minority and
low-income census tracts against the rest of its service area, from the GTFS
feed already ingested. It is on the Data Hub, under the transit feed panel.

- **You must record your agency's ADOPTED thresholds before it will run.**
  OpenPlan supplies no defaults and offers no template to accept. FTA C 4702.1B
  thresholds are policy your board adopts and publishes; a number nobody adopted
  is indistinguishable from one that was, on a published finding. The analysis
  refuses until the policy is recorded, and names that as the reason.
- **Recording a new adoption supersedes the old one rather than editing it**, so
  a finding stays reproducible against the policy it was measured under.
- **It needs census tracts loaded for your area.** Load them from the Workspace
  geography panel. Without them the analysis says so and names the step — it
  never reports "no service" when it means "no data".
- **Service days are never combined.** A system with no weekend service is the
  most common finding there is, and a weekly total erases it.
- OpenPlan measures a difference and compares it to your adopted threshold. It
  does not determine that a disparate impact exists — that is your governing
  body's determination.

### An unreadable financial table now refuses instead of reporting

**Operator-visible behaviour change.** When the RTP financial table cannot be
read, the export now answers **503 naming the migration that is missing**,
instead of rendering the failed read as a FINDING about the plan. Previously a
database that was behind the code produced a document stating the plan had no
revenue recorded — a false statement about an agency's own plan, indistinguishable
from a true one.

### RFP responses get their solicitation back

**If you have used OpenPlan to draft a response to an RFP or RFQ, re-draft it.**
The standalone narrative drafter was silently treating every pursuit as a grant:
drafts came back with no solicitation number, no submission-format note, no
questions-due date and no past-performance grounding, and nothing said anything
had been dropped. Grant applications were unaffected.

### Model runs use your own transit feed, byte for byte

A model run now names the exact stored feed version it used, and the worker is
handed those bytes rather than a URL. A URL handoff meant the worker could be
using a cached copy from months earlier while the service-levels page showed
something newer — with both surfaces citing the same address.

### Standing up a modeling worker is now a button

- `workers/aequilibrae_worker/render.yaml` is a one-click Render Blueprint. It
  generates the trigger token so it cannot be left blank, and health-checks the
  worker so one that cannot start fails the deploy rather than going live broken.
- **`npm run doctor` now probes the worker.** A wrong URL, a missing token and a
  sleeping free-tier instance are indistinguishable from inside OpenPlan — all
  three look like a run that sits queued. The doctor says which.
- OpenPlan still works completely with no worker. That is a supported
  configuration, not a reduced tier.
- **Decided:** there will be no OpenPlan-hosted shared worker. `SELF_HOSTING.md`
  previously described this as an open question; it is not.

### Texas and Ohio grant programs

The program catalog now covers Texas and Ohio alongside federal, California,
Washington, Oregon and Colorado.

Two things worth knowing. **Texas runs no standalone Safe Routes to School
program** — that work competes inside Transportation Alternatives — and TxDOT's
statewide TA call covers only areas of 200,000 or fewer; above that your MPO runs
its own. **The Ohio bundle is deliberately two programs**, because ODOT's website
answers 404 to any non-browser request and no program URL could be confirmed to
resolve. The programs left out are named in the source with the reason, rather
than shipped with links that go nowhere.

### Under the hood

Two mutation audits measured what the test suite actually protects. The first
found 34 of 64 mutations testing nothing; the second, aimed at everything a
Title VI finding stands on, found 23 of 44 — including that the corridor
minority share could be replaced by its own complement with all 7,471 tests
green. Both are recorded in `foundation-audit-ratchet.test.ts` as a ledger that
may only shrink. The open ledger is now empty.

## 0.6.0 — 2026-08-06

**Migrations are required before the app deploys, in this order:**
`20260805000004`, `20260805000005`, `20260805000006`, `20260805000007`,
`20260805000008`.

`20260805000004` stops two periods of one plan claiming the same year. If your
plan already has overlapping periods the migration will REFUSE to apply and tell
you how many — it will not edit or delete your periods to make itself apply.
Resolve the overlaps, then run it again.

`20260805000006` also **raises the `gtfs-uploads` storage bucket ceiling from
50 MiB to 200 MiB.** If your Supabase project has a global upload cap lower than
that, raising the bucket does not lift it — the largest US transit feeds are
around 94 MiB, so a project cap below that will refuse them with a storage error
at the end of an upload rather than anything a planner can act on.

### Transit feeds can be brought in

A planner can now bring their transit operator's published feed into OpenPlan
three ways: search the national feed catalog by their own geography, paste the
operator's feed address, or upload a `.zip`. It is on the Data Hub.

- **What OpenPlan stores is SERVICE LEVELS, never the timetable.** It answers
  "how often does the bus come here, and for how many hours a day". It does not
  and will not answer "what time is the 4:15" — it reads no real-time feed, so
  any such answer would be a promise to a rider made from a schedule that may be
  months out of date. Departure times are counted during the read and discarded.
- **Most published feeds in the catalog are out of date, and OpenPlan now says
  so.** Of four real Sacramento-area feeds checked on 2026-08-05, three had
  expired — one sixteen months earlier. The catalog does not publish an expiry,
  so it is only knowable after the feed is downloaded and read. Every surface
  that shows a feed shows the dates its schedule actually covers.
- **A refetch that comes back materially smaller is stored but NOT adopted.** If
  refreshing a feed derives more than 20% fewer routes or stops than the version
  in use, OpenPlan keeps the new version, leaves the old one in service, and
  says why — a truncated download and a real service cut look identical, and
  only a person should decide which one happened. Adopting it anyway is one
  click, on purpose.
- **Feed addresses are checked before they are fetched.** A feed URL pointing
  inside the deployment's own network — including through a redirect — is
  refused. Operators who need to fetch from a specific internal host can set
  `OPENPLAN_OUTBOUND_ALLOWED_HOSTS`.
- New optional operator settings, all with working defaults:
  `OPENPLAN_GTFS_MAX_ARCHIVE_BYTES`, `OPENPLAN_GTFS_MAX_CATALOG_BYTES`,
  `OPENPLAN_GTFS_PARSE_BUDGET_MS`.
- **A scheduled sweep runs every 15 minutes** (`/api/cron/reap-gtfs-ingests`,
  registered in `vercel.json`) closing feed ingests that stopped responding, so
  a killed process cannot leave a feed reading "parsing" forever. It needs
  `CRON_SECRET` set; without it the route is closed rather than open.

### Transit feeds reach the map and the corridor score

- **A transit layer on the map**, off by default, drawing the stops your own
  ingested feeds serve on a typical weekday, coloured by how often service comes.
  It draws stops and not route lines: a route's real shape comes from a file
  OpenPlan does not read, and a straight line drawn between consecutive stops
  would be a picture of a road nobody built. When the map cannot draw every stop
  it says which ones it left out — the least-served — rather than only that it
  left some out.
- **Corridor accessibility now uses your ingested feeds instead of an
  OpenStreetMap stop count**, and this can MOVE A NUMBER YOU HAVE ALREADY PUT IN
  A GRANT APPLICATION. Read this part.
  - Half the transit contribution is now how often service actually comes, not
    just how many stops there are. A corridor with many stops and infrequent
    service will score LOWER than it did. A corridor with few stops that are
    frequently served will score HIGHER. Both directions are correct — a bus
    every 15 minutes is worth more than three stops nobody can catch — but if a
    number of yours moved, this is why.
  - **A workspace that has ingested no feed sees no change at all.** The old
    measurement is untouched for everyone still using it.
  - **Runs already saved are never rewritten.** An old run keeps the number it
    was given and records how it was measured; it does not silently acquire a
    new one.
  - **Two runs measured different ways will not be subtracted.** Comparing a run
    from before this release against one from after shows "not comparable" for
    the affected figures, with the reason, rather than a difference that reads
    as service having changed when only the measuring did.
  - Every screen and report that prints a transit figure now names how it was
    measured.
- **A feed whose schedule has expired still counts.** Refusing to measure it
  would quietly RAISE the surrounding score by spreading the remaining points
  wider, which would leave an agency with an out-of-date feed looking better than
  one with a current feed. It counts, and it says the schedule has expired.

### Fiscal constraint

- **A plan whose periods cover only part of its horizon no longer reports
  itself fiscally constrained.** If your plan runs to 2050 and your periods stop
  at 2035, the years in between were accounted for by nothing and the totals
  described only part of the plan. The finding is now withheld and names the
  uncovered years. **If a plan of yours previously read "fiscally constrained"
  it may now read "not determined" — that is the correction, not a regression.**
- **Periods may not overlap.** Two periods claiming the same year made the
  plan's own escalation ambiguous, because each period escalates its money to
  its own expenditure year. Adjacent periods are fine: one ending 2035 and one
  starting 2036.
- A period falling outside the plan's stated horizon is still allowed — there
  are real situations for it — but the screen now says so rather than staying
  silent.

---

## 0.5.0 — 2026-08-05

**Regional Transportation Plans can now answer whether they can be paid for.**
This release adds the financial element an RTP is adopted against — revenue,
the cost of operating and maintaining the system, per-project programmed costs,
and a fiscal-constraint finding — plus the project lists, a per-cycle map, a
public draft-review page, and a comment-response record.

**A migration is required before the app deploys:** `20260805000003`. It adds
three tables — `rtp_horizon_bands`, `rtp_financial_assumptions`,
`rtp_performance_measures` — and adds columns to `rtp_cycles`
(`financial_basis_year`, `annual_inflation_rate`) and to
`project_rtp_cycle_links` (`horizon_band_id`, `estimated_cost`,
`cost_basis_year`, `updated_at`). Nothing is dropped or rewritten, and every
new column is nullable, so applying it changes nothing you can see until the
financial-element screens land.

Also in this release, and visible immediately:

- **Regional Transportation Plans no longer cite California statutes to
  agencies outside California.** Project priority scores were annotated with
  "CEQA §15064.3 · SB 743" and three other California authorities for every
  workspace in the country, including on the public plan page an agency shares
  with residents. Priorities now carry the policy basis of the jurisdiction
  the workspace records as its home, and a workspace that has not recorded one
  cites nothing rather than borrowing another state's law. If your plan pages
  previously showed California citations and your agency is not in California,
  they will change.
- **The federal policy basis no longer names Justice40**, which was terminated
  in January 2025. It cites the federal planning regulation instead.
- **The "publish this plan" control now appears on every RTP cycle.** It was
  previously hidden on cycles with no projects attached yet, and on cycles
  whose project list failed to load.
- **Plan details can be corrected after creation** — title, geography label,
  horizon years, adoption date, public review window, summary, and map pin.
  Previously these could only be set when the cycle was created.
- **Public plan pages are no longer indexable by search engines.** The share
  link is the credential, so it should reach only the people you send it to.

New in the RTP module:

- **A financial element.** Declare the periods your plan programmes money
  across, record revenue and the cost of operating and maintaining the system
  against each, and give each project its cost in this plan. OpenPlan then
  reports whether the constrained programme can be paid for, period by period.
- **It says "not determined" rather than guessing.** If a constrained project
  has no cost recorded, or no revenue has been entered, or amounts sit in
  different base years with no inflation rate to reconcile them, the finding is
  withheld and names what is missing. A plan with gaps in it will never report
  itself fiscally constrained.
- **Year-of-expenditure dollars.** Record costs in constant dollars with a base
  year and set an annual inflation rate, and OpenPlan escalates them to the
  year each period expects to spend. With no rate recorded it reports constant
  dollars and says so, rather than presenting them as year-of-expenditure
  figures.
- **Project lists grouped by period**, with each project's cost and a subtotal
  that never counts an unpriced project as zero.
- **Performance measures** — baselines and targets with the source each
  baseline came from.
- **A map of the plan's projects**, coloured by whether they are in the
  constrained programme or on the illustrative list. It states how many
  projects have no location recorded rather than quietly drawing fewer.
- **A public draft-review page** at the same share link, showing the plan's
  chapters, its financial element and its project lists, and saying plainly
  whether public review is open, has not opened, or has closed.
- **A comment-response record** pairing approved public comments with the
  agency's published responses. Comments still awaiting moderation never
  appear. An unanswered comment is flagged as outstanding; it does not block
  adoption.

Two notes for whoever generates board packets:

- Board packets have been rendering every project as **unscored** because the
  packet's query omitted the priority scores. Fixed — existing packets will
  show priority tiers when regenerated.
- The financial element and the comment-response record are now in every
  packet stage, and in the Export HTML/PDF buttons as well as in generated
  packets. Those two paths previously produced different documents.

---

## 0.4.0 — 2026-08-05

**OpenPlan stops assuming California.** Six registries shipped with a single
entry each, so California got real capability and the other forty-nine states
got an honest disclaimer. This release gives every US agency a delivery
template, a reimbursement vocabulary, and — in three more states — a funding
catalog of their own.

**Requires three migrations** if you are coming from 0.3.0 (`20260804000001`,
`20260804000002`, `20260805000001`). Run
`npm exec -- supabase migration up --linked` (locally: without `--linked`)
before deploying, as always. None of them modifies an existing row: the two
dated `20260804…` migrations set table permissions (a no-op on any database you
already have — see "Fresh installs" below), and `20260805000001` changes only
what NEW workspaces are born holding.

### A federal-aid delivery template for the whole country

The new **US Federal-Aid Delivery Floor** carries eight gates built from the
rules that hold anywhere in the United States — the Uniform Guidance (2 CFR
200), the federal-aid highway rules (23 CFR), NEPA, and the Uniform Relocation
Act (49 CFR 24) — with the evidence each gate actually requires. Where a
regulatory figure matters, the template cites the section (for example
2 CFR 200.501 for the single-audit threshold) instead of restating a number
that would quietly go stale.

It states its own limits where you choose it: your state DOT's local-agency
manual implements these same steps and may add its own; FTA-funded transit
follows different mechanics and is not covered; state environmental law (CEQA,
SEPA) is an overlay it does not carry.

What you will notice:

- A workspace anywhere in the US now gets this template as a real jurisdiction
  match rather than a labelled assumption. California workspaces keep the
  California pack.
- An existing workspace that has stated a non-California US geography will see
  its stage-gate panel report that a template for its jurisdiction now exists,
  with a rebind offer. **Rebinding never edits or deletes a recorded gate
  decision** — decisions recorded against gates the new template does not
  define stay exactly as signed and stop appearing on project boards while that
  template is bound. The panel names those gates before you confirm.
- New workspaces are born bound to the federal template (that is the migration).

### Reimbursement vocabulary that is not one state's

A grant-reimbursement draw in a non-California workspace was logged under
Caltrans LAPM posture names, disclosed as assumed. There is now a **generic US
federal-aid reimbursement profile** — progress invoicing, final-only, retention
in effect, or agreement-terms-deferred — carrying a documentation checklist for
what a complete reimbursement package contains anywhere, with the indirect-cost
basis citing 2 CFR 200.414(f) rather than restating a rate. Its framing line is
the honest one and shows wherever the profile does: your executed funding
agreement controls; where it differs from the profile, the agreement wins.
California keeps LAPM.

### Washington, Oregon and Colorado funding catalogs

Fifteen state programs, each verified against its own official page on
2026-08-05: Washington (TIB Urban Arterial, Small City Arterial, Small City
Active Transportation, Complete Streets; WSDOT Pedestrian & Bicycle and Safe
Routes to School; FMSIB freight), Oregon (ODOT Safe Routes to School, Oregon
Community Paths, Connect Oregon, Small City Allotment, Great Streets, and the
joint ODOT/DLCD TGM planning grants), and Colorado (the Multimodal
Transportation and Mitigation Options Fund, and Safe Routes to School).

Two candidates were **dropped rather than shipped on memory**: Colorado's
Revitalizing Main Streets, whose own page states it no longer has funding to
award, and "CDOT planning grant cycles", which is not a program CDOT offers —
planning studies are an eligible cost under MMOF, which that entry now says.
Two others were corrected to their current names: TIB's Small City Sidewalk
Program now runs as the Small City Active Transportation Program, and MMOF's
name now includes "and Mitigation".

### A wrong-template bug fixed before it could reach anyone

Registering a second template exposed a latent fault: the report detail page,
the packet generator, and the assistant's project context all built their gate
boards on whichever template was the registry default rather than the one the
workspace is bound to. With one template registered the two were always the
same id, so nothing was ever wrong on screen — but with two, a California
workspace's recorded gate decisions would have matched none of the federal
template's gates and rendered as "no decision recorded" on every one, inside a
packet an agency sends to a funder. The board builders now require the caller
to state the bound template, and a workspace whose binding cannot be
established gets an explicit "could not be checked" instead of a board. Packet
generation refuses (409) rather than freezing gate names nobody bound.

Related: a workspace created before this release still holds the old default
template id, and that id cannot tell us whether an agency chose California's
gates or merely inherited them. OpenPlan now treats every id the column default
has ever stamped as an assumption to be disclosed, not a choice to be reported.

### Fresh installs work again under newer Supabase CLI versions

**Requires one migration** (`20260804000002`). Run
`npm exec -- supabase migration up --linked` (locally: without `--linked`)
before deploying, as always. On every EXISTING database this migration is a
no-op — it changes nothing you already have.

Newer versions of the Supabase CLI (the jump from 2.76 to 2.111 in this repo's
lockfile) changed what a brand-new local database grants by default: tables
created by migrations no longer give the application's own server role — or any
signed-in user — permission to read or write rows. Existing databases are
unaffected because their tables keep the permissions they were created with,
which is why nothing looked wrong on machines that had been running OpenPlan
all along. But a FRESH install — a new agency following the README, a CI
`db reset` — produced a database the app could not use at all: every screen
failed, and the setup instructions led to a dead end.

The migration restores exactly the intended posture on fresh databases: the
server role gets its full access back, signed-in users get the table access
that row-level security then narrows per workspace (the same posture every
existing deployment has always had, and the one the live isolation tests
verify), and the deliberately locked-down tables from 0.3.0's security fix
stay locked down. It was verified against a from-scratch database, and the
live isolation suite now runs on every pull request rather than once nightly —
which is how this was caught.

---

## 0.3.0 — 2026-08-03

**This release contains a security fix. Upgrade promptly.** If you run a
deployment that has ever loaded a transit feed, treat this as urgent; if you have
not, it is still worth doing now, because the hole opens the moment you do.

**Requires migrations — and for the security fix, the migrations *are* the fix.**
This release adds six. Four of them (`…000008` through `…000011`) are the
security repair, and they are pure SQL: ten `ALTER TABLE` and fourteen `REVOKE`,
with no application code involved. That means **running the migrations closes the
hole on its own**, even if you cannot deploy new code today. Run
`npm exec -- supabase migration up --linked` **before** deploying the app, as
always.

### Security: eight tables had a tenant boundary that had never been switched on

Eight tables holding transit-network data — agencies, routes, stops, trips, stop
times, shapes and both calendar tables — each carried a correct access rule
restricting them to the workspace that owns the feed. On none of them had that
rule ever been *switched on*. In Postgres a policy and the setting that enforces
it are two separate things, and only the first had ever been written. The
database stored the rule, listed it, and applied it to nothing.

What that meant in practice, confirmed against a running database using only the
public key and no account at all: an anonymous visitor could read a workspace's
private transit network, add to it, rename a route, and delete a stop. In the
same test the **parent** table correctly refused the same visitor — which is what
made the diagnosis certain. The boundary had been designed and reviewed, and then
never armed.

**Honest scope.** No feature in OpenPlan writes those eight tables yet, so on most
deployments there was little or nothing in them to expose. This is fixed now
because it stops being harmless the first time an agency imports a GTFS feed.

**What the fix changes, and what it does not.** It switches the existing rules on
and removes anonymous write access as a second, independent lock. It does not
alter a single access rule — all 552 were already correct. Members' access to
their own data was measured before and after and is unchanged, and genuinely
public feeds stay public. Two reference tables (census tracts and LODES) also had
anonymous write access removed while staying publicly readable.

**Why it went unnoticed for four months.** The test guarding those rules read the
*text of the migration files* rather than asking the database, so it could not see
that what it was reading had never taken effect. Two checks replaced it, and it
matters which does what *(corrected 2026-08-04 — this entry originally claimed the
live check "fails the build", which overstated its mechanism)*: a build-time check
derived from the migrations fails **every build** if a declared table lacks
`ENABLE ROW LEVEL SECURITY`, and a **live** check with no exception list asks a
running database the same question — but the live check runs only in the nightly
scheduled job and on demand (`npm run test:rls-live`), not on every build, so
drift introduced directly against a live database surfaces within a day, not
instantly.

### The assistant records who did the work

When the planning assistant performs an action, the record now distinguishes the
agent that authored it from the person who approved it and the session it ran
under — three different things that had been collapsed into one. An agent acting
on its own behalf is recorded as itself rather than as the person, because
authorising an action is not the same as having written it.

### Regional transportation plans

A model run cited as evidence now travels with its engine, its status and its
claim tier, and a run that failed or is screening-grade carries a plain warning
next to the citation. Nothing is hidden or refused — a planner may still cite any
run, including a preliminary one, which is often the right thing to do in a draft.
The defect was that a reader could not tell a calibrated run from a failed sketch,
not that the citation existed.

### Setting up and operating a deployment

- **`npm run doctor`** checks an installation and says what is wrong in plain
  language. Most failures in the setup path are silent — Docker answers while it
  is off, and a working `supabase start` looks frozen for ten minutes — so the
  install now reports its own state instead of leaving you to infer it.
- **The dead billing schema is labelled in the database itself,** so nobody
  mistakes the leftover Stripe tables for something the product uses. OpenPlan is
  free and has no paid tier; those tables are inert and are being left in place
  deliberately rather than dropped against a hosted database.
- **Two dependencies the build had been using by accident are now declared,** so a
  clean install builds the same way yours does.

### Documentation

The install guide no longer implies it is written for someone other than the
planner reading it, every dated record now says on its face that it describes a
moment rather than the current state, and product copy that read like the tooling
that generated it has been rewritten.

---

## 0.2.0 — 2026-07-30

The first tagged release. Everything before this was untagged development; the
version had sat at `0.1.0` since the initial commit because nothing read it.

**Requires migrations.** This release adds five: campaign accessibility
contacts, submission geofencing, survey response drafts, aerial artifact
custody, and a grant revoke on the custody ledger. Run
`npm exec -- supabase migration up --linked` **before** deploying the app.
OpenPlan degrades honestly when a column is missing — it says a thing could not
be read rather than reporting nothing found — but on the public engagement
portal the person reading that is a member of the public, so deploying ahead of
your migrations turns an upgrade into a window where residents are told the map
could not be loaded.

### Community engagement

- **The participant portal speaks eleven languages.** It resolves a resident's
  language from `?lang=`, then their browser, then English; carries `dir` and
  `lang` down to each run of text so Arabic and Farsi read correctly; and says
  plainly what it has *not* translated rather than presenting English as the
  agency's choice. Spanish is complete; the other nine offer the language picker
  and the coverage notice. An operator can author translations per campaign, and
  machine translations are labelled as such until a person accepts them — at
  which point the agency becomes answerable for the wording, which the interface
  states before you click.
- **A resident who cannot use the portal can still take part.** Campaigns record
  a contact — in the agency's own words, never defaulted by OpenPlan — for
  arranging another way to participate. It renders in the resident's language.
  OpenPlan makes no accessibility-conformance claim, and a test fails the build
  if one appears.
- **Comment that never came through the portal can be imported.** Open-house
  comment cards, the project inbox, meeting transcripts: CSV import with a
  preview that refuses the whole file if any row is bad. Everything imports as
  `pending` and goes through the same moderation queue. Imported comment cannot
  be recorded as a public portal submission — that means somebody submitted it
  themselves under a rate limit and a share token, which a spreadsheet row
  cannot be given afterwards.
- **Submissions can be held to the campaign's own area.** Opt-in per campaign,
  and only where the campaign has recorded a place. Every vertex of a drawn
  shape is checked, not its centre. A comment with no location is not outside
  the area and is still accepted.
- **A survey can be left and come back to.** Partial answers are saved against a
  resume credential that never appears in a URL and is stored only as a hash.
  Drafts live in their own table, so no response count, aggregate or
  representativeness reading can mistake an abandoned draft for turnout.
- **Survey questions can depend on earlier answers,** evaluated on the server as
  well as in the browser. A hidden question is neither required of a respondent
  nor recorded from one.
- **The spatial hotspot test no longer assumes a downtown.** The clustering
  radius is adjustable, because one fixed radius is a claim about geographic
  scale that is wrong for a rural county.

### Aerial

- **Processing artifacts are taken into custody.** Orthomosaics, point clouds
  and DSMs were recorded as time-limited vendor links, so the deliverables of a
  flight — and the evidence under any analysis built on them — became
  unreachable when those links expired, while the job still read `succeeded`.
  The bytes are now fetched into private storage with a checksum, per artifact,
  and the interface distinguishes held, still-recoverable, and gone.
- **Processing jobs are visible.** Job status, progress, outputs and failure
  reasons had been recorded since the first aerial migration and no page read
  them. An operator who dispatched a flight saw a page that looked as though
  nothing had happened.

### Scenarios, models, workspaces

- **A scenario comparison can say what it assumed.** Assumption sets, data
  packages and indicator snapshots can be recorded and read; previously only
  comparison snapshots had any surface, so three quarters of the provenance
  chain was invisible.
- **A county run says whether it can be validated,** listing every blocker and
  the exact command, instead of going quiet at the step where operators get
  stuck.
- **An invitation can be read, and refused.** Following an invite link and
  signing in used to join you to a workspace you had never been shown. The link
  now lands on the invitation — workspace, role, who sent it, when it expires —
  with accept and decline as two buttons. Reading one writes nothing.

### For operators

- **A deployment now names itself.** The dashboard shows the version and the
  commit it was built from. On Vercel the commit is automatic; on other hosts
  set `OPENPLAN_COMMIT_SHA` at build time. Where it is unset, the interface says
  the commit is unrecorded rather than inventing one.
- **New setup documentation.** [`FIRST_DEPLOYMENT.md`](openplan/docs/FIRST_DEPLOYMENT.md)
  is a 20-minute checklist from nothing to a working address;
  [`SELF_HOSTING.md`](openplan/docs/SELF_HOSTING.md) explains each service; and
  the README now installs Node and Docker step by step for Windows, macOS and
  Linux.
- **New optional settings:** `OPENPLAN_AERIAL_ARTIFACT_MAX_BYTES` caps artifact
  custody downloads, and `OPENPLAN_COMMIT_SHA` records the build commit. Both
  have working defaults.

### Removed

- `POST /api/models/[modelId]/runs/[modelRunId]/skims` — a redundant duplicate
  of a path the modeling worker already uses directly, and a lossier one: it
  accepted a period and mode, echoed them, and stored neither. Skim matrices
  were already downloadable from the run's artifact list and still are.

---

## 0.1.0

Initial development. Untagged.
