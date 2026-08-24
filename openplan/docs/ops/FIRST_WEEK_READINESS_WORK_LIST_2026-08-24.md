# First-week readiness work list — 2026-08-24

These findings were confirmed in the fresh-account review but did not stop a planner from reaching the milestone outcome. They remain real product work; this list prevents them from being lost or upgraded into claims the evidence did not support.

Raw evidence stays local under `/home/nathaniel/.local/state/openplan/first-week-runs/2026-08-24T04-52-45-722Z/`. Screenshots contain tenant state and are not committed.

The post-fix California setup check is under `/home/nathaniel/.local/state/openplan/first-week-runs/2026-08-24T06-31-21-739Z/` for the same reason.

The complete seven-job baseline is under `/home/nathaniel/.local/state/openplan/first-week-runs/2026-08-24T07-18-50-771Z/`. The harness verified all seven reports and recorded zero blocked or failed jobs.

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

## CSV intake is citable but not a bulk project importer

- Reproduce: attach a multi-row project CSV in **Documents**, then open the project record.
- Observed after the milestone fix: OpenPlan can search and cite each parsed row, and a planner can record one candidate's identity and sourced estimated cost. It does not map an entire file into many project records.
- Evidence: baseline `02-project-end-to-end/agent/evidence/f2.png` and `f2.snapshot.txt`; the post-fix rerun is recorded in the readiness report.
- Milestone decision: non-blocking after deterministic CSV parsing and the sourced cost field shipped. Bulk import needs explicit column mapping, row review, and duplicate handling; silently guessing those is worse than manual entry.
- Follow-up: design a reviewed CSV-to-project import using the parsed rows already in the Knowledge Base. Do not add a second upload path.

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
