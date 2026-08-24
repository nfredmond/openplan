# First-week readiness work list — 2026-08-24

These findings were confirmed in the fresh-account review but did not stop a planner from reaching the milestone outcome. They remain real product work; this list prevents them from being lost or upgraded into claims the evidence did not support.

Raw evidence stays local under `/home/nathaniel/.local/state/openplan/first-week-runs/2026-08-24T04-52-45-722Z/`. Screenshots contain tenant state and are not committed.

The post-fix California setup check is under `/home/nathaniel/.local/state/openplan/first-week-runs/2026-08-24T06-31-21-739Z/` for the same reason.

The complete seven-job baseline is under `/home/nathaniel/.local/state/openplan/first-week-runs/2026-08-24T07-18-50-771Z/`. The harness verified all seven reports and recorded zero blocked or failed jobs.

The first affected-journey rerun is under `/home/nathaniel/.local/state/openplan/first-week-runs/2026-08-24T08-22-15-277Z/`. It confirmed the earlier safety fixes and exposed the project-import, corridor-discoverability, and PDF-download blockers fixed after that run.

The final affected-journey rerun is under `/home/nathaniel/.local/state/openplan/first-week-runs/2026-08-24T08-58-52-418Z/`. All three jobs completed with no blocked or failed run. The project journey used the reviewed CSV, project map upload, PDF preview, and PDF download from visible entry points.

## Daily reminders have no in-product enable control

- Reproduce: create an account, finish the home-geography setup, open **My Work**, and read the deadline-reminder status.
- Observed: the page says daily deadline reminders are disabled but offers no enable action or named handoff.
- Evidence: `01-first-day-setup/agent/evidence/f1.png` and `f1.snapshot.txt`.
- Milestone decision: confusing, not blocking. My Work still presents the daily queue and the planner can complete work without email reminders.
- Follow-up: add a self-service owner control or name the local operator setting and its effect.

## Oregon setup describes the federal floor as the jurisdiction template

- Reproduce: create an Oregon workspace, save Multnomah County as the home geography, and review the dashboard stage-gate setup card.
- Observed: the generic federal interim floor is described as the template for the workspace's jurisdiction. The limitation exists, but the wording makes a shared floor sound locally configured.
- Evidence: `01-neutral-geography-setup/agent/evidence/f1.png` and `f1.snapshot.txt`.
- Milestone decision: confusing, not blocking. The shared workflow remains usable and the product does not claim that Oregon law is configured.
- Follow-up: replace “your jurisdiction” language with a plain statement that no state or local legal bundle is configured.

## California setup leaves the federal interim stage-gate active

- Reproduce: create a California workspace, save Fresno County as the home geography, and review the stage-gate setup card.
- Observed: the workspace still shows the federal interim floor as active even though a California template is available.
- Evidence: `01-first-day-setup/agent/evidence/f1.png` and `f1.snapshot.txt` in the post-fix run.
- Milestone decision: confusing, not blocking. Projects and packets remain usable, and the active template is disclosed rather than silently described as California law.
- Follow-up: bind the matching configured bundle during geography setup, while preserving the neutral federal floor when no jurisdiction bundle exists.

## Oregon land-use plans default to the California legal bundle

- Reproduce: in the same Oregon workspace, open **Land Use Plans** and start a new comprehensive-plan record.
- Observed: the legal-bundle selector defaults to California; the planner must change it to **Local requirements not configured**.
- Evidence: `01-neutral-geography-setup/agent/evidence/f2.png` and `f2.snapshot.txt`.
- Milestone decision: confusing, not blocking. The incorrect default is visible and editable before creation, and the neutral workflow succeeds after correction.
- Follow-up: derive the default from the saved home geography; use the unconfigured neutral bundle when no matching registry entry exists.

## Crash acquisitions do not state an exact source cutoff

- Reproduce: open **Safety**, retrieve registered crash data, and review **Crash data coverage** and **What you have imported**.
- Observed: source, requested years, acquisition date, reported count, and geocoded count are shown, but there is no exact source refresh or “current through” date.
- Evidence: `04-safety-case/agent/evidence/f1.png` and `f1.snapshot.txt`.
- Milestone decision: confusing, not blocking. The acquisition still carries source, requested period, retrieval time, counts, coverage, and completeness caveats; those facts support a qualified artifact.
- Follow-up: extend source manifests with a source-published cutoff only when the source itself exposes one. Do not infer a cutoff from the acquisition date.

## CSV intake reviews one candidate, not a whole portfolio

- Reproduce: attach a multi-row project CSV in **Documents**, then open the project record.
- Observed after the milestone fix: the project Funding tab stores and indexes a CSV, lets the planner map its columns and review the rows, then applies one selected candidate's name, description, estimated cost, currency, and source together. It does not map an entire file into many project records.
- Evidence: baseline `02-project-end-to-end/agent/evidence/f2.png` and `f2.snapshot.txt`; the post-fix rerun is recorded in the readiness report.
- Milestone decision: non-blocking after the reviewed single-candidate path shipped. Bulk import still needs duplicate handling and a per-row create/skip decision; silently creating a portfolio is outside this milestone.
- Follow-up: extend this reviewed surface if portfolio-scale import becomes a named planner outcome. Reuse the same Knowledge Base upload and project write path.

## Ranked crash locations use coordinates, not inferred road names

- Reproduce: open **Safety**, retrieve crash data, and review **Ranked KSI locations**.
- Observed: each location shows exact latitude and longitude, crash and KSI counts, source, method, and rank. It does not name a nearby road or intersection.
- Evidence: affected-journey rerun `04-safety-case/agent/evidence/f1.png` and `f1.snapshot.txt`.
- Milestone decision: confusing, not blocking. Exact source coordinates are auditable and map correctly; inventing a street label without a named geocoder would weaken the evidence.
- Follow-up: add an optional geocoding adapter whose provider, lookup date, and returned label are stored beside the coordinate. Keep the coordinate as the source fact.

## The printable project map has no street background

- Reproduce: attach a hand-drawn or uploaded study area and corridor to a project, generate a board packet, and read its project-geography drawing.
- Observed: the packet draws the stored shapes, extent, orientation, and scale without streets, place labels, or aerial imagery. When the uploaded shape has no resolved place identity, the packet says so.
- Evidence: final rerun `04-safety-case/agent/evidence/f2.png` and `f2.snapshot.txt`. The harness fixture was near longitude and latitude zero while the workspace was Mendocino County, so assigning it a Mendocino label would have been false.
- Milestone decision: confusing, not blocking. The drawing is explicit about what it can establish, and the safety evidence names exact source coordinates. A decorative or mismatched street image would be worse than the disclosed gap.
- Follow-up: research a reproducible, printable, open-data street-background renderer with frozen source/version metadata. Do not screenshot a live tenant map into the evidence packet.

## An unset modeling-worker posture warns before the first run

- Reproduce: leave `OPENPLAN_MODELING_WORKER` unset on a fresh local deployment and open **Overview**.
- Observed: deployment configuration says the app cannot observe a poller with no heartbeat, warns that the first worker-backed run would wait for the reaper, and gives both supported operator configurations before the planner launches it.
- Evidence: final rerun `01-first-day-setup/agent/evidence/f1.png` and `f1.snapshot.txt`.
- Milestone decision: configuration limitation, not a product dead end. The warning is visible before launch and accurately names what the operator must set. This test deployment deliberately did not claim a worker that was not running.
- Follow-up: add a worker heartbeat so an installed poller can prove liveness rather than relying on operator posture. Keep launch refusal when the deployment explicitly records the worker as absent.

## Corridor screening scores need a clearer precision posture

- Reproduce: complete **Corridor Analysis**, then compare the integer component scores with the source-check caveats below them.
- Observed: the page reports whole-number scores while several inputs are screening proxies or unavailable. The caveats are visible, but the numeric presentation can still read as more precise than the inputs.
- Evidence: baseline `05-analysis-corridor/agent/evidence/f3.png` and `f3.snapshot.txt` (the harness discarded the submitted finding because its snapshot URL did not match; the page snapshot and console trail remain local investigation evidence, not a confirmed harness finding).
- Milestone decision: not a blocker. The result itself is readable, labels confidence, and names unavailable sources; changing the score contract requires a modeling-product decision, not a readiness patch.
- Follow-up: research bands, ranges, or score suppression when required inputs are missing. Preserve the underlying arithmetic and claim-tier disclosures.

## A blank workspace cannot truthfully simulate legal adoption

- Reproduce: create a California land-use plan in a fresh account and attempt to mark a required legal process step complete without an actual completion date.
- Observed: OpenPlan refuses the unsupported completion record, so a fresh-account agent with no real hearing, consultation, environmental-review, or adoption evidence cannot finish the legal lifecycle.
- Evidence: baseline `06-land-use-plan/agent/evidence/f1.png` and `f1.snapshot.txt` (discarded by the harness because the snapshot did not establish the submitted route).
- Milestone decision: limitation, not a product blocker. Weakening the required date would let an exercise note masquerade as an operative legal record. The deterministic exercise smoke covers workflow mechanics with explicitly synthetic fixtures; the fresh journey correctly stopped rather than inventing evidence.
- Follow-up: if product direction calls for a training sandbox, isolate it structurally from real plan records and public URLs. Do not add an “exercise” escape hatch to legal completion fields.

## Resolution notes — v0.30.0

The original observations above remain unchanged as the record of what the
v0.29.0 fresh-account run found. The following items were closed on 2026-08-24:

- **Oregon setup describes the federal floor as the jurisdiction template:**
  resolved. The dashboard now says that the country-level federal floor matched
  `US-OR`, that no Oregon-specific pack is registered, and that the displayed
  gates do not state requirements unique to Oregon.
- **California setup leaves the federal interim stage-gate active:** resolved.
  Saving a California home geography now binds the registered California pack
  in the same workspace update. Selection provenance distinguishes that
  automatic match from a planner's explicit choice.
- **Oregon land-use plans default to the California legal bundle:** resolved.
  The creator now matches configured bundles from registry coverage and selects
  **Local requirements not configured** when no unique match exists.

Fresh local browser evidence for the closure remains outside the repository at
`/home/nathaniel/.codex/scratch/openplan-v030-evidence/`. It covers California
and Oregon at desktop and 390-by-844 widths; the Oregon journey also proves that
an explicit stage-gate override survives a later geography change.
