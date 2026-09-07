# Independent artifact review B: valid geometry delivery

September 7, 2026. Bounded independent follow-up under the product direction review protocol. Inputs: the 12 browser-delivered `demo-valid-geometry` files and sibling external `demo-valid-geometry-evidence.json`. Earlier reports and original deliveries remain untouched.

**The new route has distinct endpoints and the new area has nonzero area. The original invalid drawings are preserved internally and excluded from public files, maps and GeoJSON. File reconciliation and native workbook calculation succeed. Two demonstration defects remain: the new county area is visibly outside the retained county boundary, and the route register label obscures the existing point label.** Neither defect is a custody failure. The parent is preparing separately retained corrections; this report applies only to these delivered bytes.

The prior inset review's correction remains binding: the original route and area were degenerate, not simply too small to distinguish. This round establishes meaningful new shapes; it does not retroactively repair those prior files.

## Geometry and visual findings

The approved replacement route `a08d7bb0-5027-4159-8ac6-e94c2ac90b0e` runs from `[-121.046347,39.212866]` to `[-121.036782,39.212865]`. Both endpoints differ. The approved replacement area `ba2727ff-88e8-4a47-b530-2abf18ada7a0` has three distinct vertices: `[-120.641778,39.26604]`, `[-120.540819,39.26604]`, `[-120.540819,39.187832]`, followed by the first vertex to close the ring. Its local shoelace area is nonzero.

The county overview places this new triangular area south of/outside the retained gray county boundary. That is a visual containment finding, not a numeric topology test or evidence that all outside submissions should be prohibited. The parent confirms this campaign permits outside input; a new inside-county demonstration remains needed for the intended example. Complete-streets point 1 and the new route share the first coordinate. The route label covers point 1 in the maps despite there being only two mapped contributions. A caption allows overlapping labels, but the observed ambiguity reduces map-to-register usability.

The rejected historical line `9d91e0c9-fbfb-4679-8da8-f414b1278e76` and polygon `856a3e10-ed6e-4566-82b6-2d0c35ea3996` retain the exact degenerate coordinates documented in the prior report. Internal registers explicitly disclose that these drawings are invalid or degenerate and omitted from map/GeoJSON while their exact coordinates remain in snapshot.json. These rejected records are absent from public selections. Text-only records retain written descriptions without invented point geometry.

I rendered and visually opened every demo PDF page at a 1,300-pixel longest edge: complete-streets public 1–6, internal 1–7, countywide public 1–5 and internal 1–5 (23 pages). New line/area details are visible. Detail headings stay with their maps. Numbered register entries, retained question definitions, staff responses and source references remain legible; no missing body text or clipped table headings were found. This inspection does not assess accessible reading order or native-language correctness.

## Reconciliation and checker controls

All 12 full-file lengths and SHA-256 hashes match the external evidence. Every extracted snapshot matches its external retained-job SHA; every manifest payload has its expected hash/length, inventory is complete, and standalone PDF/XLSX bytes equal the ZIP members. All 161 baseline semantic checks pass: exact CSV records and protected literals, workbook records, reconstructed long text, HTML contribution bodies, retained definitions, response sources/narratives and question-summary counts reconcile to the retained snapshot.

The initial checker expected every raw geometry in GeoJSON and failed the two internal scopes. I preserved that result as `reconciliation-before-validity-scope.json`, then independently adjusted the expectation to omit explicitly invalid raw drawings while still retaining them in snapshot. An invalid raw shape does not fall back to its numeric latitude/longitude. This is the documented export boundary, not permission to drop valid shapes. The adapted checker is bounded to these point/line/polygon fixtures; it is not a general geometry topology validator.

A harmless internal ZIP comment survives every semantic check. Reinserting the historical invalid route into scratch GeoJSON fails the exact-geometry check and member hash/length check. Removing the valid replacement route fails the same two checks. A separate harmless public ZIP comment survives; changing a contribution word only in scratch snapshot fails six custody/content checks. These controls show that the tested boundaries can fail; they do not prove all assertions or live input guards.

## Native workbook verification

All four workbooks were opened in LibreOffice with a private scratch profile. Every Summary cached result was first poisoned to 987654321; native `calculateAll()` restored the four expected counts shown below. Every recalculated nonblank cell matches the original workbook's expected value and no error cells remain. Native wrap/top-alignment properties and selected Read me/Long text preview text were checked. There are 145 long-text pieces in each complete-streets workbook and 371 in each countywide workbook; ordered reconstruction remains exact.

This proves these four Summary formulas with actual calculation, not merely trusting supplied caches. I did not repeat an all-cell visual workbook review or test Microsoft Excel.

| Context / scope | Contributions | Sessions | Answers | Staff responses | PDF pages | Snapshot SHA-256 |
|---|---:|---:|---:|---:|---:|---|
| Complete streets / public | 3 | 1 | 2 | 1 | 6 | `7dad621bb0df4f6b81d0daa561c3650b02663c0c96a3c594a7a5bdac04bbbdd7` |
| Complete streets / internal | 4 | 2 | 4 | 1 | 7 | `536a7dbc2020b7d8dd369eee364112097c0fca15c24f0e5e741dac5c57d92829` |
| Countywide wayfinding / public | 2 | 0 | 0 | 1 | 5 | `55f19fbb74182577e0d3422a2b98c1e7f8fbfa52d4a24af66ea10f76d0ced103` |
| Countywide wayfinding / internal | 3 | 0 | 0 | 1 | 5 | `7f85a907825b48635ba27a03ca376957a30bd520c52ff599ba3f4c1e48a5d940` |

## Separate shared Project PDF completion

The prior inset report independently established all three shared Project bundle external hashes and every manifest/checksum member, with a surviving ZIP comment and failing README mutation. This follow-up extracted the same two unique included PDFs and visually inspected all nine pages: public 1–4 and internal 1–5. The public PDF bytes remain SHA-256 `66fde22b526eb061b7827d2d7d6e2683b76f2ceb580cfc8c5f6be8aa2fae353c`; internal remains `263f1d138cb0cc22064b39146b610e0f46217e4e850d7e4679da6256459978a0`. Both public Project bundles use that same public PDF.

These reports are the distinct “Privacy and shared-report demonstration only” campaign `9ebfd7bb-34fd-44c1-b12c-695c5df4c29e`, not either positive demo above. All pages retain public/internal identity. The internal report visibly includes the synthetic private pending/orphan records; those are absent from the public PDF. Reviewed photographs render. Public page 3 and internal page 4 are mostly empty answer/staff-response sections. No body clipping was found. Missing historical context and zero survey/staff-response participation are explicitly disclosed.

The final-page “companion ZIP” paragraph describes the full engagement archive with workbook/snapshot/CSV/photos. The inspected Project bundles contain the PDF and Project evidence payloads; this review does not establish that the full engagement companion archive accompanies those Project bundles. Runtime authorization, revocation and user navigation are the parent's separate scope. No independent snapshot reconciliation of this separate privacy campaign is claimed here.

## Source observations and limits

A read-only source inspection found all four keyboard arrow pan calls in each of the two engagement map components using duration 0, and geometry validation rejecting all-identical line positions and zero-area polygon rings. This alone does not prove the runtime interaction or guards. The parent owns those browser and mutation checks. I also reported that the then-current location-count helper could fall back to numeric coordinates for an invalid retained drawing. The parent reported a fix and targeted mutation afterward; that later change is not independently accepted by this retained artifact report.

Accept the exact delivered file custody, retained record reconciliation and native Summary calculations for these bytes. Accept that a meaningful new line and area now exist. Preserve the outside-county and label-overlap findings; do not claim the intended final visual demonstration complete on this delivery. Human usefulness, superiority over another product, public participant usability, accessibility, full archive recovery, complete countywide survey participation and broader v1/scientific claims remain unproved.

Only this report and `/tmp/engagement-review-b-valid-geometry/` were written. Delivered originals and implementation remained read-only. Scratch LibreOffice processes completed normally. Primary evidence: `reconciliation.json`, `external-file-identity.json`, `checker-challenges.json`, `geometry-checker-challenges.json`, `lo-recalculation.json`, `recalculated-value-comparison.json`, `response-reconciliation.json`, `shared-pdf-identities.json`, 23 demo page images and nine shared-report page images. The PDF, spreadsheets, prove-it, any-place and unslop procedures informed this bounded review.

## Delivered file identities

| File | Bytes | SHA-256 |
|---|---:|---|
| demo-0-internal.pdf | 128676 | `b9e7a5e7ce372f43099562541a0d9b9bfa499e102b157b3e2a94436875900605` |
| demo-0-internal.xlsx | 42893 | `462422dcccada9ee0993b06717b542f75fed2be1e1c99e9b657150aca88bc337` |
| demo-0-internal.zip | 3721069 | `4d5bba23babccd158eb17bcf282ec6a822a418235393ca641a9df3194c18f469` |
| demo-0-public.pdf | 110518 | `51b70be9e445cd19c699b0dbae895e276ce125d80e5341ab21e08d8a7a0a105d` |
| demo-0-public.xlsx | 42071 | `27fbdc2dbfc2fe07521323943cabab9110e3159447faebf1b7f42f0d7c3076cb` |
| demo-0-public.zip | 172501 | `d8d6f59aeaeb869375ed518ed8c95e426548b20ec3f4c0d0249a2b16a78be08c` |
| demo-1-internal.pdf | 209704 | `1f77ef25477de099baca055bd7e57868eb77717ab9fb8c5d6170fe1f1cb3bd32` |
| demo-1-internal.xlsx | 78490 | `a116f21edef5d49e8c751c69eed8bb247ede5df74ff7d5adc0d7a0efdcbf5f77` |
| demo-1-internal.zip | 447175 | `aa94bf2fe6f9b2d26f3b5554dd8b6bd7d4ea45ca33cca019403e6c8b30ac5c81` |
| demo-1-public.pdf | 205832 | `a44d6c49c167476a9a0cc3271b1833c57aeb8fc35e22541add26094257b2b419` |
| demo-1-public.xlsx | 78216 | `9a1eb17f72440d52c6c72573afd69b25345a4da91b431d3c0f03f1b89e221d6f` |
| demo-1-public.zip | 443585 | `9da1aac9f95345e0533e514c455a6c64d3e1ba92b4233d9bffb75ab7e9246ddd` |
