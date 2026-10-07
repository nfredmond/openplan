# BCA method review

Date: October 6, 2026. Scope: read-only review of `profiles.ts`, `schema.ts`, `engine.ts`, `document.ts`, and `export.ts` under `openplan/src/lib/bca/workbench`. Review baseline is uncommitted work above `b028d0e4b065e58f526e268ee4346483cc12cd3d`. No implementation changes or heavy tests. Small in-memory `node --import tsx` examples exercised calculations and inspected generated workbook cells.

The reviewed implementation contains three consequential defects. They need correction before reporting the numerical workbench verified. Line references describe the reviewed snapshot and may move during fixes.

## Findings

### P1. Residual value has the wrong economic sign

`engine.ts:57` applies No Build minus Build to every benefit. A residual stream records the remaining asset value in the Build and No Build cases, so a larger Build value should increase benefits. The memo tells users to enter residual as a final-year benefit, but the engine subtracts it.

Reproduction: extend the provided synthetic example with residual, side `benefit`, unit `dollar`, unit value 1, year 2047, No Build 0, Build 1,000,000. NPV falls from $1,188,105.22 to $946,592.13. It should increase by the $241,513.09 present value. The same wrong sign appears in workbook quantity formula column M.

Fix the residual direction and enforce compatible economic side. An explicit quantity-direction field would also support benefits measured as increases, such as amenity use. Align the form labels, memo, engine, and workbook. Source: [USDOT 2026, section 6.3, printed page 34](https://www.transportation.gov/sites/dot.gov/files/2025-12/Benefit%20Cost%20Analysis%20Guidance%202026%20Update%20(Final).pdf).

### P1. Annual overrides bypass the dollar-unit guard

`engine.ts:40` checks `flow.unitValue`, but `engine.ts:49` then replaces it with an annual override. A dollar flow with base unit value 1 and override unit value 10 passes the guard.

Reproduction: set the example's capital override to `{year:2026,noBuild:0,build:2000000,unitValue:10}`. The engine reports $20 million capital cost and no `dollar-unit` issue. The user entered $2 million of dollars. Check the effective value for every annual row, including overrides, and require 1 for dollar quantities.

This is an implementation-contract defect independent of program rules.

### P1. Workbook discount settings can change without changing calculations

`export.ts:18–31` writes static Ledger K and L values. Summary B5 declares the default discount rate; Summary B4 declares the discount epoch. Ledger E declares the occurrence year. None drives the rate or exponent in the present-value formula.

Observed generated cells: Summary B5 = .07, B4 = 2026; Ledger E3 = 2028, K3 = .07, L3 = 2; O3 formula = `N3/(1+K3)^L3`. Changing B5, B4, or E3 leaves that discount factor unchanged. The workbook can therefore display altered analytical settings and retain the old BCR.

Link Ledger rate and exponent to the settings and occurrence year, with a separate explicit per-flow rate override. If a sheet is a static export, label it clearly as such. The existing warning that review checks do not refresh does not explain disconnected numerical inputs.

### P2. A federal profile does not flag excessive operating horizons

`schema.ts` permits 101 analysis years. `engine.ts:23` checks profile deviations in rates, dollar years, edition, and accounting, but omits horizon. Extending the example through 2090 yields 63 operating years and remains numerically complete with only source-quality issues. No horizon issue appears.

Add a profile-specific review issue for periods beyond the researched federal recommendation, and require useful-life/replacement evidence. Do not globally prohibit other valid methods. [USDOT 2026, section 4.4, printed pages 13–14](https://www.transportation.gov/sites/dot.gov/files/2025-12/Benefit%20Cost%20Analysis%20Guidance%202026%20Update%20(Final).pdf) recommends no more than 30 operating years and shorter lives for some investments.

### P2. Program cards omit consequential instructions and their controlling links

`profiles.ts` links every state program to the general Caltrans model page and every PROTECT branch to generic USDOT guidance. Those links do not establish the specific applicability rules displayed. Add the actual cycle's adopted guidelines or NOFO as separate controlling sources.

The SCCP card omits the required element-level BCR table for multi-element nominations. TCEP omits its remediated accessible-PDF requirement. These should appear in the handoff checklist so users do not confuse the available package with completed program documentation. Sources: [SCCP 2026 nomination instructions, PDF page 39](https://catc.ca.gov/-/media/ctc-media/documents/programs/sccp/final-2026-sccp-guidelines-a11y.pdf), [TCEP 2026 nomination instructions, PDF page 53](https://catc.ca.gov/-/media/ctc-media/documents/programs/tcep/2026-tcep-guidelines-adopted-a11y.pdf).

### P3. Vehicle operating cost source locators name the wrong table

`profiles.ts:27–28` cites Table A-3 for the .56 and 1.23 values. These values appear in Table A-4, printed page 40. A-3 contains vehicle occupancy. The values themselves match the source. [USDOT 2026 Appendix A](https://www.transportation.gov/sites/dot.gov/files/2025-12/Benefit%20Cost%20Analysis%20Guidance%202026%20Update%20(Final).pdf).

## Correct behavior observed and limits

The selected federal discount rate, dollar year, and listed numerical valuation defaults match the research. Federal incremental O&M enters the numerator with the correct sign. State all-costs accounting is separately declared. Missing numerical values prevent a headline ratio; source gaps remain review issues. The package distinguishes itself from native Cal-B/C and from an agency submission.

Generic manual emissions or resilience rows remain analyst calculations. The reviewed files do not implement pollutant-specific annual schedules, hazard-probability derivation, engineering fragility, or automatic detection of untagged duplicate benefits. Retain that boundary in shipped claims. A free-text source marked documented does not validate its model, unit compatibility, or forecast.

Native spreadsheet recalculation, rendered artifact review, database controls, browser behavior, and practitioner acceptance were outside this focused review. This report records findings from the original snapshot. Resolution requires separate evidence after changes.
