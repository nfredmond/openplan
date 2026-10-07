# Prepare a benefit-cost analysis

The Grants workbench prepares an annual, source-linked comparison of a project with its No Build case. It retains the full inputs, shows numerical and evidence gaps, and exports calculations another analyst can inspect. An OpenPlan result is supporting analysis. It is not an agency determination or a completed native Cal-B/C workbook.

## Start with a project

Open Grants, select **Prepare a benefit-cost analysis**, then choose the project. Define the No Build case, proposed alternative, affected geography and users. Select the specific grant edition and record why it applies. The October 2026 profiles cover USDOT 2026 methods, California TCEP, LPP Competitive and SCCP 2026 cycles, and the four PROTECT project categories. Custom methods remain available.

Read the linked controlling guidance. Requirements differ: a PROTECT planning application does not require the same analysis as a resilience improvement. The current notice and amendments control the actual application. Selecting a profile changes the declared dollar year, rate and BCR accounting, but does not convert old monetary inputs or establish applicability.

## Build the evidence register

Record quantity sources, monetary parameter sources and any dollar conversion separately. Retain the original files outside the analysis package and record a file reference, page/table/cell, observation year, units, method and limitations. An unresolved input can have an owner and due date. Mark assumptions, missing information and screening model outputs accurately. Marking a source documented does not independently validate it.

The Evidence tab can copy daily vehicle miles from one saved, ready guided project comparison. OpenPlan retains the scenario, snapshot, method and run identifiers. AequilibraE and ActivitySim remain separate alternatives. The import leaves annualization and monetary valuation blank. Confirm matching geography, network, population, period, forecast year and permitted use. The workbench does not launch or validate a travel model, infer causal effects, or convert a screening run into an accepted forecast. It refuses a second model comparison in the same document; use a separate version for the alternative.

## Enter quantities and costs

Each stream records the economic side, category, project element, unit, timing, Build and No Build quantities, annualization and monetary value. Enter full incremental project costs from every funding source. Annual quantities use an annualization of 1. A blank input remains missing; enter zero only when it is supported.

Guided quantity tools cover:

- Annual person-hours from daily vehicle trips, minutes, occupancy and affected days. The travel-time helper uses the average Build/No Build trip volume, the rule of half, and records the entered assumptions.
- Annual safety events from an observed count, observation duration and a crash modification factor. Match severity and units to the monetary value. A per-person injury value cannot be applied to a per-crash count without a supported conversion.
- Expected annual hazard loss from mutually exclusive event probabilities and conditional losses. Cumulative exceedance probabilities cannot be entered as independent bins. Unlisted probability mass assumes zero loss; investigate omitted tails, dependencies, deterioration, downtime and overlapping travel/safety effects.

The helpers perform arithmetic. They do not supply missing traffic observations, treatment effectiveness, hazard probabilities or engineering fragility. Published USDOT presets cite their edition and table. Other parameter schedules can be entered with annual overrides and their source record. Pollutant-specific schedules, automatic count acquisition and native Cal-B/C cell mapping are not implemented.

Annual overrides replace quantities and unit value for that year. Growth applies only to years without an override. Dollar quantities require unit value 1. A different price year requires a conversion factor and source. Residual value is a final-year increase in benefits. The discount epoch is separate from the dollar year; the selected timing convention treats the epoch as exponent zero.

Assign streams to project elements when a nomination contains multiple elements. Allocate shared effects and costs explicitly, once. Element ratios use their allocated streams; the total sums dollars, not ratios. Tag potential overlaps and explain the resolution. Automated checks cannot find every untagged duplicate or determine causal additivity.

## Review the result

The dashboard shows BCR, NPV, annual economic cash flows, element results, contribution drivers, sensitivity and break-even benefit scale. Federal accounting puts upfront capital in the denominator and net O&M in the numerator. State Cal-B/C accounting puts incremental costs in the denominator. Their ratios can differ even when NPV agrees.

Missing or incompatible numerical inputs suppress the headline ratio and NPV. Any displayed partial totals omit incomplete streams. Sensitivity ranges are analyst assumptions, not confidence intervals or award probabilities. Review the source worklist, unmonetized effects, exclusions and program attachments before using the result. A ratio above 1 does not establish eligibility, forecast accuracy or award likelihood.

## Retain and recover work

A browser-tab draft uses session storage. Unfinished title, year and other numerical edits survive reload even when the analysis cannot yet calculate. If the stored structure cannot be read, the workbench preserves the original and pauses replacement until it is downloaded and storage is explicitly resumed. Download input JSON before closing the tab or clearing browser data. Saving appends an immutable project version attributed to the signed-in author. Workspace owners, administrators and members may save; viewers may read and perform local analysis.

Before sending a save, the browser retains its UUID and exact inputs. If the reply is lost, retry the retained request. The server returns the existing version only when the author and document match. Editing pauses while the outcome is unresolved. Download the retained request and resume editing if needed, but first inspect history: this does not cancel a server save that may already exist. Importing a downloaded retained-save JSON restores its original UUID and document for exact-request retry, subject to the same project and author checks. History can load older pages. Loading an earlier version creates a new local draft and recalculates it with the current engine.

Planner Agent writes are deliberately refused until a supported approved action exists. The ordinary human workflow remains available.

## Export and hand off

**Download analysis package** includes full JSON inputs/results, annual CSV, source register, an unlocked formula workbook, HTML/PDF report, method/review memo and SHA-256 checksums. Inputs JSON can restore the same project's document. Import does not silently reassign project identity.

The workbook's Ledger formulas connect quantity differences, valuation, discount rate and epoch to the Summary. Annual ledger inputs are editable. Element monetary totals also recalculate from the ledger. The source register and automated review/status fields are export snapshots. Changes made in a spreadsheet do not update OpenPlan or those snapshots. Re-enter the changes and save/export a new version for a consistent handoff. Changing the declared dollar year does not perform inflation conversion.

The PDF renderer and its fallback status appear in `pdf-rendering.txt`. Tagged output alone does not prove PDF accessibility conformance. TCEP requires remediated accessible PDFs. Required official forms, source attachments, public/private benefit treatment and other program-specific documents still need review. OpenPlan does not execute Cal-B/C macros or claim Cal-B/C numerical parity.

## Installation and verification

Apply additive migration `20261016000001_bca_workbench_versions.sql` through the normal migration process. It adds project-bound, append-only input records and scoped RLS. There is no required paid service or additional runtime package.

The [research note](../research/BCA_PROGRAM_METHODS_2026-10-06.md) records current sources and reuse decisions. The [verification record](../reviews/2026-10-06-bca/VERIFICATION.md) separates numerical, database, browser and native-artifact checks from the unmeasured practitioner and agency boundaries.
