# Portfolio price-year correction, prepared checkpoint

The ongoing first-week run `2026-09-05T04-35-57-945Z` found that mapping a CSV
cost silently supplied the current year. The preview called the row clean even
though the stored source had no price-year column. Clearing the field converted
it to zero and caused a generic invalid-request response. This is a release
blocker, not evidence of a source-supported cost year.

This correction is prepared in the isolated worktree
`/tmp/openplan-v044-price-year-a960os`. The canonical b2248315 browser run and
database have not changed. The complete run may collect non-destructive findings
before the fixes are integrated. No v0.44 tag exists.

The existing project cost editor and database column already support an unknown
price year. The importer now uses that same nullable state. It retains the
amount, currency, source bytes, row identity, and source-document link; the
preview says the price year is unknown and warns against treating the estimate
as current-year prices. A blank mapped source cell stays unknown even when a
default year exists. Nonblank invalid values still fail. Explicit valid years
remain unchanged. XLSX export and re-import preserve the unknown year.

Migration `20260905000001_portfolio_unknown_price_year.sql` replaces the two
existing service-role import transactions. Their bodies differ only in allowing
a null price year. The authorization, source custody, duplicate, formula,
atomicity, and insertion checks remain byte-identical. It does not rewrite
existing projects or import history, nor infer which older default values were
actually verified. It creates no parallel write path.

## Evidence so far

- Seven new workbook cases failed against the original reviewer.
- The focused six-file suite passed 55 tests after restoration, including CSV,
  workbook, API, visible controls, and the exported XLSX round trip.
- A no-op comment survived. Restoring the automatic year, converting a cleared
  field to zero, hiding the preview label, refusing null at the API, inventing a
  year for a blank mapped cell, hiding the workbook warning, and hiding the CSV
  warning each failed the relevant assertion. All changes were restored.
- Both migration-body checks passed. Their no-op survived; restoring both old
  year guards failed both checks, then restoration passed. This is a static
  scope check, not proof of runtime migration behavior.
- Both new live transaction cases failed against the unchanged local database
  with `22023: Created project cost is invalid`. This demonstrates the missing
  database support. The fixture workspaces were removed by the existing test
  cleanup. The migration and successful live rerun are still pending.
- A separate `tsc --noEmit` check reported an existing Safety test-fixture type
  mismatch at `a-safety-project-packet-carries-its-crashes.test.ts:328`, where
  `fixture` is not a SafetyRoadSourceId. That file is unchanged by this work.
  This check is not reported as passing.

Logs are retained under `/tmp/openplan-v044-price-year-*.log`. The current
production-browser proof still exercises the earlier build. Before release:
integrate after the active run, apply the non-destructive migration, prove both
live transactions and their negative cases, repeat the visible import at desktop
and 390px, verify its stored and exported unknown-year state, rerun the complete
twelve-job outcome gate, and watch final QA, live RLS, upgrade rehearsal, and CI.
Do not claim the correction is released or browser-verified from these tests.

## Follow-up before integration

The standalone TypeScript error was corrected by giving the synthetic Safety
road fixture a valid `osm-network-cache` identifier while retaining its explicit
Fixture roads label. No application or geographic behavior changed. Full
`tsc --noEmit` then passed. A comment-only control passed; restoring the invalid
`fixture` identifier failed with the original TS2322 error; the corrected type
check and all 27 tests in that Safety packet file passed after restoration.

The first-week project job eventually reported its outcome reached. Independent
byte verification matched all nine ZIP checksum entries, its contained PDF to
the separate download, and its readiness JSON to the exact project download.
ZIP SHA-256 is `c506daeabcf06a937af191fe6fa0b74f8eb6152ea05842d97c255c4bb19932be`;
PDF SHA-256 is `5f14ef17e0a3052d5804a8cb0668f542bb94dfe7bd70e67efc1e04095900f0ce`.
The manifest hash also appears in the recorded browser snapshots.

That successful handoff does not clear the defect. The downloaded PDF states
Price year 2026 beside the source-file attribution, while the tester's narrative
explains that the source supplied no year. The original negative evidence is
retained. The upgrade note now tells operators to review older import defaults;
the stored metadata cannot establish whether an earlier default was verified.
The application migration and fresh full outcome run remain outstanding.
