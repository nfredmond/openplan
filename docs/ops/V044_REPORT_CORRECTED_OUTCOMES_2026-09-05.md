# Report-corrected first-week outcomes, retained unsuccessful run

Not a release approval. This records the unsuccessful twelve-job run on b46f0a61.
Job 11 ended with outcome no after the older-model download failure. The
subsequent land-use retry was intentionally interrupted, remains inconclusive,
and is not accepted. See V044_LEGACY_MODEL_DOWNLOAD_2026-09-05.md for the correction.

## Identity

- Checkout and served build: `b46f0a61c0915f522b7fd44fbd1644733e52a24f`.
- Fresh run: `2026-09-05T21-02-59-699Z`, all twelve jobs, 90 minutes per job.
- Current CI, RLS isolation, upgrade rehearsal and nightly workflows all succeeded:
  `33991778126`, `33991778137`, `33991788085`, `33991789524`.
- The earlier full local QA on `49b72040` passed 12,968 app tests, with 105
  skipped, 135 live RLS checks, production dependency audit and build. Current
  exact-build CI is separate evidence. Full development audit still has ten
  advisories, including two high findings.
- No frozen study changed. The distributed-loading candidate remains retired
  and inconclusive. No default, acceptance rule, holdout, or model weighting changed.

## Completed journeys independently inspected

| Journey | Recorded outcome | Independent evidence | Remaining limitation |
|---|---|---|---|
| First-day setup | Completed, exit 0, yes | Saved workspace retains county kind, TIGERweb identity 06045, US/CA, and stage-gate template. Screenshot inspected. | Saved display label omits County, known issue 022. |
| Neutral geography | Completed, exit 0, yes | Both actual OR/PR readiness JSONs retained before filename reuse; cited-file hashes agree. Desktop/390px support and saved-plan views inspected. | Unsupported jurisdictions remain visibly unsupported. No claim of statutory completeness. |
| Project record | Completed, exit 0, yes | Actual PDF, readiness JSON and ZIP verified against stored bytes/registered hashes; all eight PDF pages and ten GIS layers inspected. | Uploaded boundary has no resolved jurisdiction identity; unknown price year remains unknown. |
| Engagement | Completed, exit 0, yes | Active token portal, approved public comment, project linkage, category and exact location confirmed in stored records. Desktop/390px heatmap inspected. | One comment does not establish representativeness or a spatial cluster. No synthesis was generated or required. |
| Safety | Completed, exit 0, yes | Selected acquisition preserves all 390 records. Filtered exports contain 109 matching records. Actual PDF downloads match private storage; all ten pages inspected. | Source supplies no exact publication cutoff. Report pagination and dark-button contrast remain queued. |
| Guided model comparison | Completed, exit 0, yes | Four successful jobs bind four distinct exact output files, matching profile/network hashes and the supplied synthetic assumption. All worker-local output hashes checked. Both methods remain Prototype Only. | Mobile requires horizontal scrolling of the whole panel, including warnings. Existing object-text assumptions and legacy missing-run messages remain confusing. |
| Land-use chain, first attempt | Completed, exit 0, partly | Runner's own saved snapshot, live database and frozen report all show completed. Independent desktop/390px navigation and reload confirm it visibly. | Tester confused a separate process form's default with the implementation action. Preserve this false finding; the raw outcome still fails and requires an unchanged-job rerun. |
| Project GIS handoff | Completed, exit 0, yes | Native GeoPackage opened read-only. All ten inventory tables and eight geographic layers inspected. Source polygon and corridor coordinates exactly match supplied files. | No project point is recorded. Unexamined sources remain unavailable with null counts. |
| Portfolio workbook round trip | Completed, exit 0, yes | Exact XLSX contains 19 project columns, one project, and all ten mapping rows through Read me row 24. Preview remains Skip, with zero creates. | Cost is deliberately text-valued to avoid precision loss. This preserves import values but is less convenient for spreadsheet calculations. |
| Project evidence bundle | Completed, exit 0, yes | Native ZIP matches private stored bytes and manifest. All eight member checksums and ten GIS inventory layers inspected. | No linked plan selected, so archive cannot be submitted for governed approval. Model files are not selected and are not silently promoted. |
| Governed decision handoff | Completed, exit 0, yes | Two distinct accounts completed return, replacement and approval through My Work. Both actual ZIPs match stored bytes. The canonical receipt identifies the exact approved bundle and assigned admin. All nine PDF pages inspected. | This proves local QA custody and workflow, not agency approval, statutory adoption, model validity or publication. Replacement uses the same source PDF and plan; no substantive response-to-comment claim is made. |

All ten successful browser jobs report zero console errors. Supplemental
engagement and safety browser checks also observed zero errors. They used
visible navigation and existing records; the safety helper made no app writes.

## Native evidence identities

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| Oregon readiness JSON | 7694 | `cfbd3141540d67a19ef0d3b60b25fb4bd33c0ab7757859378e66ecadfac47d0c` |
| Puerto Rico readiness JSON | 6977 | `f4605618ebaa40568381ab8d7bfc1f2cefd035943928a83beac50f168235d090` |
| Project PDF, `a420735c-665a-4bb0-b851-ea32f569b3ec` | 299099 | `3d1f4ec5604e1ae1ae6a6fdfe910bf251704e57857bc8289da8199b4b6af8d6b` |
| Project readiness JSON | 5866 | `3a4f2d372c8e8896bafa2eafa2f2cd4d21d9c7fab4db8884931e41f0bd560c35` |
| Project ZIP, `157a7de8-3baf-407a-854e-af0b83bce011` | 190982 | `f5a84fb3d3a5a56e98aeb435d5b707294ababf6a07a106ccb8e86279aa215ecc` |
| Safety PDF, `b674a7d1-9d99-4011-8600-74cb5469bf41` | 329613 | `fdc858f2ea0193d850ebcacdf06f406f34fe57f155f892844db87dffa0b79288` |
| Final supplemental crash CSV | Not recorded here | `07a69aa49f5c2c8d0c2dbc9e4a6271a17d2c7b6808bf2209e0d9218f4f979662` |
| Final supplemental crash GeoJSON | Not recorded here | `db7aececc28f73b4a8488fc34ef0ccaec0bd15bed4933101012c8607c3b559e3` |
| Project GeoPackage | 86016 | `e1eb0fb11944097624a24879a984706e0611debc69aa3a9ed24dcd839121a1c7` |
| Portfolio XLSX | 12150 | `e5ab8f8a369a8b5d954f5f8d4861de1c05d44cc9a3b1f06449cb68ee8a25a165` |
| Evidence ZIP, `91cf2823-b160-404c-ad2e-7634251ce8a9` | 234984 | `4f5bd70d92c874bb29433f9bbebbde518026a6ac672a60b85fa9d393ab4ebd8b` |
| Returned governed ZIP, `b7d2374a-455a-4123-bed1-35f06f133cb3` | 307043 | `f141500fa6dae15de7a1ea1b5fb41ad27b82d112a90fe06f112c2d08e14914b1` |
| Approved governed ZIP, `70dc483a-05a9-453a-9666-a86bc4e64997` | 307043 | `4b9f32f86645b9cc70a6c8d6bcc68bb43eac865a1ef1d2de4bf730fb6939237a` |
| Approval receipt, submission `d136f438-51b7-4208-99c4-c94d5f5dad1d` | 634 | `52bccff8580f82cf7af03c977e130a6304dc3b428dd7d6817743482da1a63063` |
| Governed PDF, `24be6452-edd3-455f-990e-a7b1a8e8d661` | 328226 | `2bcd9b9ddb22c456059a45a1e15879476e78eb256e56a170262e99962b2acb1c` |

The Safety PDF is a newer artifact of the same project report, not a replacement
for the earlier inspected project PDF. Both remain stored. Desktop and mobile
Safety downloads are identical. Export timestamps can change exact file hashes
between downloads; the retained versions are identified separately.

The 109 exported crashes comprise 90 injury, ten serious injury, two fatal and
seven unknown-severity records. The displayed filter excludes 281 property-
damage-only records. An independent query confirmed all 390 stored records and
matched every exported source ID, source-record ID, coordinate and casualty
count, including nulls. This verifies custody and cross-format consistency, not
the source agency's underlying accuracy.

## Verification failures retained

- The first supplemental Safety check expected artifact `dbe37ad0`, generated
  at 21:34:33 UTC. It refused the newer `b674a7d1`, generated at 21:34:51 UTC.
  Metadata inspection resolved the mismatch. The original failed proof remains;
  the corrected proof downloaded the newer PDF without regenerating it.
- Two read-only diagnostic projections used absent columns. They returned
  database errors, not false passes. The corrected projections verified the
  actual intake flag and acquisition counts.
- The download helper initially logged temporary local signed URLs. This was
  disclosed, and future logging strips access tokens. Raw local evidence is
  private and must not be copied into tracked release material.
- Byte checks admit unchanged copies and reject altered or truncated files.
  Crash checks admit a no-op copy and reject a missing record, a changed
  coordinate, and replacement of an unknown casualty count with zero.
- The land-use supplemental helper first reloaded before navigation completed.
  A second version expected an iframe, but land-use reports render inline.
  Both failed checks remain retained. The corrected helper visited and reloaded
  the plan at both widths, then inspected the actual inline frozen report.
  It made no app writes and observed zero console errors.
- The workbook checker initially required an explicitly numeric cost cell,
  then incorrectly considered an omitted XML type as the explanation. Reading
  the actual cell showed `t="str"`; the exporter explicitly documents deliberate
  text storage to preserve decimal precision. The numeric-cell check remains
  a recorded failure. Separate round-trip-content checks pass and reject missing
  mappings or a substituted price year. No application change was made.
- The actor check initially compared the stored email with the configured
  email case-sensitively. The configured timestamp used capital T/Z; the
  authentication record used lowercase. The replacement check authenticated
  both configured accounts and compared exact returned user IDs, then matched
  the recorded admin membership and assigned approver. It does not weaken the
  application's authorization checks.

The approval receipt admits an unchanged copy and rejects altered ZIP hashes,
creator self-approval, a different assigned approver, model-validation promotion,
statutory-adoption promotion, and publication promotion for their named reasons.
The original and replacement ZIPs retain separate IDs, timestamps, and hashes.
The approved bundle's manifest SHA-256 is
`0fc9ca52479fb373e5fc52c9b49f5bbcbc6b302512b7e9465eb0093b4939487e`.

The evidence ZIP includes the already inspected final Safety PDF with the same
SHA-256. Its GeoPackage contains 12 KSI points, one approved engagement geometry,
the project area and corridor. The engagement layer contains no comment text,
submitter identity or moderation notes. Model and land-use layers remain
unavailable, not zero evidence. The exact manifest hash is
`f6c1d63577067c531d282291d837063e97837d4400ea56837795c43df0ef457c`.
An unchanged ZIP copy passed; altering project/project.json failed its member
checksum. Private-storage comparisons reject altered or truncated ZIP bytes.

## Lesser findings carried into the registry

- Broaden 062. The dark-theme secondary Generate PDF control has nearly invisible
  text even when enabled, not only when disabled. Actual computed foreground
  is `rgb(31,36,40)` on `rgb(26,34,38)`, opacity 1, disabled false. Both viewport
  screenshots were inspected. Automated clicking does not establish legibility.
  The current journeys reach generation; no data loss or permanent unreachable
  workflow has been established. Queue as a medium usability defect.
- Reconcile repeated County-label finding 022 with the capability registry.
- Retain the honest unknown source-cutoff finding without inventing a date.
- Keep worker compatibility and stale launch-copy findings distinct from actual
  execution failure; the first two model runs have already succeeded.
- Add the mobile saved-comparison layout defect. A 662px grid extends past a
  292px module at 390px. The outer page width still measures 390px, making the
  first supplemental width check inadequate. A real horizontal mouse-wheel
  interaction moved the scroll panel to reveal both methods' build results,
  raw changes and Prototype Only badges. Screenshots confirm reachability, not
  good responsive layout. Queue this lesser defect; do not call it hidden data.
- Preserve the tester's precision concern as a presentation judgment. The table
  labels its values Raw change and shows Prototype Only directly below. This
  is not evidence of incorrect numeric output. Any clearer briefing summary
  must preserve inspectable raw values and method disagreement.

## Review collection-mode limit

Review 82d132c5-299d-4b14-a22c-848a8e404860 selected campaign
9661c616-f6aa-4cf3-af9d-b456fbcc1935. A rejected public-slug save showed an
explicit link-name collision and did not enable online intake. The campaign
was active, but public submissions remained disabled. It later closed with
zero actual comments. The closed review's zero count matches those records;
it does not establish how much participation opportunity existed.

This does not prove every review must use online submissions. Staff-entered and
imported feedback can be legitimate. Queue explicit collection mode and frozen
intake-state custody alongside the existing public-feedback-link gap. No
participation or statutory-validity claim is made. A later diagnostic request
to the already closed campaign returned 404, which does not establish a broken
link before closure. The independent closed-review desktop/390px check showed
both actual map shapes and no console errors.

## Still required

The next full run must use the corrected clean build and reach all twelve
outcomes. The older-study download blocker and zero-exit interruption correction
are recorded in V044_LEGACY_MODEL_DOWNLOAD_2026-09-05.md. Do not relabel this
run as successful or substitute supplemental byte checks for its failed outcome.
Final release ordering, migration inventory, remote CI and release tagging remain.
