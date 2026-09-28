# Current public eligibility for retained downloads

September 27, 2026. Continues `ca1dafd4`. Application download checks now use the existing complete public response snapshot. Synthesis-specific native rules remain an uninstalled candidate. This checkpoint does not establish browser acceptance or a release.

## Changed behavior

`publicReviewStillCurrent` now reads responses through `loadPublishedCloseLoopEntries`. That loader rejects incomplete, malformed, foreign or failed snapshots. Every retained response must remain in the current eligible public set with the same identity, theme, source attribution and response wording. Additional public responses do not invalidate an older report. A report without responses does not depend on a response query. The application uses an already installed RPC; it does not require the new candidate eligibility function to exist.

The download route still parses the retained snapshot, rechecks current eligibility before reading storage, and verifies the saved artifact checksum. An ineligible or interrupted current-state read denies delivery. A later successful retry returns the retained artifact bytes; it does not regenerate the file or replace the original snapshot.

A survey-only probe finds a second gap: the old currentness check reads `id,status` and accepts an approved session carrying an explicit private marker. The corrected session read includes `metadata_json` and rejects missing privacy fields or explicit private markers. It reuses the existing engagement metadata rules for visibility, private notes and internal notes, including boolean values, case normalization and Unicode whitespace. The metadata stays in the server-side authorization check and does not enter the public artifact.

The report capture candidate also applies the existing native public-copy predicate to survey sessions. Private sessions and their answers are excluded from a newly queued public snapshot; internal snapshots retain them. This queue change remains outside installed migrations with the rest of the candidate. The application download guard protects retained files independently of candidate installation.

## Evidence

The focused tests use the real currentness helper and download function, with mocked transport/storage boundaries. They generate an XLSX workbook, verify returned bytes and checksum headers, deny an ineligible raw published row before storage access, deny corrected wording, and recover the original bytes after an interrupted eligibility read. These are function-level artifact checks, not a browser download or real storage-service test.

Native tests queue real report snapshots in the rollback database and run the application currentness helper against real SQL reads. Source correction, answer changes, private survey metadata, review corrections, approval withdrawal and link withdrawal deny the retained public snapshot while its text and checksum remain unchanged. Private survey-only snapshots are tested independently of linked responses. The tests also check public capture exclusion and internal retention of private survey records.

The mutation harness runs a passing baseline and harmless comment before deliberate defects. It detects omission of response eligibility, acceptance of read errors, ignored response identity or individual retained fields, bypass of the download entry point, missing session metadata, removed privacy predicates and native dependency bypass. Candidate SQL fault tests separately remove the survey privacy predicate from report capture.

An initial integration command runs from the repository root and fails import resolution before executing tests. The same command passes from the application package. An initial shuffled run passes with seed 167285 before the additional survey privacy repair; QA and live RLS from that earlier source are intentionally stopped. Final checks and hashes belong to the repaired source and are recorded separately.

The final full QA gate passes, including lint, dead-code checks, 15,696 unit tests, provider connector checks, dependency audit and production build. Shuffled testing passes the same 15,696 tests with seed 865721. Both ordinary unit runs skip 715 opt-in cases. The focused native candidate passes all 86 cases, and the separate isolated live suite passes 658 tests across 66 files. The application mutation run has two surviving controls and 17 detected faults. [Check evidence](download-eligibility-checks.json) records final source and private log hashes. Candidate objects are absent after rollback, the installed publication guard is restored, and the installed migration count remains 347.

## Remaining boundaries

Finish actual concurrent commit-order tests for publication versus source/review changes. A download currentness check and storage delivery remain separate operations; these tests do not claim a transaction spanning the byte stream. Keep that boundary explicit when assessing revocation behavior.

The synthesis candidate still needs complete constraint coverage, application link/history verification, route authorization, durable client recovery, decision provenance and staff controls. Promote an additive migration only after native concurrency and populated-upgrade evidence. Verify the integrated workflow from identified desktop and 390px navigation, including keyboard use, console inspection and saved files. Reviewed synthesis exports and optional complete resumable generation remain M9b work; the full V1 contract is unchanged.
