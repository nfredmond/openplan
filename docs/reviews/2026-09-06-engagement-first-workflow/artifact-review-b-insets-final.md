# Independent artifact review B: inset attempt and shared Project bundles

September 7, 2026. Additive review of the 12 `demo-final-insets` files and three separately supplied shared Project bundles. Earlier reports and delivered files remain unchanged.

**The intended positive route/area demonstration fails. The stored line has two identical endpoints; the stored polygon has four identical vertices. Both have only one distinct position. These are zero-length and zero-area records, not merely difficult map scales.** The new inset cannot display a real route or area from those retained coordinates. Complete-streets page 3 shows only the co-located point; countywide internal page 3 shows an empty detail map while its caption says one mapped contribution.

I also correct my earlier review: describing those marks only as hard to distinguish at overview scale was incomplete. I reconciled coordinates to the snapshot but did not assess their geometric substance. Exact copying is not proof of a meaningful shape. This finding was sent to the parent immediately. Do not alter historical snapshots to make the example pass. New independently retained nondegenerate submissions and an identified-build review are needed to establish that positive route/area outcome.

## Concrete geometry evidence

| Context | Record | Retained geometry |
|---|---|---|
| Complete streets | `9d91e0c9-fbfb-4679-8da8-f414b1278e76` | LineString with both endpoints `[-121.046347, 39.212866]` |
| Countywide internal | `856a3e10-ed6e-4566-82b6-2d0c35ea3996` | Polygon with all four ring vertices `[-120.641778, 39.26604]` |

Both exact geometries are present in snapshot JSON and GeoJSON. They already existed in the preceding delivered versions. Every newly extracted inset snapshot differs from its corresponding populated predecessor only in `capturedAt`. The geometry issue therefore predates this inset renderer. These files alone do not determine whether the original automated map clicks were defective, the public drawing UI permits collapsed shapes, or both. The live input path and geometry validation require separate investigation.

## Integrity and computation

All 161 baseline reconciliation checks pass on the inset files, with the blind category above now explicit. All 12 files match the lengths and SHA-256 values in sibling `demo-final-insets-evidence.json`. Every extracted snapshot matches its external retained-job hash; every manifest member has its stated hash and length; the inventory is complete; separate PDF/XLSX downloads equal their ZIP members. CSV and workbook records, exact GeoJSON coordinates, HTML contribution bodies, retained definitions, contiguous long-text pieces, response records and historical selected-session question counts reconcile with the snapshot.

The unchanged-payload ZIP comment control survives. Changing one contribution word only in a scratch snapshot fails the same six custody/content checks recorded in the preceding review. These controls test snapshot corruption, not shape validity or every assertion.

All four workbook Summary caches were poisoned to 987654321, loaded in native LibreOffice, then explicitly recalculated with `calculateAll()`. Correct results are below. Every recalculated nonblank value equals its corresponding original workbook value; no error cells remain. This proves the four Summary formulas, not additional analysis. Native wrapping/top-alignment observations and selected Read me/Long text preview text checks remain consistent. I did not perform another all-cell visual workbook review or test Microsoft Excel.

| Context / scope | Contributions | Sessions | Answers | Staff responses | PDF pages | Snapshot SHA-256 |
|---|---:|---:|---:|---:|---:|---|
| Complete streets / public | 3 | 1 | 2 | 1 | 6 | `6b9fcd78c591b0f75e7fbf2758b078a9f117d60aba5613c3ca18eeb9f5e388b8` |
| Complete streets / internal | 3 | 2 | 4 | 1 | 7 | `9099df7d396e1e3de50fdeac5d54afca2cfbaf2283f44692dc53f20f0cb68de4` |
| Countywide wayfinding / public | 1 | 0 | 0 | 1 | 4 | `5c726d7e2f6c3c096cac389f5622c91c9e6901fb6651d32b5baca4fbeb3a294c` |
| Countywide wayfinding / internal | 2 | 0 | 0 | 1 | 5 | `2f7f1c460bbe321b88da9b36bb6f93cf7da59807e73896562c52fbe1352a0c3b` |

## Every-page PDF review

I independently rendered every page at a 1,300-pixel longest edge and opened all 22 images individually: complete-streets public 1-6 and internal 1-7; countywide public 1-4 and internal 1-5. The route/area inset problem above is the material finding. Countywide public retains its sole contribution as written location text, reports zero mapped contributions and contains no invented contribution point or detail inset. Gray overview context is separately described. Staff response source IDs, withheld answers, internal original multilingual answer, historical definitions and demonstration disclaimers remain visible.

The improved question-table headings and historical-definition placement remain intact. The new Contribution location detail heading and introductory sentence are separated from the actual inset by a page break. Complete-streets public contribution 3 also starts near a page bottom, with its body on the following page. Those are readability weaknesses, although no narrative text is lost. The promised visible numbered map-to-register labels are not apparent in these delivered inset PDFs. This review cannot establish native-language correctness, accessible reading order or human recipient usability.

## Shared Project bundle verification

I independently checked `shared-project-0-public.zip`, `shared-project-0-internal.zip` and `shared-project-1-public.zip` against `shared-bundle-evidence.json`. All three full-file lengths/hashes and project/bundle identities match. All 51 bundle semantic checks pass: checksum-file inventory, all eight listed file hashes per bundle including manifest/README, included manifest entry lengths/hashes, complete disclosure of payloads, and selected-report PDF record/checksum identity. The checksum list excludes its own hash; the external ZIP hash binds that file as well.

A harmless ZIP comment survives the bundle semantic checker. Appending text to a scratch README fails exactly `checksum README.txt`. I extracted each included PDF and viewed its first page to verify its campaign title and public/internal scope. I did not visually inspect every page of these separate shared-report PDFs or independently reconcile their underlying campaign snapshots. They are the separate Privacy and shared-report demonstration campaign, not the complete-streets/countywide inset PDFs.

Both project public bundles contain the same public PDF bytes, SHA-256 `66fde22b526eb061b7827d2d7d6e2683b76f2ceb580cfc8c5f6be8aa2fae353c`, artifact `038662db-2eee-47e8-b865-397527f02f38`, report `33858463-9e90-44c0-84bc-651718f11cb0`. Project 0 internal contains artifact `d1399be5-b314-4a4a-b5c5-ea5720f7d8e0`, report `50f750dd-7247-45e4-b1f4-ab5000883d0b`, PDF SHA-256 `263f1d138cb0cc22064b39146b610e0f46217e4e850d7e4679da6256459978a0`. This establishes the supplied bundles' inclusion and byte identity. It does not establish runtime access, later revocation, UI reachability, or every data value in their GeoPackages; the parent owns those separate checks.

## Disposition

Accept the supplied file integrity, snapshot reconciliation, count calculations and three shared-bundle payload identities. Reject the claim that these inset artifacts establish an enlarged meaningful route and area. Positive written-location contribution-to-reviewed-response delivery remains evidenced; positive countywide survey participation remains absent. Human usefulness, superiority over another product, accessibility, complete archive recovery and all broader v1/scientific claims remain unproved by this review.

I wrote only `/tmp/engagement-review-b-insets-final/` and this report, using the same PDF, spreadsheets, prove-it and unslop review procedures. Delivered originals and source were read-only; only privately owned scratch LibreOffice processes ran and exited normally. Main scratch records are `reconciliation.json`, `external-file-identity.json`, `degenerate-geometry.json`, `prior-snapshot-comparison.json`, `checker-challenges.json`, `lo-recalculation.json`, `recalculated-value-comparison.json`, `shared-bundle-reconciliation.json`, `shared-bundle-checker-challenges.json`, the 22 PDF page images and three shared-PDF identity images.

## Inset delivered file hashes

| File | Bytes | SHA-256 |
|---|---:|---|
| demo-0-internal.pdf | 122128 | `cf9c9147d0f6e11daaec1c53b945732771a0f267ceabb908e969b7764375d4ea` |
| demo-0-internal.xlsx | 42577 | `32da31eb90b24fa3a1d7141f6d852f369c7bca1a3ca20dbda2be1682a53538f7` |
| demo-0-internal.zip | 3715788 | `13c8fa74715905aee90d0d216d4e91406c6d7bc10bee269acbce869b408ce508` |
| demo-0-public.pdf | 105769 | `8869eeef6f4ba377d115b2c64a68050c65de81540012ecdd5d1346931efdbc27` |
| demo-0-public.xlsx | 42005 | `76e32436c47c981ef00b5123c0d3fcc5abff223363a7e6f5341b1a683f0517bf` |
| demo-0-public.zip | 168094 | `9ec4c8714dc03e41a5e79667e2abe7b3f8519c03a0abd27641b531e8df5ae6cc` |
| demo-1-internal.pdf | 203001 | `f6c1695fd26fe3ab24991df1bc0405d3b2a00cde173a350d9e25b0f5405111e8` |
| demo-1-internal.xlsx | 78281 | `f0cbd3b74ef5d66ef5433673be36741f42c2798d2e4579ead0f60b11baa75d3b` |
| demo-1-internal.zip | 441428 | `d8880ae0e1eeef2157edc4d5ca7ea00737c8954a5e9c538f4f753b421229f38a` |
| demo-1-public.pdf | 197658 | `9056ba7008c15436c70e54cf79a5606acebe906ca9ae42a14a9cb021b59d4d53` |
| demo-1-public.xlsx | 77948 | `ddfd8815aa7d8089da0b66e257d9bde617f9b6a0079fbc94d323ded12fa6db48` |
| demo-1-public.zip | 436919 | `c1c055baca4dc6d1c72e31ec87c955e68c1bebff689b345cb7a1fe898f36b521` |
