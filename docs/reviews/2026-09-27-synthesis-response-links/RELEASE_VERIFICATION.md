# v0.64.0 reviewed synthesis links and files

September 30, 2026. Release preparation is in progress. This record does not
establish publication, a tag or passing final-commit CI. The demo remains at
v0.63.0 until the release and documented upgrade are complete.

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

Apply migrations 29 through 31 before restarting the application:

- `20261014000029_engagement_synthesis_response_links.sql`
- `20261014000030_engagement_decision_synthesis_history.sql`
- `20261014000031_engagement_decision_resolution_guard.sql`

The release candidate records 350 migrations through migration 31. No database
reset, new provider key, new worker or paid service is required. The existing
Documents export worker prepares queued files. The isolated populated upgrade
retains counts and checksums; the final populated release-upgrade workflow and
exact final CI must still pass before tagging.

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
prove browser navigation or file usability.

## Checks still being completed

Full QA and shuffled tests passed at c5e11856 with 15,951 tests passing and
821 explicit skips. They are being repeated after the additive repair. Full
installed RLS, final identified production journeys and final CI remain open. All 52 Python worker
suites pass at the display checkpoint. The first full QA run found eight stale
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
