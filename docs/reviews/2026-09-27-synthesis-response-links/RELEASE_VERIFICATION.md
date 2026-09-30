# v0.64.0 reviewed synthesis links and files

September 30, 2026. Local engineering verification is complete at application
commit `a7c349d5`. [Publication](PUBLICATION.md) records the later passing exact-commit GitHub checks,
tag and completed retained demo upgrade. This document preserves the local
engineering evidence separately.

This increment connects exact approved staff synthesis to saved responses,
project decisions and private review files. It preserves original sources,
review and approval versions, response-link corrections and withdrawals,
versioned decision packets, exact interrupted retries and earlier downloads.
Public copies exclude the private synthesis chain. The
[operating guide](../../ops/ENGAGEMENT_SYNTHESIS_REVIEW.md) explains the workflow.

[Response-link verification](BROWSER_VERIFICATION.md) records the Analysis
workflow, storage-refusal recovery and access-loss clearing.
[Decision and file verification](DECISION_DISPLAY_VERIFICATION.md) records
fresh desktop and 390px navigation, keyboard actions, original/corrected/public
PDF, XLSX and ZIP downloads, unchanged original checksums and anonymous refusal.
The worker-generated PDFs use short source destinations and have no extraction
warnings. Native and application checks preserve earlier packet formats and
separate missing historical evidence from captured empty history.

Apply migrations 29 through 32 before restarting the application:

- `20261014000029_engagement_synthesis_response_links.sql`
- `20261014000030_engagement_decision_synthesis_history.sql`
- `20261014000031_engagement_decision_resolution_guard.sql`
- `20261014000032_application_temporary_schema_order.sql`

The release candidate records 351 migrations through migration 32. No database
reset, new provider key, new worker or paid service is required. The existing
Documents export worker prepares queued files. The isolated populated upgrade
retains counts and checksums; the final populated release-upgrade workflow and
exact final CI pass before tagging, as recorded in publication.

## Cancelled-request regression repaired

The full native run caught seven failures after migration 30. Its replacement
writer omitted the existing cancelled-request check from migration 22. An absent
request that staff had already resolved could arrive later and create a link.
Migration 31 restores that check after exact saved-receipt replay and before new
capture locks. Earlier migration files remain unchanged.

[Cancellation repair proof](decision-cancellation-proof.json) records the
before-repair failure, repaired baseline, harmless comment control and deliberate
guard removal. Both defective cases fail with the expected late-request message.
The installed recovery and decision-link suites pass all 16 tests. The isolated
upgrade preserves counts and checksums for 3,350 rows across nine named tables.
These checks cover database behavior and those retained records. They do not
prove browser navigation or file usability. [Combined-upgrade controls](combined-upgrade-proof.json)
apply migrations 30 through 32 to an owned schema copy containing actual version-one
packets. Baseline and harmless controls preserve exact receipts and the public
entry-point identity. Missing cancellation repair and a replaced entry point fail.

## Temporary-table lookup repaired

A native SQL probe found a second boundary absent from the earlier RLS suite.
An authenticated role with temporary-table privileges could supply a temporary
`workspace_members` table before calling the synthesis reader. That table
satisfied the campaign check for an otherwise refused caller. This is a native
SQL-role result. No HTTP exploit is established.

Migration 32 explicitly puts `pg_temp` after trusted tables for 176 application
functions using the affected search-path setting. Their bodies, ownership,
argument types and grants stay unchanged. The
[lookup proof](trusted-lookup-proof.json) records the failed pre-repair boundary,
repaired and harmless controls, 176 independently weakened settings and a
behavior fault that restores the demonstrated bypass. All 22 focused tests pass.
The isolated upgrade preserves 6,576 rows in ten named tables and the identities,
bodies and grants of all 176 functions.

The first draft of the behavior fixture called the function before creating its
conflicting temporary table. A cached relation reference hid the defect. The
final fixture creates the conflict before its first call. The catalog guard
covers its explicit inventory, not future functions or every possible body
branch. Full native checks and browser verification remain necessary.

## Completed engineering checks

[Production verification](PRODUCTION_VERIFICATION.md) records the final local
checks and all four browser journeys at `a7c349d5`. Full QA and shuffled tests
pass 15,951 tests with 828 explicit skips. Native RLS passes 732 tests across 68
files, with 125 historical candidate skips. All 52 Python worker suites pass at
the display checkpoint; their implementation is unchanged. Original and corrected
files, cancellation recovery, public exclusion and private denial pass at desktop
and 390px. Publication records passing exact-commit GitHub checks before tagging.

The first full QA run found eight stale
column-audit entries after export field names entered the application source.
That run has one failure, 15,950 passes and 821 explicit skips.
[Column-audit proof](column-audit-proof.json) records three controls and eight
targeted stale-entry failures. [Release-accounting proof](release-accounting-proof.json)
records three controls and four failures for a wrong migration count, missing
file, missing changelog section and missing operator disclosure. All mutations
are restored. The audit update
keeps its assertions unchanged; baseline and harmless controls pass, and each
restored stale entry fails. This name scan cannot attribute a shared identifier
to a specific table or prove query projections.

No human software-release review is required. Engineering checks do not establish
practitioner usefulness, current agency approval, publication authority, adoption,
statutory sufficiency or representative public support. Complete resumable
optional synthesis generation and the wider M9b workflow remain open. The full
V1 contract, all-state/DC scope, territory/tribal/overlapping authorities and
separate national validation of AequilibraE and ActivitySim remain unchanged.
