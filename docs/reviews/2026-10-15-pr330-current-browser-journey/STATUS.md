# Corrected-source interactions and artifacts work; visual acceptance remains partial

Root follows the front page, sign-in and module navigation in T3 preview against
commit `f0cbeddff5ae3fc37e0dd8b91c02601429d977a6`, application tree
`a13c491da3ad3ba5b237ca5fa8802b236c4ef27b` and BUILD_ID
`Z9s8u410cuLfXdEF5aeoi`. Strict listener, checkout, cgroup, environment digest,
npm path, built-file and HTTP checks pass before navigation. Listener PID is
935032; web invocation is `0091bad4bcf34d8c89051034629cd377`. This is the new
local preview at `127.74.19.13:3587`, not the demo or hosted installation.

The isolated target is OID 6181197 with 420 migrations, latest
`20261017000017`. Native checks use read-only transactions in that target.
Health reports expected migrations and explicitly leaves its database check
`not_checked`. The separate native census supplies the actual schema finding.

## Reviewed import preserves the invalid skipped row

Root uploads the unchanged 256-byte retained CSV through the project importer.
Its SHA-256 is `b6c01c67c37506a56301c37301f0eb84d9d21dcacb415a4988c21f0e00e7e0a7`.
Root selects the worksheet and maps name, description, status, cost and source
location. The defaults are capital_program, programming, EUR, units and unknown
price year. Every row initially stays Skip. Root marks only row 2 Create and
reviews again. Approved preview hash is
`b8d13529a3267b9b733a3ec80181494615d44c4940e833866bf691da006d0508`.

The transaction creates project `f04b1fce-e36d-457f-9c96-15deff374966` and saves
two audit rows in batch `f50b49e2-f2af-474b-a3ca-cb8ea0610e26`. Row 3 remains
decision Skip, outcome invalid, literal status `invented-status` and no created
project. UI counts are Created 1, skipped 0, invalid 1. An invalid skipped row
belongs in the invalid outcome count; this does not imply it was created.
Both audit actors equal the copied owner who submits the review.

Native storage retains EUR 125000, null price year and the uploaded source
document reference. Location text creates no coordinates, place identity or
jurisdiction. There is one project with the imported name and none with the
invalid row's name. Re-preview identifies the created source row, locks it to
Skip and reports one created before. Root does not force a second commit through
the disabled completed-review control. This is repeat-review identity evidence,
not a fresh uncertain-commit recovery exercise.

The UI workbook download contains exactly the two projects in that workspace.
Its literal name `Synthetic UI import =1+1` remains a string, without a formula.
EUR 125000 and the empty price year survive. The separate
[workbook readback](workbook-artifact-readback.md) records emitted cells and
layout declarations. It does not prove Excel or native printing.

## Saved geography and declarations remain separate

Through the existing project forms, root saves synthetic site coordinates
`[-122.27, 37.8]` and uploads a 187-byte GeoJSON corridor with coordinates
`[[-122.27, 37.8], [-122.26, 37.81]]`. These are engineering fixtures, not a
surveyed site or route. The existing study area remains unchanged.

The saved map displays the area and marker. The UI lists one area, one point
and one corridor with zero unavailable or rejected core shapes. The downloaded
GeoPackage exactly preserves all 2,548 area coordinate positions in their ring
order, the point and the uploaded line. SQLite integrity and foreign-key checks
succeed. Five supplemental layers remain disclosed as unavailable with null
record counts. See the [geography readback](geography-artifact-readback.md).

Root then adds two explicitly synthetic staff declarations using the jurisdiction
editor: one sovereign context and one overlapping context. The UI keeps both
unverified and Not assessed here. It does not substitute Oakland's administrative
identity or declare adopting authority. This later declaration state differs
from the earlier GeoPackage and legacy-context JSON; those originals are retained.

## An ordinary report retains the declarations and their limits

Root creates report `0ba0720e-8a6b-4f1c-ac90-379ae161a9f1` through the report
wizard, attaches no modeling evidence and generates HTML. The downloaded
43,053 bytes exactly equal stored artifact
`b1c5b9d1-2249-4086-8bd3-5538e33d9c3a`'s HTML content.

Both declarations remain staff_declared. All ten readiness cells remain
unassessed, with no registered evidence. Canonical payload checksums and the
shipped registry hash match. The earlier declared-context JSON and report differ
in project revision and the corresponding checksum. Neither hash substitutes
for the other, and these artifacts do not establish what changed the revision.
The [report readback](report-artifact-readback.md) preserves those differences.
A later root native read confirms exact declaration entries, state and recorded
time match the report; external context omits the internal actor as intended.
The then-current project revision is later again, so revision equality is false.
An initial root comparator also reports target false by comparing a JSON OID
string with an integer. A separate typed readback matches the literal expected
OID string; the original false observation remains retained.

The emitted geography text still says jurisdiction can be re-derived from a
searched study place. This conflicts with the separate declaration boundary.
A bounded Sol-high correction is underway in its own checkout. This frozen f0
artifact continues to contain the old sentence. No claim transfers the upcoming
correction into this build. Full schema 420 cannot exercise the genuinely missing
jurisdiction-column fallback; that runtime branch remains unperformed here.

## Project membership governs the two reverse workspace contexts

Root signs in through the normal form as the copied viewer account. Native
membership readback confirms owner access in workspace
`c9fefd50-b380-4512-a686-4b860296f694` and viewer access in the retained transit
workspace. Root creates synthetic project
`55d8d52b-1216-447b-9ef9-e7fa95881b96` through the owner workspace's project wizard.

With the transit viewer workspace active, the owned project still exposes its
identity and jurisdiction editors. A summary edit saves, then root restores the
original text through the same form. With the owner workspace active, the
retained transit project hides identity and jurisdiction editors and explicitly
states that its map location is read-only. Root does not forge a hidden write
or label this UI result as live RLS acceptance. Delivery, funding and stage
write combinations are not individually exercised by these two checks.

## Desktop and narrow interactions do not establish raster acceptance

T3 creates owned incognito tab9 after the former tab is unavailable. It supports
normal navigation, forms, uploads and downloads. Desktop DOM measurements reach
1440 by 1000; narrow measurements reach 390 by 844 with document width 390.
The narrow saved-map canvas measures about 303 by 360 pixels. Available captured
console entries show no errors, and inspected network entries show no HTTP
failure. This is not a complete historical network or console census.

Viewport changes settle after the resize acknowledgement. Several immediate
measurements still show the preceding viewport and are not narrow evidence.
Snapshot metadata reports 1280 by 800; all nine retained PNG headers actually
measure 928 by 580. Saved images show distorted or duplicated page content. Those files remain retained. Root does not claim mobile visual,
accessibility or complete desktop screenshot acceptance. T3 remains the browser;
no alternate browser or fabricated replacement image is used.

Operator errors also remain visible in tool history: several waits name text
that the page does not render, some clicks use invalid selectors, a file upload
first targets the button role instead of the file input, and an open workspace
menu blocks clicks until root dismisses its backdrop. Corrected locators and
ordinary UI interactions continue. No build, stage mutator or service is retried.

## Protected-state checks complete; promotion stays on hold

The single post-journey check exits zero in 68.707 seconds. It reacquires all
eight protected helpers, five protected database fingerprints, original source
anchor, retained packets, Storage binding and the old web process through its
nonce observer. The new preview's intentional user writes are excluded from
old-data equality. Working result SHA-256 is
`579541c5078d5a1ca47fb6d0fbe396196f702433c8d3bab24cf3b87ef36e9950`.
The same web invocation remains active afterward, with 407,396,352 bytes peak,
zero swap and zero memory events at that observation. This preserves the original check's scope and does not resolve the separate,
cause-unknown native `pg_class` comparison.

The original services stage remains failed. Later active checks, build, archive,
startup and these interactions do not relabel that operation. No old helper,
proof database, source anchor, frozen packet, demo or canonical unrelated file
is changed. No credential rotation or hosted operation occurs. Candidate420
versus hosted418 remains a promotion hold. This report authorizes no new release.

Exact hashes and private proof references appear in [evidence.json](evidence.json).
The original preview archive preserves pre-start bytes, not later UI writes or a
tested recovery. No practicing planner, public participant, scientific engine,
native GIS or spreadsheet application supplies acceptance in this journey.
