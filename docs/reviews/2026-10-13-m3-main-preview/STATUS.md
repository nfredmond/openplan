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

## Corrected-main retry, October 13

A separate clean checkout builds exact main
`806d084b98d0c21af97e0b492935fb48fa8e0242` after the connector fixture correction.
Build `NpbO2XGo-f5vTmCabVQRI` serves on `127.74.9.10:3579`.
The production build passes in 118.115 seconds, with a peak of 6,975,291,392
bytes under the same 10 GiB cap and zero swap. Maximum and OOM counters stay
zero. No application source or type-check bypass changes for this retry.
The older isolated synthetic database and disabled managed admission remain.

New owned T3 tab six follows dashboard, project, model list and model links.
It starts at 1280 by 800 and successfully resizes to 390 by 844. The model
retains Oakland, zero runs and its prototype limitations. The engine selection
uses a DOM change. T3 reports failures for both native key calls, although the
feed value changes afterward. Those calls cannot establish keyboard usability.
An explicit DOM change then selects the original BART archive.

The actual form issues two coverage requests. Each uses geometry SHA256
`007c5ce9a3bea160193427fe1e6f769c33c239b3b448cd9e40ab623d9acdd8fd`
and returns HTTP 200, coverage yes and 238 scheduled rows. The first archive
reports January 10, 2027; the selected BART archive reports August 9, 2026.
These are retained schedule dates, not measured service or present-day validity.
The final DOM reports client and scroll widths of 390 pixels. This single
overflow measurement does not establish usable layout, visible controls or focus.

Image and text-only snapshots still fail on the same T3 client. A return resize
to 1280 by 800 times out; the final measured viewport remains 390 by 844.
No screenshot or desktop/mobile visual acceptance follows. The passive error
and rejection observer records no events after installation; earlier events and
the complete console remain outside its scope. No run or saved edit is submitted.

The owned app stops after the retry, with a peak of 359,874,560 bytes under
1 GiB and zero swap. Borrowed services remain untouched. Main CI and exact
public promotion are still separate and pending at this observation.
[Build](evidence/corrected-main-build.json),
[partial browser observations](evidence/corrected-main-partial-browser.json) and
[app resources](evidence/corrected-main-app-resources.json) retain this retry.
Private launch controls include three survivors and 30 typed refusals. Their
comparator cannot discover an omitted installation root or validate the whole
service installer. The private proof is `m3-corrected-main-preview-20261013`
under the same proof base. Full M3 and v1 limits above remain unchanged.
