# Numeric tract-map data availability correction

October 1, 2026. Baseline `9530d77c860dccea228f57debe4496afc6b3a513`, which includes UI changes through `d72c11095e679e897dcf7796fcc6bbcc4ee1ad0c`. This follow-up owns the Census availability metadata, numeric overlay boundary, income palette endpoint, required engagement projection, focused tests and this report. No frozen study, model, holdout, geographic registry or acceptance threshold changes.

## Corrected behavior

A current ACS read retains whether each numeric overlay has the required source counts. Minority and poverty need their numerator counts and positive matching universes. Zero-vehicle share needs both owner and renter counts and a positive household universe. Transit share needs its transit count and a positive commuter universe. Suppressed estimates, absent columns and empty values cannot authorize a numeric map observation. A positive universe with a measured zero numerator still produces zero.

`fetchTractOverlayFeatures` uses this optional source metadata to emit null for an unavailable numeric field. It preserves the other available fields. Corridor Analysis already passes the complete tract objects. The engagement representativeness route now retains the metadata in its explicit tract projection. No database query projection changes are required. The raw-count interfaces retain their existing numeric values for compatibility.

The thematic income ramp now uses the same dark-red zero endpoint as the tract income ramp. Missing income remains grey. Both map expressions distinguish numeric zero income from missing income.

## Verification

Six focused suites pass, 70 tests total, including seven new end-to-end numeric-overlay tests and one route-projection regression. The new suite substitutes synthetic ACS and TIGER HTTP responses, then executes the actual `fetchAcsForCounties`, `fetchTractOverlayFeatures` and Mapbox style-spec expression evaluator. It checks suppressed, blank and absent numerator and denominator fields; zero denominators; measured zero; independent availability by field; missing versus zero income; and older inputs without metadata. The route test verifies the metadata passed to the geometry builder. These are computation tests, not screenshots or external service checks.

`evidence/science-map-mutations.py` copies source and test configuration into a temporary directory and uses the existing dependencies read-only. Seven harmless comment controls pass. Seven targeted faults fail named assertions: each of the four source-availability checks, geometry null propagation, income color separation and the route projection. `evidence/science-map-mutations.json` records actual failure output. Failures count only when they include the expected test and an assertion error. The integration checkout is never fault-mutated.

Scoped ESLint passes for all six changed TypeScript files. `evidence/science-map-checks.json` records commands, counts and exact file hashes. TypeScript checking, full QA and any browser acceptance belong to the integrating agent and were not run by this agent. An initial command invoked Vitest from the repository root and failed alias resolution before tests; the corrected package-directory invocation passed.

## Limits and truthful claim

The supported claim is: **current ACS reads retain missing-value provenance for the four numeric rate overlays, and numeric income zero has a different fill from missing income.** The earlier UI implementation log's general claim that all missing tract values now draw grey is broader than this evidence.

This does not retrofit older saved inputs whose raw counts already lost suppression provenance. Inputs without the optional metadata retain their recorded interpretation. It does not change Census aggregates, representativeness calculations or the proxy-disadvantage classification, which still use their existing raw numeric contracts. Population availability and invalid arbitrary string-valued third-party overlays are also outside this correction. A broader migration to nullable source counts and classification uncertainty needs separate design and regression coverage. This patch does not claim that broader propagation is complete.

No actual Census or TIGER request, physical map rendering, visual contrast acceptance, screen-reader test or practitioner validation ran. The synthetic geography is an adapter fixture, not a new supported jurisdiction. No AequilibraE or ActivitySim output was recomputed.

## Browser limit

The coordinator attempts a local synthetic GeoJSON render through the actual Mapbox GL renderer and changed paint function. Rendering refuses because this isolated environment has no Mapbox access token. No credential is borrowed from another checkout. Visible map acceptance is therefore not established; the end-to-end parser, geometry and real style-expression tests remain the evidence for numeric availability and paint values. The temporary map route is removed.
