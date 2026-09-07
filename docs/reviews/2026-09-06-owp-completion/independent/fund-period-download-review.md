# Supplemental independent review: funding periods and authenticated artifact download

No defect was identified in these bounded checks. Source snapshots and hashes are in `current/` and `sha256.json`. Root owned implementation and browser delivery; all reviewer writes were confined to this scratch folder. Git status was recorded before/after shell work. No repository or database edits, real network fetches or existing-service operations were performed.

## Funding-period coverage

Actual application reconciliation and actual exported formulas were checked against a synthetic 2027 calendar-year proposal with 100 units of grant funding and 25 units of matching funding. Both funding rows carry the tested period. The checks compare grant availability, whole-program revenue and supplied match, and require `fund_period` discrepancies for each invalid fund.

Seven cases pass in both application and LibreOffice after explicit UNO `calculateAll()`:

- Exact cycle: availability100 / revenue125 / provided match25; no fund-period discrepancy.
- Reversed period: all three unresolved; two discrepancies.
- Expired period: all three unresolved; two discrepancies.
- Start inside the cycle: all three unresolved; two discrepancies.
- End inside the cycle: all three unresolved; two discrepancies.
- Wider covering period:100 /125 /25; no discrepancy.
- Period ending one day short: all three unresolved; two discrepancies.

A harmless comment preserves all seven outcomes. An application mutation making fundCoversWorkProgram always true fails invalid-period cases. A separate workbook mutation removing both eligibility and availability date guards fails them after full recalculation. All 28 workbook inputs and recalculated outputs remain in `xlsx-input/` and `xlsx-forced/`; results are in `period-forced-results.json`. This uses the corrected explicit recalculation harness established in round6, not conversion/cached numeric values.

Blind categories: synthetic arithmetic fixtures do not establish real funding restrictions, source evidence, live save permissions, browser behavior, or arbitrary externally edited spreadsheet dates. They intentionally verify the current conservative rule: allocation rows span the proposal cycle, so a partial funding period remains unresolved rather than being prorated implicitly. Source selection alone is stubbed for workbook generation; application reconciliation and spreadsheet formulas are real.

## Authenticated download helper

`download-probe.cjs` executes the snapshotted real `downloadAuthenticatedArtifact()` with Node WebCrypto and a fake DOM/fetch boundary. Five cases pass:

- Correct bytes/checksum: one download, same-origin credential mode, no-store request, deferred object-URL revocation.
- Corrupted bytes: rejected before creating/clicking a download.
- Foreign origin: rejected before fetch.
- HTTP403: rejected before creating/clicking a download.
- Invalid expected checksum: rejected before fetch.

A harmless comment preserves the five outcomes. Disabling checksum comparison, origin rejection or HTTP-status rejection each fails its corresponding case. Evidence: `download-results.json` and the scratch probe. No real artifact was downloaded, and no browser account was used.

Blind categories: these tests do not prove native browser save behavior, actual cookie/RLS enforcement, download-button reachability, HTTP redirect policy, or source-file generation. Root owns that browser evidence. The checksum comparison proves equality to the expected retained digest supplied to the helper, not independent semantic accuracy of the artifact.
