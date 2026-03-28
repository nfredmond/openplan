# P2B.2 ActivitySim Execution Enablement Starter Kit

**Date:** 2026-03-27  
**Status:** prototype slice implemented  
**Scope:** honest config-package posture between bundle build and worker execution

## What Changed

The ActivitySim bundle builder now emits a versioned starter config kit instead of only `configs/README.md`.

Starter files emitted in each bundle:

- `configs/settings.yaml`
- `configs/constants.yaml`
- `configs/network_los.yaml`
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
  - runtime may stay `preflight_only` when no compatible CLI is available
  - runtime may attempt a real CLI smoke execution when a compatible ActivitySim environment exists
  - this remains a starter/prototype posture, not a calibrated pilot execution package
- `runnable_config_package`
  - config directory looks like a real ActivitySim package candidate
  - the worker may attempt a real CLI run if the executable is available

`activitysim_cli` remains reserved for cases where a real command was actually launched and returned success.

## Real CLI Smoke Findings (2026-03-27)

A real ActivitySim CLI smoke run was validated outside the host runtime in a Python 3.11 Docker container:

- `activitysim==1.5.1` installed successfully in `python:3.11-slim`
- the OpenPlan starter kit passed ActivitySim settings validation after:
  - correcting `input_table_list` entries from `table_name` to `tablename`
  - adding a starter `network_los.yaml`
  - adding minimum required `zone_system`, `taz_skims`, and `skim_time_periods` fields
- the CLI completed a zero-model smoke run successfully and emitted runtime artifacts including:
  - `settings_checker.log`
  - `mem.csv`

This is meaningful progress: the remaining blocker is no longer gross package incompatibility or immediate settings-schema failure. The remaining blocker is moving from starter smoke execution to a county-calibrated, behaviorally meaningful ActivitySim package.

## Remaining Blockers For True Pilot Execution

- calibrated county-specific ActivitySim settings and coefficients
- final schema alignment for household/person tables
- validated skim naming and lookup conventions against the chosen model package
- a successful end-to-end county run using a non-starter config package
