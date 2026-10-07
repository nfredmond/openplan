# Benefit-cost analysis workbench

Date: 2026-10-06. Owner: BCA session. Base: b028d0e4.
Worktree: `/home/nathaniel/.local/state/openplan/bca-workbench-20261006`.
Branch: `work/bca-workbench-20261006`.

## Requested outcome

A planner prepares a source-linked Build/No Build analysis for a selected grant cycle, sees the inputs that control its result, resolves missing evidence, compares alternatives and exports calculations another analyst can reproduce. Preserve unsupported results. Software cannot supply nonexistent observations or certify an unvalidated forecast.

## Existing home and reuse

Roadmap M6b already owns this work in Grants with Projects, Safety, Models and Reports. No new top-level module. Reuse the BCA present-value arithmetic, current workspace and project access controls, SheetJS, JSZip, shared UI and model-evidence records. Existing screening records and their historical assumptions remain unchanged. The current screening engine does not represent construction/operation timing, distinct price and discount years, annual parameter schedules, or evidence custody adequately for this outcome.

## Implementation sequence

1. Research current official CTC TCEP, LPP Competitive, SCCP, FHWA PROTECT and USDOT methods. Pin cycle, publication, source and method. Assess Cal-B/C variants and external tools before adding calculations. Record differences and unknowns in the research note.
2. Add a typed analysis document and deterministic annual calculation engine beside the existing BCA engine. Keep Build/No Build quantities, units, parameter source, dollar year/conversion, annualization, timing, signed disbenefits, cost schedule, residual and operating costs explicit. Missing values never become zero. Retain qualitative benefits outside the ratio.
3. Add program profiles, data-gap checks, overlapping-benefit warnings, source quality, sensitivity and break-even analysis. Separate assumed ranges from statistical confidence. Demand engines remain separate, with use restrictions retained.
4. Add project-bound append-only saves and recovery, server recomputation, caller authorization, same-project identity and route-local refusal of unsupported Planner Agent writes. Do not overwrite historical screening records or grant a model publication authority.
5. Add a Grants workbench reached through ordinary navigation. Guide new planners through scope/method, evidence, annual quantities/costs and review/results. Support editable inputs and portable document import/export. Show the largest result drivers and missing-data tasks beside the result.
6. Export an auditable workbook with formulas, annual CSV, full JSON, source register, method/review memo and printable dashboard in a package. Distinguish OpenPlan calculations from a completed official Cal-B/C workbook. Native workbook compatibility and numerical equivalence require separate evidence.
7. Test independent numerical examples, adverse/zero/missing values, years/units, duplicate benefits, source changes, import boundaries, tenant/role isolation, retry custody, exports and UI interactions. Prove new checks with harmless and targeted mutations. Run appropriate full checks sequentially.
8. Inspect an identified build through T3 preview at desktop and 390px, including keyboard, console, recovery and exported artifacts. Preserve expensive findings, limitations and exact verification identities. Commit/push verified checkpoints; coordinate integration with the other agent before main changes.

## Design

Use OpenPlan's existing light/dark tokens and typography. Left-align the working document. A sequence of Scope, Evidence, Benefits and costs, Results, and Saved versions follows the actual task. Use an annual cash-flow chart and benefit-contribution bars with visible numbers and equivalent tables. Keep unresolved evidence beside the input it affects. Mobile uses stacked editors with labeled fields rather than compressed spreadsheet cells. No new branding, paid dependency or invented project data. Demonstrations are visibly synthetic and never automatically saved.

## Acceptance limits

Engineering acceptance does not establish agency acceptance, planner usefulness, native Excel macro execution, Cal-B/C numerical parity, hazard probabilities, causal intervention effects or nationwide travel-model validity. Those claims require their own evidence. Record any unfinished scope rather than calling a draft complete.
