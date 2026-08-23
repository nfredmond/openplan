# OpenPlan Local Real Orthophoto Render Smoke - 2026-08-23

## Command
- `cd qa-harness && OPENPLAN_AERIAL_SMOKE_PHOTOS_DIR=/absolute/path/to/photos npm run local-aerial-ortho-render-smoke`

## Proof boundary
- The input was a caller-supplied directory of genuine overlapping mission photos. The photos are not stored in this repository.
- The smoke created a fresh local user, workspace, project, and mission through OpenPlan, then uploaded every photo through the mission photo control.
- OpenPlan dispatched a `photo_manifest` under contract v1.1. The self-hosted worker ran NodeODM and called OpenPlan back.
- OpenPlan copied the worker-produced PNG into its own `aerial-artifacts` bucket. The browser fetched those held bytes through the authenticated map-layer route.
- Exact coordinates are deliberately omitted from this repository report. The browser screenshots remain local test output and are gitignored because they contain real imagery.

## Defect closed
- The first real run exposed that NodeODM 2.2 answers unsupported named artifact downloads with HTTP 200 plus `{"error":"Invalid asset"}`. The worker had treated those 25 JSON bytes as valid TIFF, PNG, elevation, and point-cloud files.
- The worker now refuses JSON download responses, downloads NodeODM's supported `all.zip` once, extracts only known deliverables, and renders the browser PNG from the real orthomosaic with GDAL.
- The shared map now offers `Zoom to preview`; without it, a valid roughly 300-meter raster was effectively invisible at the city-scale default view.

## Mutation proof
- Disabling the HTTP-200 JSON refusal made `test_nodeodm_client.py` fail because the fake error became a TIFF.
- Removing archive output collection made `test_pipeline.py` fail before it could claim a succeeded job.
- Making the panel's focus request a no-op made `aerial-ortho-layer-selection.test.tsx` fail with `none` instead of the selected custody ID.
- Removing the shared-map `fitBounds` call made `aerial-ortho-map-binding.test.tsx` fail with zero map-fit calls.

## Result
- Photos processed: 16
- Source bytes: 111143700
- Processing status: succeeded
- Imagery type: photo_manifest
- Held preview bytes: 4012068
- Held preview SHA-256: b62cb98b40f621fbc549d93e2d2da2ee42793d3640286d53e5003b8ccb884180
- Native CRS reported: EPSG:32617
- Pixel size reported: 0.049993943519079424
- Georeference: valid WGS84 rectangle reported by the worker; coordinates withheld from this report.

## Pass notes
- PASS: Local guard passed for local real orthophoto render smoke: app=http://localhost:3300, supabase=http://127.0.0.1:54321.
- PASS: Uploaded 16 real photos (111143700 bytes) through the mission photo control.
- PASS: Verified the browser-resolved PNG byte count and SHA-256 against the custody row.
- PASS: Observed successful PNG responses while the mission map and shared Aerial map rendered the held preview.
- PASS: Zoomed to the selected preview and proved its shared map canvas changed when switched off (on d7d66edd777d, off 3caab9b17408).

## Local screenshots
- docs/ops/2026-08-23-test-output/2026-08-23-local-aerial-ortho-render-smoke-01-mission-preview.png
- docs/ops/2026-08-23-test-output/2026-08-23-local-aerial-ortho-render-smoke-02-shared-map-on.png
- docs/ops/2026-08-23-test-output/2026-08-23-local-aerial-ortho-render-smoke-03-shared-map-off.png

## Verdict
- PASS: A real NodeODM run produced a georeferenced PNG, OpenPlan took custody of the exact bytes, the signed map route served the same SHA-256, and the preview was visible on both the mission map and the planner-selected shared Aerial map.
