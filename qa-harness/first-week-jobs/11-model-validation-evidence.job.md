---
id: 11-model-validation-evidence
title: Decide what a baseline model's observed-count evidence actually establishes
account: run
files: none
maxTurns: 180
---

You are reviewing a real baseline travel-model run before its results are used
in a planning discussion. An inconclusive assessment is an acceptable and useful
answer; your job is to understand the evidence, not to make the model pass.

Sign in at {{BASE_URL}} with {{EMAIL}} / {{PASSWORD}}.

**What you need to have done:**

1. Start from the signed-in landing page and use visible navigation to reach
   Models. Review the published seven-county frozen diagnosis card and download
   its exact study result. Then open a model with a completed baseline AequilibraE or behavioral-
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
4. Open **Why this is inconclusive**. Distinguish observation/matching,
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
6. If the run includes ActivitySim, confirm its assessment remains separate
   from the AequilibraE assignment assessment rather than being averaged.

The outcome is reached when you can state the recorded scientific outcome and
why, distinguish the structural finding categories, and have downloaded the
exact diagnosis plus the immutable assessment and its exact input and basis
evidence. An honest `inconclusive` outcome fully satisfies this job.
