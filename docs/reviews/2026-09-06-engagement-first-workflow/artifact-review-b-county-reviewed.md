# Independent artifact review B: county-reviewed final delivery

September 7, 2026. Bounded independent artifact follow-up under the product direction review protocol. Inputs are the 12 files in `/home/nathaniel/.local/state/openplan/engagement-evidence/demo-county-reviewed/` and sibling `demo-county-reviewed-evidence.json`. Prior failures, original files and independent reports are preserved.

**Accept these delivered artifacts for the bounded demonstrated record, geometry and export outcomes. The new approved county polygon is valid, has positive area and is fully covered by the retained county boundary. Point and route labels are now distinct. All 12 external file identities, 161 reconciliation checks, four forced native workbook recalculations and all 24 PDF pages were checked.** This does not establish human usefulness or superiority, complete countywide survey participation, live authorization, release readiness or broader v1 acceptance.

## Geometry and retained history

I used the locally installed GEOS 3.14.1 C API directly against GeoJSON extracted from the externally bound snapshot. `GEOSisValid` accepts the retained county Polygon and new contribution `e1048444-d42b-4a3a-9f0c-23cc4e2b369b`. `GEOSCovers(county, contribution)` returns true for the whole new polygon. This is a polygon topology predicate, not a vertex/edge sample. The new triangle has vertices `[-120.641778,39.422195]`, `[-120.540819,39.422195]`, `[-120.540819,39.344161]`, closed by its first coordinate. GEOS computes positive planar area 0.003939117303000242 square degrees; that value is only a nondegeneracy control, not an acreage estimate.

The prior outside triangle `ba2727ff-88e8-4a47-b530-2abf18ada7a0` remains valid and positive-area but returns false for the same coverage predicate. It is now rejected with an explicit outside-boundary review reason, remains in internal snapshot/GeoJSON/register/map and is absent publicly. The original collapsed area `856a3e10-ed6e-4566-82b6-2d0c35ea3996` remains invalid and zero-area, retained internally in raw snapshot and disclosed in the register while omitted from map/GeoJSON. These contrary cases show that the validity and coverage controls distinguish the earlier failures.

The distinct-endpoint route `a08d7bb0-5027-4159-8ac6-e94c2ac90b0e` remains unchanged: `[-121.046347,39.212866]` to `[-121.036782,39.212865]`. The historical degenerate route `9d91e0c9-fbfb-4679-8da8-f414b1278e76` remains rejected/raw internally and absent from public export and map/GeoJSON. Text-only contributions still have no invented geometry.

I compared these snapshots with the prior valid-geometry delivery. Every common record's geometry is unchanged. Complete-streets records are unchanged. County internal adds the new polygon and changes only the outside polygon's status, moderation notes and updated timestamp; county public replaces that outside record with the newly approved record. Sessions, answers, responses, definitions, campaign, filters, scope and schema remain unchanged. Capture timestamps differ. Earlier invalid/outside deliveries therefore remain evidence of what actually happened, not rewritten successes.

The geometry conclusion is relative to the exact retained boundary, whose canonical check hash is recorded in `geography-topology.json`. I did not independently reacquire the boundary source or establish its legal accuracy/currentness. Planar GEOS topology on these small ordinary longitude/latitude polygons does not establish worldwide antimeridian or polar behavior.

## Every-page visual review

I rendered and visually opened all 24 pages individually at a 1,300-pixel longest edge: complete-streets public 1–6 and internal 1–7; county public 1–5 and internal 1–6. The route label now sits near its last endpoint and point 1 remains visible in both overview and detail. Polygon labels are readable within the triangles. The new county public overview shows the sole valid approved polygon inside the retained county outline; internal overview shows both the new inside polygon and the rejected outside polygon with numbered register references. The invalid original is omitted. Detail headings remain with the actual detail maps.

Question headers, register bodies, selected survey answers, historical definitions, reviewed response narratives/source IDs and demonstration caveats remain visible. Public complete-streets answers retain the withholding markers; internal copies retain the separate original multilingual record. The final portable-record paragraph now explicitly explains that a Project bundle containing the PDF alone does not contain every engagement companion and directs recipients to the Reports record for the engagement archive.

One minor layout weakness remains: county internal staff response starts near the bottom of page 4 and continues on page 5, leaving most of page 5 empty. Some internal contribution review notes also continue across pages. No text is lost, and these do not prevent the bounded export outcome. Maps are schematic WGS84 overviews with disclosed lack of an external basemap and distance scale; I do not claim road-level context or cartographic publication quality. Accessible reading order, language correctness and human recipient usability were not tested.

## Integrity, record reconciliation and computation

Every full-file byte length and SHA-256 matches the independent sibling delivery evidence. Every ZIP snapshot matches its EXTERNAL retained-job SHA. Every manifest payload hash/length and complete inventory reconciles, and independently downloaded PDF/XLSX files equal their ZIP members. All 161 semantic checks pass, including exact contribution and answer CSVs with protected formula-like literals, expected valid GeoJSON IDs/coordinates, workbook rows/values, complete reconstructed HTML contribution text, historical definitions, contiguous long-text reconstruction and selected historical question counts. Response identity, narrative and source IDs reconcile in every scope.

All four Summary formula caches were deliberately poisoned to 987654321 in scratch copies, opened in native LibreOffice and explicitly recalculated with `calculateAll()`. All four pre-calculation values remained poisoned, then changed to the exact counts below. Every recalculated nonblank workbook value equals its original expected value and no error cells remain. Native wrapping/top-alignment properties and selected Read me/Long text preview text checks pass. Each complete-streets workbook has 145 ordered long-text pieces; each county workbook has 371. Their reconstruction matches the retained full text.

| Context / scope | Contributions | Sessions | Answers | Staff responses | PDF pages | Snapshot SHA-256 |
|---|---:|---:|---:|---:|---:|---|
| Complete streets / public | 3 | 1 | 2 | 1 | 6 | `98bcd5c1067d449c816ca9ce8a686ff94ae3909da9d12b109c06312da4af5365` |
| Complete streets / internal | 4 | 2 | 4 | 1 | 7 | `03f93a97f606ef30015ae6aa2fa11fde07d9e138cfafaae87654bff4d286df40` |
| Countywide wayfinding / public | 2 | 0 | 0 | 1 | 5 | `a40f440cd7e34feb3949041208c71b98914d90c91bf10af202582bff2dcb6f6d` |
| Countywide wayfinding / internal | 4 | 0 | 0 | 1 | 6 | `d38ec2dca4ab18c2a94e2ede18374cd2f30c731cddfeac6627cf85f23f0eab3d` |

The workbook check proves the four Summary formulas with actual native calculation; it does not establish additional analysis, Microsoft Excel behavior or every cell's visual layout. Public county has positive written and spatial contribution evidence and a grounded synthetic response, but zero county survey sessions/answers remains zero.

## Checks that can fail

The semantic checker accepts harmless public and internal ZIP comments. Changing one contribution word only in scratch snapshot fails six custody/content checks: snapshot checksum, manifest snapshot length/hash, external retained snapshot hash, CSV values, reconstructed HTML body and workbook contribution values. Reinserting the invalid historical route into scratch GeoJSON or removing the valid route each fails both the member hash/length check and exact GeoJSON IDs/geometry check. These outputs are preserved. The independent GeoJSON expectation intentionally retains valid rejected drawings internally while omitting invalid raw shapes; it is bounded to these fixture types, not a general topology validator.

The GEOS check additionally distinguishes the valid inside, valid outside and invalid collapsed polygons. Those controls establish this geographic relation against retained geometry. No source mutation or runtime input test was performed by this reviewer.

## Scope and disposition

All previous reports remain intact, including the explicit correction that the earliest route/area failure was degenerate geometry, not merely map scale. The separately requested nine-page review of the two unique shared Project PDFs is already preserved in `/tmp/engagement-review-b-valid-geometry.md`; those unchanged older files were not rerun. The improved portable paragraph in these new demo PDFs does not retroactively change the older shared PDFs or place missing companion archives into their bundles.

The supplied source checkpoint was `eccfc8267a92aa6b6b432384e2fc6477e58c6428`, and a read-only HEAD check matched it at review start. The final status check showed concurrent changes to product documents and three engagement components; these were reported to the parent and never touched. Acceptance here is tied to delivered file hashes and retained evidence, not an assertion that the working tree remained unchanged. The parent owns source guards, browser identity/reachability, access/revocation, tests, CI and release decisions.

Human usefulness and superiority over other tools remain unestablished. This review also does not prove general archive restoration, accessibility, complete engagement functionality, statistically representative participation or scientific/modeling claims. The concrete corrected artifact findings above are sufficient for this bounded independent review; the minor page-splitting limitation remains disclosed.

Only `/tmp/engagement-review-b-county-reviewed/` and this report were written. Original source and delivered files were read-only; private scratch LibreOffice processes finished normally. Evidence includes `reconciliation.json`, `external-file-identity.json`, `prior-snapshot-comparison.json`, `geography-topology.json`, `checker-challenges.json`, `geometry-checker-challenges.json`, `lo-recalculation.json`, `recalculated-value-comparison.json`, response/native-property records, and all 24 page images. The previously read PDF, spreadsheets, prove-it, any-place and unslop procedures guided this review.

## Delivered identities

| File | Bytes | SHA-256 |
|---|---:|---|
| demo-0-internal.pdf | 128755 | `21218a43b4d41ddffc250e36833d21d7fc6db547af5dfe9ff3295591d584a421` |
| demo-0-internal.xlsx | 42892 | `3e437acaee1faf4cb165abcd49c3ba04b11559671d11c76e612119da8b4b352f` |
| demo-0-internal.zip | 3721252 | `28ce30c4bc6944cb209a465080bb146bf6b22c7969b4a6caa83a18a93963469f` |
| demo-0-public.pdf | 111271 | `81c7b2658bd30d0113ddff9e164f75bcc677738d0908e7c063e2467434efc966` |
| demo-0-public.xlsx | 42070 | `b832f78dadc886944e8c1027d70ab720fecca0c2218fa9ade869647f3c0685dc` |
| demo-0-public.zip | 173358 | `8d8688abaf88033bddd33fd3e46b948f5bba11bac613fff61e596232308bcee0` |
| demo-1-internal.pdf | 213815 | `843a43973f0f2636ab0c86b767cb71c5a1091b33717c11f2eb49b0ce192a0ed8` |
| demo-1-internal.xlsx | 78720 | `f05b573fabe71cc0812644ec514a7b4eb72662fed7eb7b3034ac203aeebc35f2` |
| demo-1-internal.zip | 450981 | `be4a0a77029795bb779ea3519123f1d8939651830d93900bbe781a61e822745e` |
| demo-1-public.pdf | 206021 | `7e101229d5016a7048d71047f7b9a8ca2f566e4130fbd2744ec1ffcaf019223a` |
| demo-1-public.xlsx | 78218 | `d39914bf39da9155ffb3ba2b28cc29fb3c0fd4bccddd02030007fe55b8d978b2` |
| demo-1-public.zip | 443948 | `81d7b82bc18e963e8f4b24aad5b53ed675d5cf5b0cbdf2545637115e12c0b5f0` |
