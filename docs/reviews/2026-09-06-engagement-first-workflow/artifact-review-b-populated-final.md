# Independent artifact review B: populated final demonstrations

September 7, 2026. Additive follow-up to `/tmp/engagement-review-b-demo-final.md`; the earlier report and its supplied files remain unchanged.

The final 12 populated files pass the artifact checks performed here. All 161 baseline reconciliation checks pass, every file matches its external byte length and SHA-256, all four workbooks recalculate correctly in native LibreOffice after deliberately poisoned formula caches, and I inspected every one of the 20 PDF pages. I found no new corruption or unreadable-content blocker.

The specific earlier evidence gaps for positive countywide publication and a reviewed response in each context are closed in these files. Countywide public now contains one approved written-location contribution. Both contexts contain one explicitly synthetic reviewed staff response linked to an included source contribution. Countywide still has no survey session or answer, and its public contribution has no geometry. This does not demonstrate a populated countywide survey or map contribution.

## Identity and counts

Inputs: `/home/nathaniel/.local/state/openplan/engagement-evidence/demo-with-responses/`. External identity record: sibling `demo-with-responses-evidence.json`. I independently inspected the supplied files, but did not personally acquire that external record from the database or observe the browser downloads. Exact external agreement is stronger than a manifest agreeing with itself; it is not an independent acquisition audit.

| Context / scope | Contributions | Sessions | Answers | Staff responses | PDF pages | Snapshot SHA-256 |
|---|---:|---:|---:|---:|---:|---|
| Complete streets / public | 3 | 1 | 2 | 1 | 6 | `78fb75f3bbfc679e9a7cce86f50ef5d81af5dd89993395e63cd1ee8cc51a1a61` |
| Complete streets / internal | 3 | 2 | 4 | 1 | 6 | `e45da918ed7980978f8ab98ceedb01fdcde80e2053a2671cb5051cb8ad5f80b1` |
| Countywide wayfinding / public | 1 | 0 | 0 | 1 | 4 | `902f744c62d90d0321fdfe28d51af6390d6292558193b7cf78e541fede523bd5` |
| Countywide wayfinding / internal | 2 | 0 | 0 | 1 | 4 | `7cda34df2b11758036934819ba0b56b7a34321fb33fbff2a5d47bfb342dcfc23` |

## Data and calculation evidence

Every extracted snapshot matches its external retained-job SHA-256 and manifest. Every payload member matches its manifest checksum and length, and the manifest covers the complete payload inventory. Each separate PDF/XLSX equals its ZIP member byte for byte. All 12 full files match external hashes and lengths.

The independently parsed CSV, GeoJSON, HTML and XLSX data reconcile with the frozen snapshot: contribution/session/answer/response IDs and order; exported fields; exact geometries; reconstructed contribution bodies; retained definitions; contiguous long-text parts; summary totals; and selected-session historical question denominators. Each included contribution and answer ID occurs in extracted PDF text. Both new response IDs, complete response narratives and selected source contribution IDs also reconcile. Complete-streets response `c82e5524-7040-4674-996e-61c0a71d3350` links contribution `ab79ae33-ed03-48cc-ae0b-4c37ce973a85`. Countywide response `214eafcb-3b25-4460-a5c7-b4ef1f1196ca` links `24c110a0-b4ac-4067-ab99-6cc5dcc1e49f`. Both explicitly disclaim a real decision or funded commitment.

Each complete-streets workbook reconstructs two definitions from 145 long-text pieces; each countywide workbook reconstructs one definition from 371 pieces. These are long definitions, not participant stress narratives. The earlier stress report remains separate evidence.

I repeated the semantic falsification controls on the final public complete-streets package. A ZIP metadata comment with unchanged payload survives. Changing one word only in the scratch snapshot fails six checks: snapshot checksum, manifest snapshot checksum/length, external retained hash, contribution CSV values, HTML body reconstruction and workbook contribution values. No delivered original was changed. These controls establish the snapshot-corruption boundary, not mutation coverage for every assertion. The distinct full-file identity check correctly rejects even a harmless byte change.

All four Summary formula caches in every scratch workbook were set to 987654321. Native Calc initially returned those wrong values. After explicit `calculateAll()`, results were 3/1/2/1, 3/2/4/1, 1/0/0/1 and 2/0/0/1 in the table order. Recalculated files have no error cells and no changed nonblank values relative to their respective delivered originals. Only four summary formulas exist per workbook; this proves their computation, not an additional statistical analysis.

The old and new snapshots have identical campaign, session, answer, filter and definition data. They differ in capture time, added responses and countywide contribution. Complete-streets items additionally omit two formerly null transient fields, `review_reason` and `review_expected_updated_at`; other retained item values are unchanged. The older files were preserved rather than overwritten.

## Visual findings

I rendered all 20 PDF pages with Poppler at a 1,400-pixel longest edge and opened each individually. Both complete-streets PDFs have six pages; both countywide PDFs have four. The question-table headings now fit without mid-word splitting. Historical definitions now starts on the same page as its first configuration, resolving the orphaned heading. Scope, demonstration labels, count limitations, withheld-answer notices, original internal multilingual answer, attachment reference, response source IDs and historical definitions remain visible. I found no gross clipping, overlap or missing-page pattern.

White space remains before the separate definitions section, especially complete-streets public page 4 and countywide public page 3. This is a layout economy issue, not lost content. The generic wording "1 contributions" and "1 reviewed staff response entries" is a minor grammar defect.

The map remains a limited overview. At county extent the internal area mark is hard to distinguish; the complete-streets line is also hard to identify separately from the gray context. There are no visible per-record map labels or street basemap. Countywide public honestly says zero mapped contributions, with the library entrance preserved as words in the register. Exact GeoJSON coordinates and IDs remain available. These files support record portability and broad context; they do not establish that a planner can locate each concern from the PDF alone or that the map is adequate for detailed decision-making.

Native Calc wrapping/top-alignment properties remain correct on inspected Read me and Long text cells. I visually inspected all four new Read me previews. All four new Long text previews are pixel-identical to the corresponding previews visually inspected in the preceding review. Selected Read me B5/B7/B8/B9 and Long text E2:E5 content is fully present in native PDF preview text after whitespace normalization. I did not visually inspect every workbook cell or every sheet, test Excel, or claim the diagnostic whole-width Long text print fit is a comfortable delivered print layout.

## Disposition and limits

Accept these final supplied artifacts for the scoped synthetic contribution-to-reviewed-response delivery demonstrated above. The earlier empty-public-county and no-staff-response gaps are resolved. Do not infer complete countywide survey coverage, a meaningful map at every scale, human task success, accessibility, competitive superiority or real public representativeness. Artifact inspection does not establish the parent's live moderation, authorization, recovery, mobile or Project evidence-bundle journeys.

ZIP attachment bytes match their manifest; I did not independently compare their original upload or test every privacy field. The package remains a current scoped review copy, not a proven complete original/history archive. Native-language correctness and accessible reading order remain unverified. The full v1 contract, nationwide obligations and separate AequilibraE/ActivitySim scientific boundaries are unchanged.

I used the PDF, spreadsheets, prove-it and unslop skills, wrote only `/tmp/engagement-review-b-populated-final/` and this report, and operated only private scratch LibreOffice instances, which exited normally. Source and delivered originals were read-only. Principal evidence includes `reconciliation.json`, `external-file-identity.json`, `checker-challenges.json`, `lo-recalculation.json`, `recalculated-value-comparison.json`, `response-reconciliation.json`, `native-preview-text-comparison.json`, `long-text-preview-comparison.json`, `previous-item-differences.json`, 20 page images and native previews.

Earlier report SHA-256 at this review: `9947a1143be55d33aac95d8e0379d4f909d099c7ec064769ded61f4ada208495`.

## Final delivered file hashes

| File | Bytes | SHA-256 |
|---|---:|---|
| demo-0-internal.pdf | 117687 | `77f7106dbf26c24847c72ea070199aae4466a88023b8b8a229cbee8a3f546a21` |
| demo-0-internal.xlsx | 42576 | `dd83dfc347920584e24b2b7ec2f4f79fc3abccecff2a52673f68d6d6bd0f26c0` |
| demo-0-internal.zip | 3712166 | `218a6279dfac4d57aface3e30b1f561f27b24dfe3a04221e36a3cdb35e72ebdb` |
| demo-0-public.pdf | 102470 | `f36c3ab8f2218cba6a8b95fa1a5d7850c2607f824934e4d667b93ad2f4996b5f` |
| demo-0-public.xlsx | 42005 | `222ad4ed45fe828cdac02db63b02ed2959cdacc0303c0b9598fc3b9f384e556d` |
| demo-0-public.zip | 165052 | `17b0d1de932b935b415971428f272771242dd29ccd1b0a96440841672a4480c3` |
| demo-1-internal.pdf | 199700 | `c9213da0c57c324a221f782c1b57baf17e051617bbbec1de53ddac178cafb388` |
| demo-1-internal.xlsx | 78281 | `cbbdd0d62b1c6ce4ba3c37cf18dbdbcb67b2a75b91a358da444bec6e8a2c241f` |
| demo-1-internal.zip | 438968 | `8c174789f93e8aa50e328cc970f9386f9d07af5ae47d1ee90899ab122f3481aa` |
| demo-1-public.pdf | 197812 | `03bea397ae3c535f0ce621ba1afd69f973d83c9138e73924d479fc480591d2a1` |
| demo-1-public.xlsx | 77949 | `00cd9deac4cdbad0732cd7cb5df22681681327ad2d99b08986f3229313c96762` |
| demo-1-public.zip | 437069 | `db5d8246bd44c226acd0209c3532e02a121a6b89d9cb4189cbedaafc6dfd3c84` |
