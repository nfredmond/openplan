# Planning integrations and portable artifact review

Reviewed committed baseline `891a0d89a848133d44b9e4f314a76a922cd71ace` on October 1, 2026. Published release reference: `bc47c0ce580ee24f1a3808978535f52218e796d4`, v0.66.0. This bounded supplement covers planning integration source and one synthetic ZIP/GeoPackage artifact. It does not review intervening commits or the untracked context-history prototype.

I own this report and `evidence/planning-*` in the independent review worktree. No application files, migrations, Git refs, live database records, provider calls, browser sessions or other checkouts changed. Applicable guidance includes AGENTS, planner-writing, unslop, any-place and prove-it. The spreadsheet skill was consulted when selecting the artifact exercise; the exercise uses ZIP and GeoPackage, not spreadsheet or PDF authoring.

## Conclusions

No additional confirmed finding is promoted from this bounded supplement. The core synthetic ZIP and GeoPackage preserve their tested custody and geography properties. Source review confirms the coordinating reviewer's dashboard schema mismatch. It also supports the financial approval-boundary finding already reported in `PROVIDERS_OPS_REVIEW.md`. Neither observation should be counted twice.

Full RTP predecessor reconstruction and agency-side procurement remain acknowledged roadmap work. The reviewed code does not establish that those complete workflows have shipped. Source-only archive pagination concerns remain a coverage risk, pending a representative native large-record exercise and comparison with existing disclosed archive limits.

## Coverage

| Area | Inspected evidence and depth | Outcome and limits |
|---|---|---|
| RTP adopted predecessor and export | `openplan/src/lib/rtp/extraction/acceptance.ts:161-204,290,357-476`; shared `rtp/export-input.ts:101-123,471-508`; `api/rtp-cycles/[rtpCycleId]/export/route.ts:69-71,144-161`; roadmap M12 | Candidate lookup scopes ID, cycle and workspace through caller access, and requires verified quotation before acceptance. Shared export input carries explicit unavailable evidence; PDF response identifies its engine. Business writes and accepted-candidate marking remain separate, with a warning when marking fails after a save. No duplicate-acceptance transaction reproduction ran. Missing whole-predecessor/chapter/policy coverage appears in the active roadmap and is not newly classified as a released defect. No adopted-plan PDF was rendered or visually assessed here. |
| Grant and consultant pursuits | `lib/grants/pursuit.ts:64-101,108-152`; `api/funding-opportunities/[opportunityId]/application/export/route.ts:223-281,345-415`; roadmap M14 | Pursuit context distinguishes proposals and grants, and explicitly flags old-schema fallback. Final unedited AI sections with available draft provenance are subject to a grounding gate. PDF storage and export registration are separate; the route reports failure when storage succeeds but registration fails. That is not a false success response. Missing referenced draft behavior and orphan/retry recovery need a dedicated reproduction. Full agency procurement remains known unfinished work. No submission, procurement award or provider call occurred. |
| Capital invoicing and planning-contract handoff | `api/invoicing/invoices/[invoiceId]/route.ts:161-172,192-208`; `lib/invoicing/contracts/invoice-position-server.ts`; `lib/invoicing/contracts/reconciliation.ts:33,45-67` | Financial route shares the approval field-binding weakness in PROV-01. Reconciliation uses integer cents, exact allocation-share and amount checks, separates outgoing/received billing, and preserves unknown billing when currency or dates are incomplete. This source sampling does not establish native allocation concurrency, reimbursement eligibility, closeout correctness or practitioner acceptance. |
| Shared Documents/evidence bundles | `lib/project-evidence-bundles/archive.ts`; `inventory.ts:382-424`; `bytes.ts:401` onward; `api/projects/[projectId]/evidence-bundles/[bundleId]/download/route.ts:35-70` | Selected byte checksums and reviewed revisions are compared; archive paths are confined. Inventory has an explicit candidate cap. Download checks workspace/project/bundle relationship, exact storage path, retained engagement disclosure access and stored checksum, with private/no-store response. Source review is not native Storage/RLS or revocation-race proof. Synthetic archive below tests builders, not authenticated download. |
| GIS source custody and portable geometry | `lib/workspace-gis/store.ts:55-72,100-106,169-189,212`; real project GeoPackage builder and existing fixture | Current GIS version is joined by the current-version FK. Projection retains original SRS basis, datum caveats, dropped features and truncation flags. The artifact exercise independently confirms one Ohio WGS84 geometry fixture, invalid-corridor disclosure and distinct unavailable layers. It is not nationwide, territorial, tribal-authority or arbitrary-CRS acceptance. |
| Operations dashboard integration | `lib/operations/workspace-summary.ts:1040-1044`; migrations `20260321000033_lane_c_lapm_pm_invoicing.sql:47` and `20260811000006_project_record_assignees.sql:49` | Independent source cross-review confirms `project_submittals` is filtered by nonexistent `workspace_id`. The table belongs indirectly through `project_id`; later assignee migration does not add workspace ID, and no later repair was found. Existing mocked summary queries do not enforce native column existence. Coordinating reviewer owns the real fresh-database/browser reproduction and finding severity. |

## Actual synthetic archive and GIS inspection

`evidence/planning-generate.ts` invokes the committed `buildProjectGeoPackage` and `buildProjectEvidenceBundle` implementations. It adapts the existing Ohio geometry fixture with explicitly synthetic records, a Unicode title (`SYNTHETIC Café 道路 🚲`), a valid project polygon and location, one valid corridor and one invalid latitude-95 corridor. The archive contains generated project JSON and the actual GeoPackage. No retained private files or database records enter the fixture.

Two builder runs with the same fixed generation time produce byte-identical archives. The ZIP is 9,071 bytes with SHA-256 `4543462a5f3df5c63b37c3d004d0377404091da3986a9203b36960b39e289e87`. `evidence/planning-artifact-generation.json` records the archive, manifest and checksum-file digests.

The independent validator in `evidence/planning-inspect.py` uses Python standard-library ZIP, SHA-256, SQLite and binary parsing, not the application's archive validation. It observes:

- No duplicate or escaping ZIP paths; archive CRC checks pass. Every listed entry checksum and manifest file hash matches the delivered bytes.
- The manifest does not claim approval/publication and contains no board-ready PDF. The Unicode project name survives serialization.
- SQLite integrity returns `ok`; GeoPackage metadata identifies EPSG:4326. Independently parsed point WKB carries longitude/latitude `(-82.9988, 39.9612)`.
- One project area, one project location and one corridor are included. The invalid second corridor is omitted and the omission count is one.
- AequilibraE and ActivitySim remain separate layers. Their unavailable counts are null, as are crash/KSI, engagement and land-use counts. They do not become observed zeroes.

GDAL's `ogrinfo -ro -so -al` opens the extracted GeoPackage with the GPKG driver and reads its layers and WGS84 metadata. The output is retained in `evidence/planning-gdal-inspection.txt`. GDAL inspection is a real parser check, but it is not interactive QGIS/ArcGIS acceptance, visual cartography review or a browser download. This fixture does not establish complex multipart geometry, other coordinate systems, anti-meridian handling, large exports, sensitive-record filtering, storage authorization or planner usefulness.

The validator has an exercised failure boundary: a harmless ZIP comment survives; changing project JSON bytes while retaining their original checksum fails specifically with `checksum mismatch: project/project.json`. These mutations use in-memory copies of the review archive and never change application source. `evidence/planning-artifact-inspection.json` records the controls and observations.

Reproduction from the review root:

```sh
(cd openplan && ./node_modules/.bin/tsx --tsconfig tsconfig.json ../docs/reviews/2026-10-01-independent-code-review/evidence/planning-generate.ts)
python3 -B docs/reviews/2026-10-01-independent-code-review/evidence/planning-inspect.py
ogrinfo -ro -so -al docs/reviews/2026-10-01-independent-code-review/evidence/planning-synthetic.gpkg
```

The extracted `.gpkg` is the exact `project/project.gpkg` member of `planning-synthetic.zip`. Rerunning the builder updates the ZIP, not the separately extracted copy; extract that member again before rerunning GDAL if the fixture changes.

## Existing checks and their blind categories

The existing `project-geopackage.test.ts`, `project-evidence-bundle.test.ts` and `rtp-export-paths-carry-the-same-document.test.ts` suites passed 32 tests across three files. Output is retained in `evidence/planning-existing-tests.txt`. These are supporting builder and export-path evidence. They do not establish native database projections, row limits, RLS, Storage access, complete predecessor interpretation, rendering quality, interactive native GIS use or public/practitioner acceptance. The new independent checksum validator detects byte corruption but cannot detect a consistently omitted record or a scientifically wrong value that was correctly hashed.

## Coverage risk requiring follow-up

`lib/project-evidence-bundles/generated-records.ts:216-218` describes freezing all attached model/county-run evidence. Several collection reads at lines 235-330 use ordered selects without pagination or exact-count checks, while `openplan/supabase/config.toml:14` sets `max_rows = 1000`. Generated `knownLimits` at lines 600-690 do not independently identify those query caps. The separate candidate-inventory cap does not by itself establish completeness of generated JSON and GeoPackage records.

This is a credible truncation risk, not a new confirmed finding in this report. No native fixture exceeding the API cap was created, and existing archive scope disclosures need to be compared against the exact resulting artifact before classifying user-facing harm. The next check should use more than one page of synthetic records, assert expected IDs against independently counted database rows, and inspect exported omission/cap disclosure. It should preserve an ordinary below-cap control. The checksum exercise above cannot see this category.

## Remaining limits

This supplement does not establish complete OWP/UPWP administration, capital reimbursement/closeout, tax-program recipient reporting, agency procurement receipt/evaluation/award, all RTP predecessor content, real PDF/XLSX output, export cancellation races, restored artifact access or human usability. Those are either covered separately by the coordinating review or remain explicitly unestablished. Known roadmap work is not relabeled as a new defect merely because this supplement does not complete it.
