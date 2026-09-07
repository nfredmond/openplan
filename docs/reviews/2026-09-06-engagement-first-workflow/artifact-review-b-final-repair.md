# Independent Engagement artifact review: repaired delivery

2026-09-06 — reviewer B. Additive follow-up to `/tmp/engagement-independent-review-b.md` and `/tmp/engagement-review-b-artifact-addendum.md`; those reports remain unchanged.

The two artifact blockers found in my earlier review are resolved in the six repaired files inspected here: ZIP snapshot corruption and clipped ordinary/long-text cells in LibreOffice Calc. Both scopes pass all 43 independent reconciliation checks. This accepts these synthetic fixture artifacts within the limits below. It does not establish the full Engagement workflow, human usability, competitive superiority, or the whole v1 contract.

The earlier corrupt ZIPs remain failed evidence. Their findings have not been erased or reclassified as passing.

## Identity and custody

Inputs are immutable files under `/home/nathaniel/.local/state/openplan/engagement-evidence/delivered-repaired/stress-{public,internal}.{pdf,xlsx,zip}`. The parent reports that source checkpoint `f6c13d63` was pushed, both existing jobs were retried through the real UI with awaited HTTP 200 responses, and all six files were downloaded through the browser. I independently inspected the resulting files; I did not observe that browser retry or query the retained database.

The separate retained-job record, `/home/nathaniel/.local/state/openplan/engagement-evidence/revised-stress-jobs.json`, binds these snapshots:

| Scope | Job | Report | Snapshot SHA-256 |
|---|---|---|---|
| Public | `3181f1fc-c57f-41f7-be1c-4b3e256cc1c7` | `888e7052-9daa-4fcc-a508-d8a9a20eccbe` | `4a2875cbe5e3039caf5676af2ce17d0e2aa3882739f3cc80a459b9c4e3e3fc45` |
| Internal | `2a160cc1-a748-4be1-a387-da9055c6c914` | `e597396c-0ca8-4678-95d0-5a67f1c691bd` | `6e8935025e0ad04646ceae73c94910861a6bf9a70fa8ba624e73af198dd0b2b1` |

Both repaired ZIPs' actual extracted `snapshot.json` bytes match those external hashes and the package manifests. Every listed payload member matches its manifest checksum and byte length; the manifest covers the complete payload inventory. Separate PDF/XLSX downloads are byte-identical to their ZIP members.

Comparing parsed old and repaired snapshots reveals exactly one changed body in each scope: contribution `f96a3a75-d73a-451f-bf81-f858a723508b`. Replacing the old adjacent pair of U+FFFD characters with the original 🙂 makes the bodies exactly equal. Everything else in the parsed snapshots is equal. The old public body corruption was at codepoint offsets 10511–10512 and snapshot byte offsets 604097/604100; internal at 5255–5256 and 682038/682041. Offsets are zero-based. The repaired body has 36,037 codepoints. External snapshot hash agreement binds the full saved bytes; this is stronger than merely checking that the manifest agrees with itself, but it is not my own database acquisition.

## Independent data reconciliation and falsification

My scratch checker uses Python standard-library ZIP/CSV/XML parsing, independent of the production renderer. All 86 checks pass. It checks manifest inventory/checksums/lengths, separate-download identity, exact contribution/session/answer/response IDs and exported values, reconstructed long fields, survey definitions, independently calculated question summaries, geometry identity and coordinates, protected formula-like CSV literals, complete HTML contribution text, public-scope checked-field filtering, and PDF record-ID carriage.

| Scope | Contributions | Survey sessions | Answers | Staff responses | Geometries |
|---|---:|---:|---:|---:|---:|
| Public | 905 | 11 | 10 | 1 | 304 |
| Internal | 1,005 | 12 | 11 | 1 | 337 |

Public geometry comprises 302 points, one line and one polygon; internal comprises 335 points, one line and one polygon. No coordinate-only legacy record exists in this fixture, so it cannot close that earlier source concern.

Question counts retain historical versions. Public original-version counts are five sessions, four answered, one redacted, zero unanswered, three repeated answers; revised-version counts are five, four, zero, one, three. Internal original-version counts are five, four, one, zero, three; revised-version counts are six, five, zero, one, four. One session in each scope lacks a historical definition; its answer is retained and it is excluded from question denominators. Repeated answers are additional identical answers, not additional residents. These distinctions prevent misleading participation totals.

I challenged the checker using scratch copies. Adding a harmless ZIP comment preserved all 43 checks. Changing one snapshot 🙂 to 🙁 without updating the saved hash produced six expected failures: snapshot checksum, snapshot member checksum/length, external saved-job hash, CSV values, HTML reconstructed text and workbook contribution values. The unmodified inputs pass. Evidence: `checker-challenges.json` and `check_repaired.py` in the scratch directory below. These challenges demonstrate sensitivity to the reported corruption boundary; they do not mutation-test every assertion.

## Workbook calculation and readable content

All exported nonblank values match the snapshot, including exact reconstruction of all three long fields (the contribution body and two survey definitions). The narrative now uses 273 ordered pieces; there are no missing/duplicated part numbers or text loss. All final nonblank workbook values match the separately reviewed style candidates.

For each repaired workbook, I poisoned all four numeric formula caches to 987654321 in a scratch copy. Native LibreOffice Calc initially returned those deliberately wrong cached values. After explicit `calculateAll()`, totals became public 905/11/10/1 and internal 1005/12/11/1. The recalculated files contain no error cells and no changed nonblank values compared with the original delivered workbook. This proves actual computation rather than accepting precomputed caches. The workbooks contain only these four formulas; this is not evidence for an unimplemented statistical model.

Direct native Calc inspection of Read me B5/B7/B8/B9 and Long text E2/E3 finds `IsTextWrapped=true` and `VertJustify=1` (top) in both delivered scopes. E2/E3 have 168/132 codepoints, 10/11 newlines and row height 5,962 hundredths of a millimeter. The distinct body style is actually applied in Calc, unlike the failed earlier export.

I made isolated native Calc PDF previews of Read me A1:B10 and Long text A1:E5 from in-memory copies. All four final previews match the previously visually inspected style-candidate previews pixel for pixel at 160 dpi. I additionally viewed the final public Long text preview; its text remains within the rows. These previews confirm the earlier clipping repair on the inspected cells. Their page fitting is a review convenience, not a claim that the workbook ships with a polished full-workbook print layout. No complete workbook print run or every-cell visual inspection was performed.

## PDF coverage

The repaired public PDF has 241 pages and the internal PDF 258. Every one of the 499 pages was independently rendered with Poppler at the same 650-pixel longest-edge size used for the earlier revised exports. Exact RGB pixel comparison found zero differing pages; extracted text is also exactly equal for each full PDF. Binary PDF checksums changed, so the claim is rendered/text equality, not binary identity.

The prior addendum records visual inspection of all 499 revised pages through 22 contact sheets plus readable 120-dpi enlargements: public pages 1, 2, 150, 233 and 241; internal 2, 74, 255 and 258; plus individual pages 175/176. Because every repaired page renders identically, that visual coverage carries forward without pretending to have reread 499 pages. The PDFs retain the question counts, historical denominators, section navigation, evidence limitations and record-identified long-text pieces. This comparison cannot detect differences invisible at the render resolution, altered accessibility tags or link targets. Prior selected enlargements are stronger legibility evidence than contact sheets; neither establishes native-language accuracy or screen-reader usability.

## Remaining product limits

This artifact inspection does not close the parent's ongoing live moderation, permission, retry, photo-cache, mobile and recovery checks. It does not establish that practicing planners and public participants complete the workflow unaided, that a report recipient finds the resulting package useful, or that Engagement is superior to alternatives. Those require human observation and comparative evidence. I did not validate every question type, filter combination, script/language or accessibility mode. The checked public fields and fixture are not proof of every confidentiality boundary.

The package is a portable current review copy, not a proven complete original/history archive. Earlier whole-product findings and the binding full v1 contract remain in force: all states/DC, California depth, territory/tribal/overlapping authorities, the complete planning administration floor, and separately validated AequilibraE/ActivitySim are unchanged. No new module or narrower v1 follows from this artifact pass.

## Evidence preservation

All scratch scripts, JSON comparisons, poisoned/recalculated copies and native previews are under `/tmp/engagement-review-b-artifacts/repaired/`. Principal records are `reconciliation.json`, `checker-challenges.json`, `lo-recalculation.json`, `repaired-cell-properties.json`, `pdf-pixel-comparison.json` and `final-independent-comparison.json`. Private LibreOffice profiles were created only there, and the LibreOffice instances I started exited normally. I made no repository/source changes and did not operate the app server, database, workers or browser. Final `git status --short` still shows the parent's active changes; they were not touched by this reviewer.

Earlier report SHA-256 values at completion:

- Initial report: `8fff92d100cf7f71b6744af851ac1087de26b2d49486f13687486fe86a8d6e80`
- Artifact addendum: `85aaf0c36d8a8fd1cf08099772874ae8e97252cd0003d9131140a1097ddaa219`

Final source file SHA-256 values:

| File | SHA-256 |
|---|---|
| stress-public.pdf | `489a4e89066e4135a036a54f31a9e095b0ed88c70b4c541e09aff1e623de4321` |
| stress-public.xlsx | `ad2be3be4df996600ba013107714647ecdae87689fc876ceed1991f1b3d2325a` |
| stress-public.zip | `44244e4541f6e425d4e2e7cc8b3cd474139371d5f84b2720d7342f3c55ade728` |
| stress-internal.pdf | `4b36ccf2dceb547320c0db4eda482d6356c317aacae75c24da47de82e5b26db2` |
| stress-internal.xlsx | `5f2651fc4cdfbb3df52603adbc81306b03220edd4dcaea1146bd1cc8b21f2739` |
| stress-internal.zip | `1dd0ca4d05b418883136c13b7b46699958f227fdd9df130f1c8342bb3d5c8fdd` |
