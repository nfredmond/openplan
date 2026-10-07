# Independent method follow-up

October 6, 2026. A separate read-only review of the current implementation confirmed resolution of the six findings in [the original report](METHOD_REVIEW.md). Small numerical probes confirmed that a $1 million final-year residual increases NPV by $241,513.0867 in the synthetic example; dollar-unit overrides are blocked; workbook rate/epoch controls are linked; and rule-of-half, worsening-CMF and disjoint expected-loss arithmetic agrees with independent calculations.

The follow-up found three further P2 issues:

1. The truck-operator preset used `vehicle-hour`. USDOT Table A-2 uses 2024 dollars per person-hour, with its commercial values applying to the operator only. The implementation now uses operator person-hours; vehicle occupancy is not silently inferred.
2. The preset-departure check examined base and override valuations but omitted real valuation growth. A 10% growth rate could change the $21.80 time value to $133.3268 in the last year without warning. Nonzero real valuation growth now raises a departure issue for a linked constant preset.
3. The safety builder accepted an event or person count but always created a crash-unit stream. It now requires an explicit crash/fatality/serious-injury/minor-injury unit, preserves that unit and includes it in the retained method. The value picker disables incompatible published units.

Authority: [USDOT 2026 guidance, printed pages 18 and 39](https://www.transportation.gov/sites/dot.gov/files/2025-12/Benefit%20Cost%20Analysis%20Guidance%202026%20Update%20%28Final%29.pdf).

The reviewer also identified the original static Elements-sheet totals. They now use linked formulas and were independently recalculated through LibreOffice alongside Summary. Source/review/status fields remain explicitly labeled export snapshots.

The independent reviewer performed source inspection and small in-memory probes only. Native workbook, browser, database and engineering results are recorded separately in [verification](VERIFICATION.md); none establishes Cal-B/C parity, forecast accuracy or agency acceptance. Original reports are retained, rather than rewritten as clean reviews.

## Recovery and numerical edge review

A later read-only pass found three additional defects before release:

- A temporarily invalid browser draft, such as an empty title, failed restoration and was then overwritten by a blank document. Draft restoration now validates structure separately from calculation readiness. Unfinished edits survive reload. Unreadable originals pause storage, remain downloadable and do not prevent independent recognition of a valid retained save.
- A valid high-growth analysis could overflow only at the alternate discount rate. Sensitivity previously reported a numeric NPV from the remaining partial streams. It now retains a null NPV and the calculation errors for that case.
- The downloaded retained-save envelope could not be imported through the bare-analysis importer. Import now recognizes the validated same-project envelope, retains its UUID and exact document, and pauses editing until retry or explicit release.

The reviewer traced source/effect behavior and reproduced the sensitivity edge with a small in-memory calculation. The implementation owner added component reload/import and numerical regressions. These findings remain part of the review history; their regression results do not establish broader professional acceptance.
