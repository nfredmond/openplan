# The previously failing mixed CSV imports on the identified V6 build

October 15, 2026. Root repeats the actual front-door journey on application
`49e3fa2004c1336ffa36c134a8f21bcc2d72d327`, build
`7X3x8RgohlUwVf_lPZa5r`. The exact source CSV and approved preview that failed
twice on the old 215/419 installation now return HTTP 201. One project is created.
The invalid row remains a Skip decision and an invalid audit outcome.

This closes that bounded browser reproduction. It does not declare v1 complete,
release a version, apply a hosted migration or establish practitioner acceptance.

## Build, runtime and browser identity

The new preview is `http://127.74.19.11:3586`, with API gateway port 29949.
Its exclusive database is
`openplan_project_portfolio_preview_8f43260b95a071cc4e6d2b90`, OID 6150036,
owner postgres. The reviewed restore and additive upgrade establish 420 migrations,
latest `20261017000017`. The retained source remains at 419/latest 16.

The [parent operation record](../2026-10-15-portfolio-skip-preview-v6-parent-operation/STATUS.md)
and [build observation](../2026-10-15-portfolio-skip-preview-v6-build-observation/STATUS.md)
identify the one successful fresh build. Root requests one web start, invocation
`acf6a83fa77a43dea46314247a00d95a`. Strict attestation then succeeds under
invocation `bb2d12f05aeb47c49d7a75d993c29330`, after 65.287 seconds.
It checks the actual listener PID 2375659, MainPID 2368660, process cwd and cgroup,
sealed environment with the exact npm PATH, non-cache built bytes, helper and
database identities, source custody, and HTTP build identity. The receipt SHA-256 is
`1700d98c21249705d1eb6c355a2151799c9e05a4db8598144beff5abc49f1fb7`.
The web observation records a 512 MiB cap, zero swap, peak 315,109,376 bytes
and zero recorded memory events at acquisition. The database server is uncapped.

Fresh T3 preview status initially finds no attached automation tab. Root opens
its own tab 7. Two snapshot calls both return
`Preview automation snapshot timed out after 15000ms.` Root retains both failures
and switches to the available Playwright MCP connector under the documented
two-failure fallback. Root creates its own tab 1; blank tab 0 stays untouched.
This does not establish working T3 screenshot capture.

Root enters the landing page, follows Sign in, uses the existing synthetic owner,
then follows Dashboard, All projects and Import project list. There is no account
reset or hand-seeded project. Browser health reads identify APP49 and the expected
420/latest-17 manifest. The health endpoint itself says database `not_checked`;
the separate strict attestation and native reads own database claims.

## Exact failed source and reviewed decisions

The retained 256-byte CRLF CSV has SHA-256
`b6c01c67c37506a56301c37301f0eb84d9d21dcacb415a4988c21f0e00e7e0a7`.
Root selects its CSV worksheet, maps name, description, estimated cost, status
and source-location text, and explicitly sets EUR with units and no price year.
All rows initially remain Skip. Root selects Create for row 2, then refreshes
Review selections. The final approved preview hash is exactly the old failed hash:
`b8d13529a3267b9b733a3ec80181494615d44c4940e833866bf691da006d0508`.
An earlier preview before selecting Create has a different hash and is retained.

| Source row | Reviewed decision and data | Actual result |
| --- | --- | --- |
| 2 | Create `Synthetic UI import =1+1`, active, capital_program, programming; EUR 125,000; unknown price year warning | One project created, ID `e2abb2ec-fdd6-4f79-bb47-84a4b0b635e1` |
| 3 | Skip `Synthetic skipped row`; raw status `invented-status`; blocked with invalid_status | Invalid audit outcome, no created project, raw status retained |

Root inspects desktop review, then confirms at 390 by 844 CSS pixels.
The POST returns HTTP 201. The page reports `Import complete. 1 project created.`
The outcome summary reports created 1, invalid 1, skipped 0. Outcome categories
do not erase the invalid row's Skip decision.

A fresh preview of the same stored source recognizes row 2 as already created,
locks it to Skip and disables confirmation. It reports one created-before row.
No second commit request occurs in the captured API sequence. A fresh native
read finds one batch, two audit rows, two workspace projects including the
pre-existing fixture, and zero projects named `Synthetic skipped row`.

The actual read-only query binds target OID 6150036. It confirms amount 125000,
currency EUR, null price year, source-document linkage, source and approval hashes,
and actor equality across batch, audit rows, project author and cost recorder.
A separate query confirms that actor is the one existing owner account and
workspace owner. The imported project's place fields, point and jurisdiction
remain null. `Unverified text only` and `Not a jurisdiction` stay in the audit.
They do not become project geography or authority.

The native readback hashes are
`d685d897ca62c0153f71c2826834ff3e4db2a3e4a5f13c0869f55e95a2a73aba`
and `c70f9b4370c91047a47047824f10e55e87dbd3a7d1bf08e50de7bc0317d8dc16`.
These are scoped observations, separate from the earlier rollback-only RLS,
atomicity and immutability proof. They do not prove every live permission boundary.

## Saved geography and jurisdiction remain different records

Root opens the existing synthetic geography project from Projects, then Evidence.
Its saved Oakland area renders before a site marker exists. Through normal UI
controls, root saves point `[-122.2711, 37.8044]` and uploads and saves the existing
three-point synthetic corridor. The overview shows three layers, three features,
zero unavailable and zero rejected shapes. Root inspects desktop and 390px images.
The blue area, green marker and amber line appear together. The line is small at
the full-area scale. This is a display corridor, not a model network.

The file reader refuses the longitude-200 point with a visible coordinate-range
error. The existing saved numeric location remains in place. No invalid location
save request follows that refusal.

Root edits jurisdiction through Overview. Explicit unresolved state suppresses
legacy study-place fallback while Oakland stays the study area. Root then saves
two synthetic unverified declarations, one sovereign and one overlapping.
Both display `Unverified staff declaration` and `Not assessed here`, including
when US-CA is present. No adopting authority or legal applicability follows.

Root retains three actual JSON/GeoPackage pairs: legacy, explicit unresolved,
and corrected sovereign/overlap declarations. The separate artifact review checks
their emitted bytes. An intermediate parent entry error is also retained: the
supplied dropdown value `overlapping` times out because the actual value is
`overlap`. Parent incorrectly continues and saves the second fixture as sovereign.
Parent acknowledges that error, removes only the second entry, selects the
observed `overlap` value, adds it again and saves through the UI. The intermediate
JSON is excluded from the three correct pairs. No application fix is inferred.

## Handoffs and source caveats remain visible

From Evidence, root follows the visible Corridor Analysis link. The project
context and Oakland study area carry forward. Desktop and 390px views state
that changing or clearing the analysis selection does not alter the project.
No analysis run or scientific result is generated during this journey.

Root follows Data Hub from analysis. The adopted historical BART schedule carries
`Schedule expired` and its actual service window. Its history records a ready,
in-use version while the card warns that the service levels are historical.
Other cards distinguish failed or unadopted imports and a current adopted schedule
with a later abandoned attempt. Root requests no refresh, upload, adoption or
removal. This is a source-status inspection, not a new worker or service-coverage
calculation. It does not independently establish transit-service accuracy.

The captured journey console has zero errors and four WebGL ReadPixels GPU-stall
warnings. These warnings remain recorded. The filtered application API sequence
contains no non-success response. Selector ambiguities, stale references, file
chooser snapshot refusal, the wrong dropdown value and T3 timeouts are tool or
parent-operation failures, retained separately from application console results.

## Downloads, controls and final preservation

The UI-downloaded workbook has SHA-256
`0b1b75fadfe597c545a00a0d558ee16b890be6bbc86f22bcb537c3832d035225`.
The [independent workbook review](../2026-10-15-v6-actual-import-workbook-review/README.md)
finds exactly the retained and created project rows, literal text and cost values,
blank unknown year, and matching cost source document. It finds no P1 or P2
within that frozen set. Its harmless control survives and 21 targeted faults fail
for their named reasons, with copy restoration. Root reads the full report,
checker, controls and fresh input/source hashes before joining the report.
The workbook has no audit sheet or source-hash, approval-hash, batch or actor
columns. The JSON receipts and database carry those separate facts. Native Excel,
LibreOffice and QGIS use remain unverified for these downloads.

The final reviewed `post-journey` stage runs once and exits zero, invocation
`235969ecd0ad4cabbebbe292115a31ba`, after 31.538 seconds. It reacquires the source,
protected old databases, Storage, prior packets and inputs, original helper IDs
and typed active states, old web identity, and new helper configuration/readiness.
The source fingerprint still equals
`82fda3004c8dd5d3f1e26eb179e11d1da159eb79a33253a636de37ef68213547`.
The two protected database snapshots match the original baseline. Four original
helpers remain running, unpaused and non-restarting at acquisition. Old web
invocation `34615ba06b554482b0f79c90fe999a61` remains unchanged. New preview writes
are intentionally excluded from that preservation comparison.

The final receipt SHA-256 is
`f09ae98bddf25c150cdef74cbb792eb1589b28ce85c99c37fdeae389e38b8607`.
Its unit reports rounded peak 90.7 MiB and zero swap; event counters were not
acquired. The parent initially compares digest strings against raw snapshot
lists and refuses its own bookkeeping check. Parent retains that failure,
uses the pinned canonical digest representation, and compares successfully.
A harmless whitespace control survives and a changed snapshot count is detected.
No operating stage is retried. These observations do not prove uninterrupted
availability between acquisitions.

[Evidence index](evidence.json) identifies the private frozen packet and its
50 captured files and inputs. The capture inventory SHA-256 is
`d23057e90c730f51ddcd8efc6533c3e748e7d4e8cf556049871a2089a7845abc`.
Screenshots and raw receipts remain private. Some captures precede a visible tab
change or occur during navigation resizing; the index names the usable replacements.
The failed trials remain evidence of their own limits, not screenshots of success.

The old preview, retained native proof database, source anchor, demo and canonical
three unrelated entries remain protected. No new PR, main merge, hosted change,
release, scientific acceptance or practitioner acceptance occurs in this record.
The [current geography artifact review](../2026-10-15-v6-actual-project-geography-artifact-review/README.md) finds no P1 or P2 within its three frozen pairs. Root reads its complete report, checker and controls, and checks eight input hashes, eight source bindings and the checker hash before joining it. One harmless control survives and 16 targeted faults fail, with exact copy restoration. All three packages preserve identical area geometry, including its hole, and the exact saved point and line. Integration CI remains pending.
