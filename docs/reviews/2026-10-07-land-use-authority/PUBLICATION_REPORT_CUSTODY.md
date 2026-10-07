# Synthetic publication and adopted-report custody

October 7, 2026. This continues the [public content follow-up](PUBLIC_CONTENT_FOLLOWUP.md).
It establishes populated adopted-plan presentation and corrects the linked report.
It does not establish an actual agency decision or complete publication recovery.

## Existing frozen edition through publication

T3 navigates from the plan list to existing frozen version 2 on production source
`70ad9299fbf87681d77148eebee026505324debf`. Staff controls record a synthetic
process completion, create external-review round 2, close its outcome, record a
synthetic adoption, and publish. The form and records explicitly state that no
agency authority, public review or vote occurred. The first frozen edition and
its open review remain unchanged. No earlier one-shot producer runs again.

Native reads find one version 2 decision and one report artifact. Both previous
frozen snapshots and content hashes remain unchanged. Version 2 now points to
report `e0aab60e-a9ff-4d51-a98e-4f01e99ceb45`. Its hash remains
`fc9818674bd5d0d6ea354f42ef6bb9c9dba8c8a81464b5225e8c2e94bc5211e1`.
The [native and download check](publication-report-custody/publication-native-download-verification.json)
compares the 5,866-byte adopted JSON, anonymous response, report artifact and
authenticated provenance. Reordering keys passes; altering retained context fails.

The populated [desktop public plan](publication-report-custody/publicationAdoptedDesktop.png)
and 390px [context](publication-report-custody/publicationContextMobile.png) and
[content](publication-report-custody/publicationContentMobile.png) retain the saved
assessment, policies and synthetic decision. The frozen implementation action
also appears in the page text and packet. The map fixture remains empty, and the
page discloses the missing public Mapbox token.

## Observer limitation

The temporary request observer mishandles fetch inputs supplied as URL objects.
Its `input.url` lookup returns undefined, and `.includes` throws during four RSC
refreshes after writes. Next falls back to full navigation. This is an acceptance
observer defect, not evidence of an application refresh defect. It also removes
the transient observer before the release POST, so that request lacks an exact
transport capture. Four other request/response records and the native release
remain in private custody. No command is repeated to repair the evidence gap.

The earlier verifier's "synthetic local UI happy path" description is limited to
native results. This run does not prove ordinary post-save navigation without
instrumentation, interrupted adoption/publication, or concurrent publication.
Future observers must normalize string, URL and Request inputs and delegate
unrelated requests unchanged. The later report follow-up uses native fetch.

## Report findings and correction

The linked report omits retained context. Its summary hash also
[overflows at 390px](publication-report-custody/publicationReportBeforeMobile.png).
Code review finds that its header uses current plan labels instead of the saved
identity and does not compare the artifact with its recorded version.

Commit `da4d1898c756d557a19a8141095dd5c5213b8f8f` binds adopted-plan artifacts to
the native version, report pointer, plan identity, version number and content
hash. It verifies the frozen identity and context before rendering. Superseded
and repealed editions remain readable as historical reports. Missing, unreadable
or mismatched records produce an explicit refusal rather than substitute content.
Implementation reports retain their existing behavior and need separate custody
assessment. Raw provenance download remains a separate endpoint.

The report now presents retained context, uses the saved plan labels, wraps long
text and names its JSON download. The [desktop](publication-report-custody/reportCustodyDesktop.png),
390px [header](publication-report-custody/reportCustodyMobileHeader.png) and
[context](publication-report-custody/reportCustodyMobileContext.png) show the
correction after navigating from the actual workbench report link.
Measured report descendants have no horizontal overflow. The context panel's
right edge is 348.8 CSS pixels in the 390px viewport.

Keyboard activation saves a 13,777-byte provenance file. Its
[verification](publication-report-custody/report-custody-download-verification.json)
compares the report/artifact identity, native metadata and canonical frozen hash.
The harmless object-order control passes; an altered area fails. No publication
write occurs during this follow-up.

## Checks and CI

[Fifty-nine tests in four suites](publication-report-custody/focused-final.log),
TypeScript, changed-file ESLint and the [production build](publication-report-custody/build-status.json)
pass. Twenty-two report faults and one legacy-label fault fail for their stated
assertions. Baseline and harmless-comment controls pass, and source hashes restore.
The [first control attempt](publication-report-custody/report-custody-controls/report.json)
stops because its matcher omits the DOM `toHaveClass` assertion format. The
[corrected controls](publication-report-custody/report-custody-controls-v2/report.json),
[missing-record controls](publication-report-custody/report-custody-missing-controls/report.json)
and [legacy-label controls](publication-report-custody/report-legacy-label-controls/report.json)
complete. These are projected mocks and mounted components, not live RLS proof.

At earlier head `797d3ea6`, both [QA](publication-report-custody/report-custody-ci-qa-excerpt.log)
and [shuffle](publication-report-custody/report-custody-ci-shuffle-excerpt.log)
fail one stale expectation for the legacy panel name, with 18,873 passing tests
and 1,544 skips. The test now requires the correct distinct legacy label. It
retains its identity/context and recovery assertions. The new fault control
reverts the label and fails that test.

The [first live RLS attempt](publication-report-custody/report-custody-ci-rls-excerpt.log)
fails before tests because port 54322 is occupied on the hosted GitHub runner.
Only that failed job is rerun. Attempt 2 is job 112952154260 in run 37667666001;
it and full restore remain live when this note is prepared. Fresh head checks
are required before integration.

The [console record](publication-report-custody/console-review.json) retains the
observer-induced errors and earlier Electron/startup errors. No additional
application error appears during the uninstrumented report follow-up. Console
texts truncate after 500 characters and older network/action entries are omitted;
this is not a complete network audit. The build runs alone under 8 GiB. Both owned
servers stop; the [corrected report server](publication-report-custody/server-status.json)
peaks at 266,792,960 bytes and leaves port 3498 clear. Protected processes remain
untouched.

Complete report presentation still needs mapped designations, relationships and
adoption-decision narrative in the signed-in report. Print/PDF output, nonempty
maps, deeper content trees, publication concurrency/recovery, remaining M1
geography cases and practitioner/counsel acceptance stay open. No release or V1
completion is declared. [Artifact hashes](publication-report-custody/sha256.json)
preserve this checkpoint separately from private journals.
