# P2B.2 ActivitySim Execution Enablement Starter Kit

**Date:** 2026-03-27  
**Status:** prototype slice implemented  
**Scope:** honest config-package posture between bundle build and worker execution

## What Changed

The ActivitySim bundle builder now emits a versioned starter config kit instead of only `configs/README.md`.

Starter files emitted in each bundle:

- `configs/settings.yaml`
- `configs/constants.yaml`
- `configs/openplan_config_package.json`
- `configs/README.md`

The starter descriptor declares `package_status: starter_executable_kit` and `starter_version: v0`.

## Runtime Posture Detection

The worker now distinguishes three config-package states:

- `placeholder_only`
  - no executable config package is present
  - runtime stays `preflight_only`
- `starter_executable_kit`
  - OpenPlan starter files are present
  - runtime still stays `preflight_only`
  - this is for contract enablement, not pilot execution
- `runnable_config_package`
  - config directory looks like a real ActivitySim package candidate
  - the worker may attempt a real CLI run if the executable is available

`activitysim_cli` remains reserved for cases where a real command was actually launched and returned success.

## Remaining Blockers For True Pilot Execution

- calibrated county-specific ActivitySim settings and coefficients
- final schema alignment for household/person tables
- validated skim naming and lookup conventions against the chosen model package
- a successful end-to-end county run using a non-starter config package
