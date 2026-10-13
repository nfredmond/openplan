# Current-main build and partial transit coverage journey

The isolated app builds at main `14ec90115b1629c35e0382938d8296dc0d5e118a`.
Its model form makes the coverage request with the saved project geometry.
This record does not establish visual or mobile acceptance.

## Build and target

The checkout is `m3-main-preview-20261013`, branch
`verify/m3-main-preview-20261013`. No tracked source changes precede the build.
The nested application uses Next.js 16.3.8 and webpack. Its build identifier is
`8GniSObykruqCmEWqLrLP`. The owned server listens on `127.74.9.10:3578`.
Process cwd and actual `/api/health` identify the checkout and commit above.
Health reports app `ok` and database `not_checked`.

The first build compiles but fails during TypeScript checking at a 4 GiB V8
heap limit. It takes 115.209 seconds and peaks at 6,833,672,192 bytes. The
8 GiB service cap records no maximum or OOM event. This is a V8 heap failure,
not a recorded Linux memory kill. The failed log remains in the private proof.

The retry uses the package's documented 6 GiB heap setting, a 10 GiB service
cap and zero swap. It finishes compilation, types and the production build in
98.956 seconds, peaking at 6,743,445,504 bytes. No maximum or OOM event occurs.
No source, type-check bypass or build configuration changes make it pass.

The app uses the older retained synthetic target at `127.74.9.10:29941`,
database `openplan_attempt_cli_fc468084c83c4a2499c60ab61d48db47`.
This is not a current-main database, hosted installation or demo target.
Existing isolated services pass their original identity/profile checks.
AI keys are absent and managed transit admission stays disabled.

## Actual read-only navigation and request

The T3 preview opens a new owned tab at the dashboard. Actual links lead to
the synthetic project, the Models list and its existing draft model.
The project and model retain Oakland as the saved study area. There are no
model runs or scenario entries. Prototype and validation caveats remain.

Native select-key actions fail in T3. A DOM select change chooses AequilibraE
and the retained BART feed `bb28bb0b-1c4f-4e9d-9774-fc24a42d928c`.
This establishes DOM interaction, not keyboard usability.

A passive observer records the form's actual POST to
`/api/gtfs/feeds/study-area-coverage`. It does not mock the request or response.
The request names the synthetic workspace and chosen feed. Its geometry equals
the form's saved study geometry. The serialized geometry SHA256 is
`007c5ce9a3bea160193427fe1e6f769c33c239b3b448cd9e40ab623d9acdd8fd`.

The response is HTTP 200 with coverage `yes`, reason `null`, 238 scheduled
stop-service rows, schedule end `2026-08-09` and `usesFrequencies: false`.
These are retained schedule facts. They do not measure actual transit service.
The DOM retains the selected feed, its schedule-date text, Oakland and zero
stored runs. No launch, adoption, project edit or saved change is submitted.

## Browser and operational limits

T3 snapshot capture fails, including a text-only retry. Two resize requests
for 390 by 844 time out after 15 and 20 seconds. Subsequent status and DOM
reads still report 1280 by 800. No screenshot, mobile layout, keyboard, focus,
contrast or complete desktop visual acceptance is claimed.

Passive error, rejection and console observers record no events after their
installation. They cannot recover earlier console events. DOM text and one
request are partial browser evidence, not a full console or rendered journey.

The owned app stops after the check. Its observed peak is 365,137,920 bytes
under a 1 GiB cap with zero swap. Borrowed proof services remain untouched.
The build and app use memory caps serially. This is not workload capacity,
clean agency commissioning, installation-wide or physical-host recovery,
useful long computation, practitioner acceptance, model accuracy, full M3 or v1.

Original logs, launch controls, DOM observations and build records remain under
`~/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/m3-main-preview-20261013/`.
The build/launch comparator controls do not establish installation completeness.
Main CI, schema and exact public deployment verification remain separate from
this isolated partial journey.

[Failed build](evidence/failed-build.json),
[passing build](evidence/passing-build.json) and
[partial request observation](evidence/partial-browser.json) retain the bounded
results. Private original logs and DOM text remain outside the repository.
