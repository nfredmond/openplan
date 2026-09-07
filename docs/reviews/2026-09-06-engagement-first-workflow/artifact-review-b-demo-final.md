# Independent artifact review B: both demonstration packages

Reviewed September 7, 2026. This resumes the interrupted review and supplements the preserved independent review B and repaired stress-artifact report. It does not replace their findings.

The 12 supplied files preserve their externally recorded bytes and retained snapshots. All 161 baseline reconciliation checks pass, and all four workbooks compute correctly in native LibreOffice Calc after deliberately wrong formula caches are replaced by actual calculation. I inspected every one of the 19 PDF pages.

These packages do **not** establish two complete positive engagement demonstrations. Countywide wayfinding has no selected public contribution, survey session, answer or reviewed staff response. Its internal package has one withheld area contribution. Neither demonstration contains a reviewed staff response. This is an evidence gap rather than an export corruption: the files correctly report those empty sets. The parent has acknowledged the gap and plans additional separately retained delivery snapshots. I have not inspected those later files in this report.

## Scope and identity

Read-only source inputs are under `/home/nathaniel/.local/state/openplan/engagement-evidence/demo-delivered/`. The external record is the sibling `demo-delivery-evidence.json`. I did not acquire that record from the database myself or observe the original browser downloads. External agreement binds the delivered files to that independently supplied record; it is not my own end-to-end database custody proof.

I read the project review protocol and preserved B reports before adapting the earlier independent standard-library ZIP/CSV/XML checker. The PDF, spreadsheets, prove-it and unslop skills guided the review. I edited no source or delivered original. All scripts, previews and intentionally corrupted copies are under `/tmp/engagement-review-b-demo-final/`. No application server, worker, database or browser was operated by this reviewer.

| Demonstration / scope | Contributions | Sessions | Answers | Staff responses | PDF pages | Snapshot SHA-256 |
|---|---:|---:|---:|---:|---:|---|
| Complete streets / public | 3 | 1 | 2 | 0 | 6 | `6770566631984dbc84d9be5ff3ba449c7e6137465e58585c4a1bb12682e9fa33` |
| Complete streets / internal | 3 | 2 | 4 | 0 | 6 | `3642748ba6c928abeed71428439a08c4a84dc0aa24831adff90f6868fed5b888` |
| Countywide wayfinding / public | 0 | 0 | 0 | 0 | 3 | `08e49faeca4edd7d37c6192efc4d2adb650ec2cc7e4222f7d0208309386c3e09` |
| Countywide wayfinding / internal | 1 | 0 | 0 | 0 | 4 | `870b874d7474d310e6fdda887f7d80850a7c25d3c7426ed7aedb3bbb640d02a7` |

## Reconciliation and counterexamples

Each extracted `snapshot.json` matches the external retained-job SHA-256 and the package manifest. Every manifest payload member matches its byte length and checksum; the manifest inventories every payload member. Each separately downloaded PDF and XLSX equals its ZIP member byte for byte. All 12 files also match their externally recorded file length and SHA-256.

The checker reconciles CSV identities, order and exported field values; exact GeoJSON identities and coordinates; reconstructed HTML contribution bodies; workbook contribution, session, answer and response identities and exported values; retained definitions; all ordered long-text parts; summary counts; and the retained question denominators. It finds each included contribution and answer ID in extracted PDF text. Long text reconstructs two definitions from 145 pieces per complete-streets workbook and one definition from 371 pieces per county workbook. No participant long narrative exists in these particular demos; the earlier stress review is separate evidence for that boundary.

The initial reused checker expected zero-denominator question rows for every retained definition and failed all four packages. Inspection showed the actual report explicitly summarizes definitions used by selected sessions and retains unused versions in Historical definitions. I corrected that scope assumption in the checker. All selected-session denominators then matched. This is a reviewer-check correction, not a repaired production defect.

An unchanged-payload ZIP with only a metadata comment survives the semantic checker. Changing one contribution word only in a scratch snapshot fails six named checks: snapshot checksum, manifest snapshot member checksum/length, external retained-job hash, contribution CSV values, HTML body reconstruction and workbook contribution values. The original inputs pass. The external full-file identity check intentionally rejects any byte change, including a harmless ZIP comment; that is separate from semantic reconciliation. These counterexamples prove sensitivity to snapshot corruption. They do not mutation-test every individual assertion or every possible field omission.

## Actual calculation and workbook readability

All four numeric formula caches in every scratch workbook were poisoned to 987654321. Native LibreOffice initially reported those wrong values. Explicit `calculateAll()` produced exactly 3/1/2/0, 3/2/4/0, 0/0/0/0 and 1/0/0/0 in the table order above. Every recalculated workbook retained the original nonblank values and had zero error cells. There are only four Summary formulas in each workbook; this establishes those counts, not additional statistical analysis.

Native Calc reports wrapping and top alignment on Read me B5/B7/B8/B9 and Long text E2/E3 in all four originals. I created temporary Calc print previews for Read me A1:B10 and Long text A1:E5 and visually inspected all eight previews. Selected Read me text and Long text E2:E5 are fully present in extracted preview text after whitespace normalization. Read me is legible. The full-width Long text print previews are too small for comfortable reading without zoom, although content remains inside its rows. This is a diagnostic print fit, not a delivered print-layout claim. I did not visually inspect every workbook cell or every sheet, and did not test Microsoft Excel.

## PDF inspection

Poppler rendered every page at a 1,200-pixel longest edge. I opened all 19 images individually: complete-streets public 1-6 and internal 1-6; countywide public 1-3 and internal 1-4. I found no gross clipping, overlapping blocks, replacement-glyph pattern or missing-page pattern. Scope labels, explicit demonstration status, count limitations, retained definitions and withheld-answer notices remain visible. Internal complete-streets retains the multilingual original answer and its attachment reference; the public selected answer is explicitly withheld.

Minor layout problems remain. Complete-streets page 2 splits several question-table headings mid-word. Complete-streets public page 4 and countywide internal page 3 contain mostly empty space after a Historical definitions heading whose content starts on the next page. The small line/area marks are difficult to distinguish at the whole-study overview scale. The files honestly state that the map is an offline longitude/latitude overview; exact geometries reconcile with GeoJSON. These observations do not establish native-language correctness, accessible PDF reading order or recipient comprehension.

## Limits and disposition

Accept the supplied bytes, scoped data reconciliation and four demonstrated workbook calculations. Do not close the complete two-context workflow from these files. Positive countywide publication and staff responses are absent. Publication/redaction/history semantics, permissions, accessibility, mobile recovery, human usefulness and the parent's new Project evidence-bundle linkage require their own identified-build evidence.

The checked public snapshot fields and this fixture are not exhaustive confidentiality proof. ZIP attachment bytes match their manifest, but I did not independently compare the photograph with its original upload. The package is a current scoped review copy, not a proven complete original-and-review-history archive. No claim of superiority over Social Pinpoint, representative public opinion, nationwide planning coverage or scientific travel-model accuracy follows from this review. The complete v1 contract and separate AequilibraE/ActivitySim obligations remain unchanged.

Principal scratch evidence: `reconciliation.json`, `external-file-identity.json`, `checker-challenges.json`, `lo-recalculation.json`, `recalculated-value-comparison.json`, `repaired-cell-properties.json`, `native-preview-text-comparison.json`, the 19 source-PDF page images and eight native Calc previews. Owned LibreOffice processes exited normally. Prior source/delivered files were not changed.

## Delivered file hashes

| File | Bytes | SHA-256 |
|---|---:|---|
| demo-0-internal.pdf | 115842 | `0bc3a573c18ea2e4e8d28115a006c0461e7fb04460d5fe203a36cf8691b28a37` |
| demo-0-internal.xlsx | 42280 | `7e2c9d80867395b076f92491da0f0174733461e9dc8b083e87d18cdfae03d319` |
| demo-0-internal.zip | 3710153 | `4fd9fda29503589d145192ba965622b08413e66b6be872c5bb07cb7c93e62eb7` |
| demo-0-public.pdf | 100529 | `1dafd10493eb05468428ff8503a342929d0818893c91f08ad6fc28fa8b9b05be` |
| demo-0-public.xlsx | 41711 | `87ece42d3681121a720141424190da603844fe4ecab3b6bd71ec8e7d979aa1e4` |
| demo-0-public.zip | 163044 | `5f808b89547c6ba006a06e2063621d2c65eaf31e65753aaf4aa881aeb895817f` |
| demo-1-internal.pdf | 195563 | `c6d8236f49f333ede5d504239124a052d2f2728171d26d63177ce89ef3e74be7` |
| demo-1-internal.xlsx | 77704 | `7fd824288795eec396a04e463f869826d603e1e0afa451c9cd9c9e3297ebb9ce` |
| demo-1-internal.zip | 434630 | `55ada1b262ac3157195aef2400241184bd50045e6266a45118ab70e1b98f6e24` |
| demo-1-public.pdf | 192657 | `df61a75cc391762d9d1ba1f55c525f6ce79774900033e6fa938bf27cc0865d2f` |
| demo-1-public.xlsx | 77316 | `f33e29d1021161882fadb71de59b4c8d8e8ff3b0d3e0547965a38d70cd9f71db` |
| demo-1-public.zip | 431522 | `dc00ca37513118de2ffe8662e88721c4b4dc42a4d630bd2f5d9067ffd7ac30b5` |
