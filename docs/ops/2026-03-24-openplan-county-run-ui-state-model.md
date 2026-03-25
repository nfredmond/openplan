# OpenPlan County Run UI State Model

**Date:** 2026-03-24  
**Author:** Dr. Adrian Velasco, Principal Travel Demand Modeler  
**Purpose:** Define the minimum frontend state model for showing county onboarding progress in a web UI

## Why this exists

The county onboarding lane now has:
- runtime/build workflow,
- validation-onramp automation,
- manifest/schema/examples,
- backend data model guidance,
- API outline,
- and worker contract.

The next practical frontend question is:

> What should the user actually see at each county-run stage?

This note answers that for the smallest credible UI.

## Design goal

A first UI should do three things well:
1. show **where** a county is in the pipeline,
2. show **what artifacts** are available,
3. show **what claims are allowed** at that stage.

That third item is important. The UI should not accidentally imply a county is validated just because a run completed.

## Primary UI object
Use a single county-run status card/detail view with:
- geography label
- run name
- stage badge
- status label (if any)
- timestamps
- artifact links
- caveat text
- next recommended action

## Stage model

### 1. `bootstrap-incomplete`
Meaning:
- job exists but usable outputs are not ready yet

### UI treatment
- badge: `Running` or `Queued`
- tone: neutral/in-progress
- show:
  - run requested
  - geography
  - current job status if available
- hide:
  - validation claims
- CTA:
  - `Refresh status`

### 2. `runtime-complete`
Meaning:
- county runtime finished
- artifacts exist
- no local validation result yet

### UI treatment
- badge: `Runtime Complete`
- tone: informative but not celebratory
- show:
  - run summary highlights
  - artifact links
  - scaffold/review packet links if present
- caveat block:
  - `Screening-grade runtime output only. No local validation result yet.`
- CTA:
  - `Open review packet`
  - `Import counts`

### 3. `validation-scaffolded`
Meaning:
- county has entered the validation workflow
- but does not yet clear bounded screening-ready

### UI treatment
- badge: `Validation In Progress`
- tone: cautionary
- show:
  - scaffold/review packet
  - validation summary if present
  - reasons it is not yet bounded screening-ready
- caveat block:
  - `Not ready for outward modeling claims.`
- CTA:
  - `Review station definitions`
  - `Inspect candidate audit`

### 4. `validated-screening`
Meaning:
- county currently clears the bounded screening-ready screening gate on the documented slice

### UI treatment
- badge: `Validated Screening`
- tone: positive but controlled
- show:
  - validation summary highlights
  - artifact links
  - explicit caveat text
- caveat block must include:
  - screening-grade only
  - uncalibrated
  - not behavioral demand
  - not client-ready forecasting
  - county/slice-specific where applicable
- CTA:
  - `View validation report`
  - `Download artifacts`

## Recommended summary cards

### Runtime summary card
Fields:
- zones
- loaded links
- total trips
- assignment gap

### Validation summary card
Fields:
- matched stations
- median APE
- max APE
- status label

### Artifact card
Fields:
- run summary JSON
- bundle manifest
- scaffold CSV
- review packet
- validation summary/report if present

## Allowed claim text by stage

### `bootstrap-incomplete`
- "County onboarding job is in progress."

### `runtime-complete`
- "County runtime completed. Local validation has not yet been completed."

### `validation-scaffolded`
- "County has entered the validation workflow, but is not yet bounded screening-ready."

### `validated-screening`
- "County has a bounded screening-ready result on the documented validated slice, with explicit caveats."

## Disallowed UI behavior
The UI should never:
- show `validated` as shorthand for `validated-screening`
- collapse screening-grade into forecast-ready language
- hide caveats when the status is positive
- imply cross-county transferability from one county’s success

## Suggested frontend component model

### `CountyRunStatusBadge`
Inputs:
- `stage`
- `statusLabel`

### `CountyRunSummaryPanel`
Inputs:
- manifest summary data

### `CountyRunArtifactList`
Inputs:
- artifact rows / manifest artifact paths

### `CountyRunCaveats`
Inputs:
- stage
- validation summary

### `CountyRunNextAction`
Inputs:
- stage

## Minimal first page
A minimal county-run detail page can be:
1. page header with geography + run name  
2. status badge + status label  
3. runtime summary card  
4. validation summary card (if present)  
5. artifact links  
6. caveats  
7. next action box

That is enough for the first live web milestone.

## Product implication
This UI model keeps the product honest.

It lets a user see progress and useful outputs without implying that:
- every county is validated,
- every successful run is forecasting-grade,
- or the current screening workflow has solved the full behavioral-model problem.

## Bottom line
The first county-run UI should be a **truthful progress-and-artifacts view**, not a glossy black box.

If it clearly communicates stage, artifacts, caveats, and next action, it will already make the current modeling workflow much more usable on the web without overclaiming what the model means.
