# v0.63.0 exact staff synthesis approval candidate

September 27, 2026. This release candidate completes internal staff approval and withdrawal for exact retained synthesis revisions. It is not yet tagged or published. Final main CI and populated upgrade remain pending. Fresh local installed isolation passes all 657 tests in 66 files after the browser histories. Release accounting and direction checks pass.

The [operating guide](../../ops/ENGAGEMENT_SYNTHESIS_REVIEW.md) explains selection, corrections, exact approval and separate recovery copies. Staff reach the workflow through Engagement, the consultation, Analysis, a retained source and its saved review. Approval reasons and exact event history stay private to current campaign staff. Corrections do not inherit approval. The original source, preparation, review and approval bytes remain unchanged. Approval does not publish findings, establish representative public support or confer agency authority.

## Engineering evidence

[Implementation and verification](VERIFICATION.md) records 37 recovery tests, 14 route tests and 32 connected component tests. The associated proof manifests contain 42 recovery, 30 route and 22 panel control/fault cases. Harmless changes survive; targeted faults fail at the stated assertions. These checks cover schema/scope binding, private errors, streamed-body limits, source-owned recovery, exact receipt identity and stale-response handling. They do not establish browser layout or native database isolation by themselves.

The [browser record](browser-results.json) identifies application build 62c5b1c9a887. Desktop 1440px and phone 390px journeys use real navigation and keyboard controls. They exercise quota refusal through actual tab refocus, preserved/restored reasons, a committed approval with lost acknowledgement, exact recovery after correction, original withdrawal and corrected approval. Original source/preparation/revision checksums remain unchanged. Anonymous and stale-account reads are denied; a current denial clears private interface state. Screenshots were inspected. Both journeys have zero page errors; console errors are limited to the deliberately interrupted request and real 403 denial. Container checks accept a harmless layout change and reject an oversized button.

Two independent browser contexts exercise actual committed requests. Identical approval commands return 201/200 and one retained event. Competing commands return 201/409 with one winner, exact recovery and changed/stale retry refusal. Both explicit approval/correction commit orders preserve the version boundary. One simultaneous pair returns 409/201 and leaves the new correction unapproved. This supplements native transaction-lock tests but does not exhaust every scheduler interleaving.

[Check logs](check-logs.json) preserve hashes for full local QA and shuffled seed 619147. Both pass 15,621 tests with 628 explicit skips in 1,330 passing and 59 skipped files. QA includes lint, the configured dead-code check, provider connector tests, dependency audit and production build. Existing unused-export/type warnings are not represented as zero. All 52 worker suites pass. The separate installed RLS run after browser-created histories passes 657 tests in 66 files on supabase_db_openplan-restore-target-2026091050, with 347 installed migrations. It completes in 575.50 seconds without reset or candidate-schema mode.

## Upgrade and release

Apply `20261014000028_engagement_synthesis_approvals.sql` before app restart. The migration adds private immutable approval events, exact retry, current membership checks and a shared review/correction transaction lock. It preserves earlier review data. The release has 347 migrations through that file. No provider key, new worker, paid service or destructive reset is required. Agent-origin writes remain explicitly refused.

No release tag may precede the final declared checks. Inspect the exact final main commit's CI and RLS results, and run Upgrade Path from v0.62.0. Record actual publication separately after successful checks. Human software-release review is not required.

## Remaining scope

Source-to-response/decision links, reviewed synthesis exports and optional complete resumable model generation remain M9b work. Existing consumers of earlier capped summaries remain unchanged and do not become approved retained-review evidence. Full V1 scope, all-state/DC and territory/tribal/overlapping-authority requirements, and independent AequilibraE/ActivitySim validation remain intact. Engineering journeys do not establish practitioner usefulness, representativeness, statutory sufficiency or scientific accuracy.

## Release metadata checks

The v0.63.0 migration ledger names 347 migrations ending with migration28. Six release-accounting proof cases pass: baseline, harmless comment and four targeted failures for a wrong count, missing file, absent release section and missing operator disclosure. All edits are restored. The first direction check caught release markers still at v0.62.0; only those version markers were aligned. No review date, scientific threshold or capability rating changed. The corrected focused run passes 76 checks across six files, including deployment identity, direction scope, migration accounting and the free-software boundary.
