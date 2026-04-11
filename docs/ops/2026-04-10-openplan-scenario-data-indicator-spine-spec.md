# OpenPlan Scenario, Data, and Indicator Spine Spec

**Date:** 2026-04-10  
**Owner:** Bartholomew Hale (COO)  
**Status:** proposed planning spec  
**Purpose:** define the shared platform contract that should sit underneath RTP OS, Grants OS, Transportation Modeling OS, reporting, and later aerial/land-use integrations.

## Executive summary

OpenPlan now needs one explicit shared spine for:
- scenario baselines and branches,
- assumptions and intervention records,
- standards-aware data and network package provenance,
- reusable indicator outputs,
- and publishable comparison context.

Without this layer, the platform will drift into module-local implementations that cannot compare, reuse, or audit one another cleanly.

## Why this exists

The research refresh established a durable rule:
OpenPlan should be a **composable planning operating system** built on a shared project/scenario/evidence spine.

This document makes that spine concrete enough to drive future implementation.

## Core design rule

The spine should be shared infrastructure, not a module feature.

That means:
- RTP should use it,
- modeling should use it,
- reports should use it,
- grants should consume it where relevant,
- and later aerial or land-use workflows should be able to attach to it without redefining the basics.

## Primary object families

### 1. Scenario baseline
A baseline is the named source condition for a planning question.

Examples:
- Existing conditions 2026
- Current RTP constrained list baseline
- Existing corridor safety/accessibility posture

### 2. Scenario branch
A branch is a proposed change set derived from a baseline.

Examples:
- add protected bike lane + crossing package
- move project from illustrative to constrained
- update transit span/frequency package
- alternative funding package

### 3. Assumption set
An assumption set records what was assumed for a branch or comparison.

Examples:
- cost assumptions
- service assumptions
- network edits
- demand assumptions
- policy assumptions
- caveat flags

### 4. Intervention record
An intervention is the atomic change object inside a scenario.

Examples:
- geometry or corridor treatment change
- project inclusion/exclusion change
- service pattern change
- policy/funding change
- zoning or land-use rule change in later phases

### 5. Data package
A data package is the standards-aware input bundle used by a scenario or run.

Examples:
- OSM-derived network package
- GTFS service package
- county demographic package
- tract equity indicator package
- crash-point package

### 6. Indicator snapshot
An indicator snapshot is a reusable output bundle generated for a baseline or branch.

First indicator families should include:
- accessibility
- equity/distribution
- environmental impact
- safety screening
- funding/program posture where applicable

### 7. Comparison snapshot
A comparison snapshot is the publishable delta between baseline and branch.

It should preserve:
- what changed,
- which assumptions governed the change,
- which data packages were used,
- which indicators changed,
- and what the result is safe to mean.

## Minimum relational direction

The exact schema can evolve, but the product contract should support:

- `scenario_baselines`
- `scenario_branches`
- `scenario_assumption_sets`
- `scenario_interventions`
- `data_packages`
- `data_package_sources`
- `indicator_snapshots`
- `comparison_snapshots`
- `comparison_indicator_deltas`

And link them back to:
- `projects`
- `plans` / `rtp_cycles`
- `models` / `model_runs`
- `reports`
- later `programs`, grants objects, and aerial artifacts where relevant

## Standards-first data posture

OpenPlan should prefer shared, inspectable contracts over opaque one-off imports.

Priority standards/formats to support where practical:
- OpenStreetMap
- GTFS / GTFS Realtime
- GBFS when relevant
- OGC API Features
- GeoPackage
- GeoParquet
- COG
- STAC-style metadata patterns for imagery/remote-sensing-adjacent lanes

This does not mean every standard must be implemented now.
It means the spine should be designed so those contracts fit naturally later.

## Indicator contract rules

Every indicator snapshot should carry at least:
- indicator family
- metric definitions
- geography scope
- source data packages
- scenario/baseline reference
- generation timestamp
- method/version metadata
- caveat posture
- safe interpretation notes

### First indicator families to prioritize
1. accessibility
2. equity/distribution
3. environmental impact
4. safety screening

## Comparison contract rules

A comparison is only trustworthy if it preserves:
- baseline identity
- branch identity
- intervention summary
- assumption set summary
- data-package provenance
- indicator delta summary
- narrative caveats

If any of those are missing, the product should treat the comparison as incomplete rather than silently flattening it into a chart or memo.

## Product-surface implications

### RTP OS
Should be able to show:
- baseline vs proposed project/funding posture,
- chapter-ready comparison narratives,
- indicator deltas that explain why a project is prioritized.

### Transportation Modeling OS
Should be able to:
- attach runs to scenario branches,
- consume shared data/network packages,
- emit reusable indicator snapshots,
- write comparison outputs back into reports and planning records.

### Grants OS
Should be able to consume:
- comparison-ready benefit statements,
- evidence-backed accessibility/equity/environment summaries,
- and funding-scenario changes tied to the same project spine.

### Reports / packets
Should be able to render:
- baseline,
- branch,
- assumptions,
- indicator deltas,
- and caveat posture without bespoke manual assembly every time.

## Guardrails

### Do not do this yet
- do not promise a full digital twin
- do not claim validated forecasting from this contract alone
- do not build a giant generic scenario editor before one narrow branch workflow is proven
- do not let each module invent its own comparison semantics

### Do this first
1. baseline + branch naming/versioning
2. assumption-set structure
3. data package provenance contract
4. one reusable indicator family
5. one publishable comparison snapshot

## Suggested first implementation slice

### Slice S1
Create the minimum shared scenario spine for one corridor/project workflow.

#### Scope
- one baseline
- one branch
- one assumptions record
- one linked data package reference
- one indicator snapshot family
- one comparison snapshot

#### Acceptance criteria
- a planner can identify baseline and branch cleanly
- a report can point to the same comparison record used by analysis/modeling
- assumptions are visible instead of buried in prose
- the result is small enough to ship without pretending the full future platform already exists

## Bottom line

If OpenPlan gets this spine right, the rest of the platform can compound.
If it gets this wrong, the product will keep accumulating disconnected scenario, data, and reporting logic under different names.
