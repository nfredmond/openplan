---
id: 11-model-validation-evidence
title: Decide what a baseline model's observed-count evidence actually establishes
account: run
files: none
maxTurns: 420
---

You are reviewing a real baseline travel-model run before its results are used
in a planning discussion. An inconclusive assessment is an acceptable and useful
answer; your job is to understand the evidence, not to make the model pass.

Sign in at {{BASE_URL}} with {{EMAIL}} / {{PASSWORD}}.

**What you need to have done:**

1. Start from the signed-in landing page and use visible navigation to reach
   Models. Review the v0.44 distributed work-loading checkpoint first. For all
   seven counties, switch between AequilibraE and ActivitySim and download each
   method's exact loading input, pre-output audit, and development comparison.
   Download one artifact at a time and wait for each download to finish before
   starting the next; do not batch-click the 42 controls. Compare every exact
   filename and full SHA-256 shown on screen, and preserve all downloaded files
   for the repository's independent byte-level verifier. The browser cannot
   inspect local download bytes, so do not claim that it computed those hashes.
   Confirm the methods remain separate, LODES supports work travel only,
   non-work demand is unchanged, unroutable demand is retained, distinct source
   states remain visible, the run imposed no arbitrary point or gateway cap,
   and neither a default nor an untouched holdout changed. An inconclusive or
   retired candidate is useful evidence and must not be presented as
   calibration or validation.

   Then review the v0.43 structural demand/loading diagnosis, the v0.41
   comparable-observation instrument, and the v0.40 frozen diagnosis history.
   In v0.43, select one county, switch between AequilibraE and ActivitySim, and
   confirm the values are separate rather than averaged. Download both methods'
   exact pre-output audits and post-output diagnoses and verify each downloaded
   SHA-256 against the full hash on screen. Confirm LODES vintage and use remain
   unknown, non-work through travel is unsupported, the through share is an
   assumption, and the result is structural coverage rather than improved
   accuracy. Download the v0.41 exact study result, one observation
   package, and its pre-volume full-geometry match audit. Confirm the screen calls
   this repaired instrument coverage, not improved model accuracy, and calls the
   modeled quantity synthetic expanded daily traffic rather than AADT. Then open
   a model with a completed baseline AequilibraE or behavioral-
   demand run. If no completed baseline exists, launch one from the visible
   model controls and wait for it to finish.
2. Open the run's scientific observed-count validation assessment. Identify
   whether it passed, failed, or remained inconclusive and explain the first
   recorded reason in plain language. Do not reinterpret a legacy point-count
   diagnostic as a scientific pass.
3. Inspect which observations were decisive, diagnostic, ambiguous, excluded,
   unloaded, or unavailable; note any base-year, day, direction/carriageway, or
   vehicle/PCE mismatch. For a build run, confirm the screen says base-year
   counts do not establish forecast or change validity.
   The current run supplies the assessment, comparison basis, and validation input.
   If it has no structural-diagnosis artifact, use the frozen v0.40 published record
   for that separate diagnosis; do not imply that the older diagnosis belongs to the
   current run.
4. Open **Why this is inconclusive** where the structural diagnosis is published.
   The frozen v0.40 published record satisfies this step when the current run has no
   diagnosis of its own. Distinguish observation/matching,
   network-loading, comparison-basis, and method-disagreement findings. Confirm
   any absent or conflicting model year, day/period, direction, vehicle/PCE,
   population, or coefficient fact remains `unknown`. Confirm the diagnosis
   did not rematch an observation, average the methods, choose a winner,
   calibrate a model, create a threshold, or change the scientific outcome.
5. Download the exact structural diagnosis and copy its full SHA-256. Then
   download the model validation assessment, comparison basis, and validation
   input bundle through the visible artifact controls. Confirm the assessment
   exposes the exact model-output and comparison-basis hashes. If the screen
   says `validation evidence write failed`, record that the computation is
   scientifically unchecked and do not call the outcome validated.
   For the v0.41 published record, also copy the full observation-package,
   match-audit, input-bundle, comparison-basis, assessment, and diagnosis hashes
   and exercise each visible exact-download link.
6. If the run includes ActivitySim, confirm its assessment remains separate
   from the AequilibraE assignment assessment rather than being averaged.
7. Repeat the published-diagnosis inspection at desktop width and 390px. The
   full hashes and download controls must not cause horizontal overflow. Record
   any console error or failed response; a clean journey requires neither.

The browser outcome is reached when you can state the recorded scientific
outcome and why, distinguish the structural finding categories, have preserved
all 42 v0.44 downloads with their full on-screen filenames and hashes for the
independent byte-level verifier, and have downloaded the exact v0.43
audit/diagnosis pair plus the immutable run assessment and its exact input and
basis evidence.
An honest `inconclusive` outcome fully satisfies this job.
