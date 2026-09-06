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

## Isolated production preview and recorder correction

The clean worktree at `1adf575d2b9525fb13df92d9fc0e039fa0946e76` built successfully.
An owned server on port 3201 served that exact build; the canonical first-week
server on 3200 was unchanged. Starting from sign-in and visible Projects
navigation, the browser uploaded the supplied exercise CSV and previewed its
three costs. Clearing the year kept the field blank. The response retained all
three amounts, USD, and null years, with unknown-year warnings. Desktop and
390px screenshots show the unknown-year labels. Main inspected both screenshots;
there was no document-width overflow or console error. This was preview only,
not a project-creation or successful database-transaction claim. The temporary
server was stopped after the check.

I initially typed an incorrect full commit hash into the evidence recorder.
The independent server identity check had matched the correct worktree, but the
record itself was mis-stamped. It is retained under `price-year-preview/` and is
not the accepted record. My first recorder correction also used the wrong
health-response field and failed before sign-in. It remains under
`price-year-preview-verified/`. After reading the actual response contract, the
recorder reads Git's exact hash and compares it with `deployment.commit` from
the server. A deliberately wrong identity failed before sign-in. The successful
record is under `price-year-preview-bound/` in the September 5 release-checks
directory. None of these attempts created a project or changed the database
functions. The errors are preserved, not presented as an uninterrupted pass.

Additional mutation checks covered invalid explicit default years and the XLSX
round trip itself. Bypassing the default-year validator failed all three invalid
year cases. Replacing a blank mapped year with 2026 failed the unknown-year,
mapped-cell, and exported-XLSX cases. The no-op survived; all mutations were
restored, and the final seven-file focused suite passed 60 tests.
