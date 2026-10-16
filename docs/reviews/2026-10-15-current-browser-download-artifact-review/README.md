# Frozen browser downloads retain geometry and distinct jurisdiction states

Review date: October 15, 2026. Independent artifact review.

No confirmed artifact defect remains within this review's bounded checks. Three
matching JSON/GeoPackage pairs retain their respective jurisdiction states. All
three retain identical geometry bytes. The portfolio workbook retains the
unresolved snapshot's project lineage and its declared import limits. This
finding does not establish workbook import success or native application use.

## Identity and custody

The reviewed app identity is
`21510042e94bcaf80f262205ad156a7bb639e35c`, version `0.68.0`, build
`u1jUSo57HKk72eLd1Qv43`. The frozen browser identity reports health prefix
`21510042e94b`, 419 expected migrations and latest `20261017000016`.
Database health is `not_checked`. The collection brief and frozen
`frontdoor-evidence.json` supply the full commit and build identity. This reviewer
reads those records without contacting or independently reattesting the runtime.
Their exact hashes appear in [evidence.json](evidence.json).

Root owns browser collection, authenticated navigation, desktop/390px evidence
and current integration. This reviewer owns only this new report directory and
the new private review directory. Review starts from clean checkout
`05dd3e8da4a4572437f06e771b0a2477873e681f`, branch
`t3/browser-download-artifact-review`. Root's integration checkout already differs
from the served app commit. Source context therefore uses `git show` at the exact
app commit, not the integration checkout's current files.

The original downloads remain under
`~/.local/state/openplan/current-project-preview-browser-fallback-20261015/downloads/`.
Before/after hashes and sizes match for all seven files. Fault controls modify
private copies only, then restore every copy to its original hash. No source,
dependency, cache, service, network, browser, provider or application database
operation forms part of this review. No direction check, build, full suite,
pagination campaign, PR or push runs.

| Frozen file | Bytes | SHA-256 |
| --- | ---: | --- |
| `legacy-jurisdiction-three-shapes.gpkg` | 139264 | `8d22afe023086ad2b61dc0983913093af52e9a18e9b9a8667018b88d16e69ae6` |
| `legacy-jurisdiction.json` | 10483 | `596ba6935c137ec15af31737ea7d74bc366fb2780a5dad1b69e5ca943983b89e` |
| `unresolved-three-shapes.gpkg` | 131072 | `00558cd03fe652e2034fb4310b4ca9b48528aaf18dee196b7e0b4d702f144d28` |
| `unresolved-jurisdiction.json` | 888 | `6da53cccf07f1e948da53a515edf73a0ff3e724ea9820348efb5e88b6b98825e` |
| `unresolved-portfolio.xlsx` | 10756 | `72c9837fe7dd89607a5c5b95eb9ae092c529db28007302b573e4b86cd42dec4e` |
| `two-unverified-jurisdictions-three-shapes.gpkg` | 143360 | `06a135d2ef54fb1f56cb4466060a5395ee67fff34fa608b71745b9d967f467c1` |
| `two-unverified-jurisdictions.json` | 14184 | `ee22c88f2660bde4c49a663560194991ad088a8ab9cf63e490c485feaa5b66bf` |

## Three GeoPackages retain the same area, point and line

Each GeoPackage contains three geometry features, one each in `project_area`,
`project_location` and `project_corridors`. Five other registered feature layers
are empty. Eight geometry registrations use EPSG:4326, with no Z or M dimension.
Application ID is `0x47504b47`; user version is `10400`. All 11 content entries,
feature registrations, foreign keys, geometry types and populated extents agree
with the decoded data. SQLite integrity returns `ok` on each in-memory backup.

The parser reads GeoPackage binary headers and the complete WKB payload. It
checks coordinate ranges, finite values, polygon ring closure and trailing
bytes. The area is a Polygon with 2,548 stored vertices, including ring closure
vertices. Its extent is `[-122.355881, 37.631714, -122.114793, 37.885355]`.
Its complete geometry blob has SHA-256
`e24c64d176c2a904a87fbad896bde8ce36cfaa3bde45761836ed1eb159505d52`
in all three files. This proves parity across these exports. The collector's
statement that the preexisting area remains untouched is not an independently
checked pre-edit database comparison.

The point is exactly `[-122.2711, 37.8044]`. The LineString preserves this vertex
order:

```json
[[-122.28,37.8],[-122.2711,37.8044],[-122.26,37.82]]
```

The corridor name remains `Synthetic QA display line, not a model network`, its
type is `custom`, and its level-of-service grade is null. Geometry is synthetic
engineering evidence. It supports no traffic model, measured service, scientific
accuracy or adopting-authority claim.

`openplan_layer_status` records the three included layers with one record each.
Crash/KSI, AequilibraE links, ActivitySim links, engagement geometry and land-use
designations remain `unavailable` with null record counts. Their empty tables do
not become numeric zero findings. The model tables remain separate.

## Matching pairs preserve three different jurisdiction states

The reviewer compares each JSON file with its matching GeoPackage only. Each
GeoPackage stores the exact canonical serialization of its JSON payload and
context. Project identity, revision, registry identity, export schema and payload
hash agree within each pair. Recomputed SHA-256 values exclude the
`payloadSha256` field itself, following the pinned canonicalizer for these
payloads. All use external-handoff schema
`openplan.project-jurisdiction-readiness-export.v3`, registry version
`2026-10-11.1` and registry hash
`531dca87cc6621786d4cff27b0fb52dd5b99105c3a78c6307a9a35322201c158`.

| State | Project revision, UTC | Finding |
| --- | --- | --- |
| Pre-clear legacy | `2026-10-15T13:16:01.112469+00:00` | Null declaration context; `legacy_study_place`; one legacy assessment entry with no declaration or administrative guidance. Disclosure explicitly leaves adopting authority and legal applicability unresolved. |
| Explicit unresolved | `2026-10-15T13:20:12.214511+00:00` | `project_declaration`; `state=unresolved`; no context entries and no readiness entries. No legacy fallback appears. |
| Two staff declarations | `2026-10-15T13:24:43.736076+00:00` | `project_declaration`; `state=declared`; two entries with scopes `overlap` and `sovereign`. Both remain `staff_declared`, with no administrative guidance. Every readiness report remains `unassessed`. |

The two declarations retain the supplied synthetic labels, US country value,
null subdivision, engineering-fixture kind and separate QA references. Each
assessment repeats the corresponding declaration. Neither resolves an authority
identity or assessment kind. The legacy assessment remains historical to its
own snapshot. It is not evidence of a fallback in either later pair.

## Account identity stays out of the downloaded content

The probe scans original bytes, SQLite schema and text values, and every
decompressed workbook member. It finds no `created_by` or `recordedBy` field.
It also checks the known synthetic owner, viewer and outsider account UUIDs,
emails, passwords and access tokens against those contents. No known account
value appears. Private fixture values stay in memory and never enter this report
or its evidence JSON.

Project, workspace and corridor identifiers remain intentional export lineage.
They are not account identity, and this public report omits their values.
The privacy result covers the known fixture accounts and inspected content. It
does not establish anonymity against unknown identities, arbitrary encodings or
future populated export fields.

## The workbook preserves literal values and its unresolved snapshot lineage

The ZIP has 11 unique members. CRC checks and XML parsing succeed. `Projects`
uses `A1:S2`, with the exact 19-column contract and one project row. `Read me`
uses `A1:B24`. Worksheet relationship targets agree with the workbook's sheet
IDs. All 84 stored cells use string literals. No formula, external relationship,
external-link element or macro part appears in this file's member set.

The project and workspace identifiers match the unresolved GeoPackage. Project
name, summary, plan type, status, delivery phase, creation timestamp and revision
match that snapshot. Generated time is `2026-10-15T13:20:56.953Z`, before the
later two-declaration snapshot. The workbook intentionally does not carry a
jurisdiction declaration column. The retained Oakland place text describes the
study place, not a restored jurisdiction authority. Place reference `0653000`
remains text with its leading zero. Cost, currency, price year, cost-source
document and cost-recorded timestamp remain blank, rather than numeric zero.

The `Read me` sheet declares create-only import, every row starting at Skip,
explicit review, no boundary or map point creation from source-location text,
reference-only place identity/cost provenance/timestamps, and literal values
without formula recalculation. Mapping instructions match the first 10 contract
columns. These are inspected file declarations. They do not prove the importer
enforces them. Root reports an actual import UI `409` under separate correction;
this review claims no successful workbook import.

## Controls demonstrate the probe can detect faults

Run the bounded probe from the review checkout:

```bash
python3 -B docs/reviews/2026-10-15-current-browser-download-artifact-review/inspect_downloads.py
```

The probe uses Python's standard library and the explicitly named private
fixture. It writes only to the assigned private review directory. One harmless
JSON-whitespace mutation survives the complete inspection. All 23 targeted
faults fail for the intended category, rather than a pinned-file hash mismatch:

- Canonical checksum corruption, unresolved-to-legacy substitution and a promoted staff declaration.
- SQLite CHECK-constraint corruption, wrong application ID, wrong SRS and wrong registered extent.
- Reversed point coordinate order, reversed line vertices and one changed area coordinate.
- JSON/GeoPackage payload disagreement and unavailable counts changed to zero.
- An internal actor field, a known account UUID and a known account email.
- ZIP CRC corruption, a shifted worksheet target and an external relationship.
- An injected formula, numeric cell substitution, changed header, changed project revision and removed import warning.

[evidence.json](evidence.json) names every control and its exact diagnostic.
All copied files return to their pinned bytes, the restored baseline agrees,
and all original hashes and sizes match afterward. The public probe hash and
the source-context hashes bind the recorded inspection.

The harness retains its corrections. An exploratory reader initially assumed a
non-null legacy context. The first ZIP-count assertion expected 12 rather than
the enumerated 11 members. A cell mutation initially assumed a different XML
attribute order and refused to run. These are review-harness failures, not
artifact defects.

The integrity fault control also exposes a material checker limit. Installed
SQLite `3.46.1` reports `ok` for the copied CHECK-constraint violation when opened
with `immutable=1` or `mode=ro`. Opening that private copy normally detects the
violation. The final probe keeps originals read-only, backs each into a memory
database and checks integrity there. The same mutant now fails specifically at
`sqlite: integrity`. The earlier survivor is not counted as an integrity pass.
Private `harness-history.json` retains the correction record.

## Boundaries remain explicit

- Hashes establish exact-byte custody, not trustworthy collection by themselves. Browser origin and app identity remain attributed to root's frozen records and brief.
- Geometry checks cover these stored 2D features, metadata and coordinate order. They do not validate complete OGC conformance, polygon topology, authoritative boundary accuracy, reprojection, spatial indexing or general GIS interoperability.
- Jurisdiction checks establish state, canonical parity and claim restraint in these three pairs. They do not assess real legal applicability, registry source accuracy, responsible adoption or every geography.
- Privacy checks cover named fields, known fixture accounts and readable original content. They do not prove universal anonymization.
- Workbook checks establish ZIP/XML structure, this export contract, literal types, lineage and stated limits. They do not perform full OOXML XSD validation, cost precision checks on populated financial rows, formula-input adversarial round trips or large-portfolio pagination.
- No QGIS or Excel session opens these files. Parser results do not establish native visual acceptance, layout, printing, round-trip import or usability.
- Root retains desktop/390px, console, navigation and actual import evidence. No practitioner, public-participant, hosted, scientific or complete product acceptance follows from this report.

Private proof remains at
`~/.local/state/openplan/current-browser-download-artifact-review-20261015/`.
This packet is a local report checkpoint only.
