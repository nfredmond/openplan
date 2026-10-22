# Saved project geography works; reviewed import confirmation fails

The parent follows the identified preview from its public landing page through
sign-in, Dashboard, Projects and the existing synthetic project. Saved geography
and jurisdiction editing work in the observed desktop and 390px journey.
Confirming a reviewed project import fails twice with HTTP 409. This candidate
does not have a completed import journey or release acceptance.

## Identity, ownership and browser boundary

The application is `21510042e94bcaf80f262205ad156a7bb639e35c`, build
`u1jUSo57HKk72eLd1Qv43`, at `http://127.74.19.10:3585`. The prior
[strict runtime readback](../2026-10-15-current-project-preview-runtime-readback/STATUS.md)
binds its actual listener, build, inputs and isolated helpers. Browser health
before and after the journey reports `21510042e94b`. It reports expected
419/latest-16 migration metadata and `database: not_checked`, not a live census.
The original web invocation `34615ba06b554482b0f79c90fe999a61` remains active.
After the journey its recorded peak is 300,019,712 bytes under a 512 MiB cap,
with zero current swap and a zero swap cap. No new event-counter claim is made.

T3 snapshot calls fail twice with `Preview automation snapshot timed out after
15000ms.` Its resize and DOM read also time out. The in-app browser fallback
reports `Browser is not available: iab`. These failures remain recorded. The
parent uses a separate Playwright MCP tab, leaving the blank tab and failed T3
tab untouched. All captures here are Playwright fallback evidence, not T3
captures. The parent alone controls the browser.

The existing synthetic owner signs in successfully using privately recovered
fixture credentials. No password, account or permission changes occur. Existing
project and feed data come from the retained isolated clone. New point, corridor,
jurisdiction declarations and uploaded CSV enter through actual product controls.
No direct SQL seeds this journey. The original source database and earlier proof
packets are not targets for these writes.

## Observed geography and jurisdiction behavior

- The Evidence section initially shows the saved Oakland boundary. The parent
  inspects actual desktop and 390px screenshots with its basemap and attribution.
- An uploaded Point with longitude 200 is refused. The alert explains the valid
  longitude/latitude range and asks for WGS 84 / EPSG:4326. It does not save a
  partial marker.
- A valid synthetic Point at `[-122.2711, 37.8044]` saves through the location
  editor. A three-vertex synthetic corridor saves separately as Other with no
  level-of-service grade. Its label explicitly says it is not a model network.
  The saved overview reports three features, zero unavailable and zero rejected.
- After a full reload at 390 by 844, the area and site remain visible and the
  corridor layer remains included. The map figure is 308px wide within the 390px
  page; document scroll width is 390px. The corridor is short at this area scale.
  Visual inspection alone does not establish exact coordinate parity.
- Clear to unresolved saves explicitly. A subsequent normal return from Projects
  preserves that state and disables legacy study-place fallback.
- The parent adds two explicitly synthetic unverified declarations through the
  390px editor, with overlapping and sovereign context scopes. Both names state
  that no authority is asserted. Saving and a desktop reload preserve both.
  Each receives a separate unverified, not-assessed presentation. The page keeps
  legal applicability and adopting authority unresolved. Mobile document width
  remains 390px.
- From the project's Overview, Open Corridor Analysis preserves project
  attribution and prefills Oakland from the saved study area. Desktop and mobile
  captures show the scope and its caveat that edits here do not change the
  project record. No analysis or scientific result is generated.
- Data Hub shows retained schedule states at both widths. The BART schedule is
  explicitly expired, with its January 12 to August 9, 2026 service window and
  historical-service warning. Failed and unadopted feeds remain distinct. This
  checks the visible labels, not the validity of derived service counts or a
  completed service-coverage analysis.

## Actual downloads and completed offline artifact review

The parent downloads GeoPackages, jurisdiction assessment JSON and a portfolio
workbook through visible links. The first pair precedes Clear to unresolved,
the second follows it, and the third follows the two unverified declarations.
These are different snapshots, deliberately retained separately. No artifact is
overwritten in the private download packet.

The private packet is
`/home/nathaniel/.local/state/openplan/current-project-preview-browser-fallback-20261015/`.
Its `downloads/` directory holds the immutable artifacts. The completed Sol-high
[independent artifact review](../2026-10-15-current-browser-download-artifact-review/README.md),
source commit `b61e316c6e5db0a87dde122e31c2a30887279955`, finds no confirmed
artifact defect within its scope. All three matching pairs preserve canonical
parity and identical geometry bytes. The point and corridor preserve the supplied
coordinates and order. The workbook preserves its unresolved snapshot's lineage,
literal cell types and leading-zero place reference. Known fixture-account values
are absent from the inspected content. One harmless change survives and 23
targeted artifact faults fail at their intended diagnostics. Originals remain
unchanged and copied artifacts are restored. The parent reads the full report,
probe and evidence, then freshly checks 21 artifact/copy/source/probe/result
bindings before joining the report. These checks do not establish native QGIS
or Excel rendering, accessibility or privacy under populated engagement data.
The workbook precedes the later declaration edits.

The `journey-01/` snapshot retains 55 files and a manifest with SHA-256
`0ba0e819b98650c8a130b89b03c9d6de112d1bce9ae1413966b23479fc950ec5`.
Raw screenshots and synthetic fixture records remain private. The accompanying
[evidence record](evidence.json) contains selected hashes and scoped findings.

## Blocking import failure retained

At 390px the parent stores a two-row synthetic CSV, selects its worksheet,
explicitly maps name, description, cost, status and source-location text, and
chooses EUR. Both rows initially stay Skip. The unsupported-status row is
blocked; its Create control is disabled. Tables scroll within their containers
while document width remains 390px.

The valid row has amount 125000, EUR and an unknown price year, with the visible
unknown-year warning. The parent selects that row for creation, leaves the
invalid row skipped, and requests a fresh combined review. Confirm and create
1 returns `409 import_stale`. A single retry after reviewing again returns the
same failure with the same approved preview hash
`b8d13529a3267b9b733a3ec80181494615d44c4940e833866bf691da006d0508`.
The UI reports that no part of the batch was saved, retains the source/review,
and still lists the original project count of one. Native rollback and
atomicity proof remain separate pending work.

Source inspection identifies a contract mismatch. The latest v2 commit function
checks supported status before checking whether a row is Create. The skipped
row retains `invented-status` for source custody. The audit table also applies
supported-status and delivery-phase constraints to skipped rows. Moving the
function check alone would therefore leave an audit insertion failure.
A separate Sol-high implementation task owns candidate additive migration 17,
focused tests and a native probe. Nothing applies that candidate to this preview
or hosted installation at this checkpoint. The failure packet is retained under
`import-failure-01/`.

## Console and acceptance limits

The retained all-navigation console file contains four WebGL ReadPixels stall
warnings and the two HTTP 409 errors from failed import confirmation. Its header
totals describe the current navigation and do not count all retained records.
The parent reads the actual entries. The console is not reported clean.

No practitioner or public-participant observation, full accessibility audit,
native QGIS/Excel acceptance, nationwide scientific validity, current transit
service finding, full installation recovery, hosted migration, mainline merge,
version bump or new release follows from this journey. The immutable older full
QA, current compiler/build evidence and this browser failure retain their
separate scopes. Import correction, native proof, independent review and the
corrected identified-build journey remain open. The artifact review resolves
only the bounded offline download inspection described above.
