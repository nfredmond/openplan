# V6 actual project downloads preserve geometry and jurisdiction boundaries

Independent artifact review, October 15, 2026. GPT-6.1 Sol, high reasoning.

**No P1 or P2 artifact finding in the three assigned pairs.** Native SQLite and
GeoPackage/WKB inspection finds identical area, point and line geometry across
the three exports. Each JSON matches its paired embedded canonical payload,
context, registry, revision and digest. Legacy, unresolved and corrected staff
declarations remain distinct. This finding covers these frozen files only.

## Identity and ownership

The clean assigned branch `t3/v6-project-geography-artifact-review` starts at
`05dd3e8da4a4572437f06e771b0a2477873e681f`. A local fast-forward advances it to
the authorized parent `864974054d187e92e2cd3ab5525c0ae545215d62`. Its `openplan/`
tree is `bdd3096b04212d944844c063fd33ad1fb4a2c957`, exactly matching APP49,
`49e3fa2004c1336ffa36c134a8f21bcc2d72d327`. This review changes only its assigned
documentation directory. New private proof stays at
`~/.local/state/openplan/v6-actual-project-geography-artifact-review-20261015/`.

The reviewer reads current AGENTS.md and coordination, the earlier
[artifact report](../2026-10-15-current-browser-download-artifact-review/README.md)
at `b61e316c6e5db0a87dde122e31c2a30887279955`, relevant
[source review](../2026-10-15-project-jurisdiction-correction-independent/REVIEW.md),
[native jurisdiction report](../2026-10-15-project-jurisdiction-native/REPORT.md)
and [map review](../2026-10-15-project-saved-map-correction-review/REVIEW.md).
Planner-writing and prove-it guide this report and its controls. Any-place
guidance informs the geography boundary; the fixed coordinates below identify
this assigned fixture, rather than a product default or coverage claim.

Parent remains the sole browser driver. The brief identifies BUILD_ID
`7X3x8RgohlUwVf_lPZa5r`, target OID `6150036`, and 420 migrations through
`20261017000017`. The reviewer reads the frozen strict-start attestation and
independently confirms its SHA-256
`1700d98c21249705d1eb6c355a2151799c9e05a4db8598144beff5abc49f1fb7`.
Its recorded app head is APP49; health reports `database=not_checked`.
Build ID and the browser collection sequence remain parent-attributed evidence.
This reviewer does not contact or reattest the running installation.

The frozen input directory is
`~/.local/state/openplan/v6-project-geography-downloads-20261015/`.
All eight input hashes, including inventory and retained failed trial, appear
in [evidence.json](evidence.json). File sizes and hashes match the inventory
before and after this review. No original file changes.

## The packages contain three exact saved shapes

Each package has eight registered feature layers and three attribute tables.
The three core geometry layers contain one feature each. Safety, engagement,
AequilibraE, ActivitySim and land-use tables are empty. Their layer-status rows
remain `unavailable` with null counts. They do not become zero observations.
The separate AequilibraE and ActivitySim tables carry no combined model claim.

Application ID is `0x47504b47`; user version is `10400`. Required tables,
11 content registrations, EPSG:4326 identity, 2D geometry registrations,
foreign keys, populated extents, manifest coverage and zero omitted corridors
agree. Integrity returns `ok` on writable in-memory backups of the read-only
originals. SQLite is `3.46.1`. Integrity is not inferred from a read-only or
`immutable=1` connection. The targeted CHECK-violation control fails specifically
at `sqlite: integrity`, addressing the prior report's demonstrated blind spot.

The area is a Polygon with one exterior ring and one hole. Stored closed-ring
vertex counts are 2,020 and 528, totaling 2,548. Its extent is
`[-122.355881,37.631714,-122.114793,37.885355]`. Every coordinate, ring and hole
remains identical across all three packages. Complete geometry-blob SHA-256 is
`e24c64d176c2a904a87fbad896bde8ce36cfaa3bde45761836ed1eb159505d52`,
also matching the earlier artifact report. This checks exported byte parity;
it does not independently compare a pre-edit application database snapshot.

The saved point is exactly `[-122.2711,37.8044]`. Its geometry-blob digest is
`1663a670e7d3da64f086c27d0ccdd7581a2d1fdf3d4f2fc5d5bb90260deb9949`.
The saved LineString retains the ordered coordinates
`[[-122.28,37.8],[-122.2711,37.8044],[-122.26,37.82]]`, with digest
`06ceb8ea7d96a99bd66441a993c9efa340cb7520f004bf7f021d36e767fc6f65`.
Its name is `Synthetic QA display line; not a model network`. The actual V6
stored type is `arterial`, and `los_grade` is null. The prior report's different
fixture type and comma in its name are not imposed on this new artifact.
These are cartographic records, with no measured service or scientific claim.

## Each pair preserves its own jurisdiction snapshot

All three JSON payloads use external handoff schema
`openplan.project-jurisdiction-readiness-export.v3`, registry version
`2026-10-11.1`, and registry digest
`531dca87cc6621786d4cff27b0fb52dd5b99105c3a78c6307a9a35322201c158`.
The reviewer also reconstructs that registry digest from APP49's parsed registry
using the pinned custody algorithm. Each payload digest is independently
recomputed over its canonical material without `payloadSha256`. The paired
GeoPackage contains the identical canonical JSON and context. Project identity,
revision, schema, registry and payload digest agree with both manifests. Project
and workspace lineage agree across pairs; public proof omits their values.

| Pair | Project revision, UTC | Artifact finding |
| --- | --- | --- |
| Legacy | `2026-10-15T16:14:55.35322+00:00` | Null context; labelled `legacy_study_place`; one historical assessment. Disclosure leaves adopting authority and legal applicability unresolved. |
| Explicit unresolved | `2026-10-15T16:15:41.710681+00:00` | Explicit unresolved declaration; no context entries or assessment entries. Legacy fallback stays disabled. |
| Corrected declarations | `2026-10-15T16:17:10.778243+00:00` | Two exact staff declarations, sovereign first and overlap second. Both retain unverified identity and unassessed support. |

The corrected declarations retain their synthetic labels, kinds and separate
staff references. Both carry `countryCode=US` and `subdivisionCode=US-CA` as
supplied descriptors, with `identity=staff_declared`. Neither becomes a resolved
jurisdiction. Both assessments have null authority identity, country,
subdivision and assessment kind. All ten reports remain `unassessed`, with no
authorities, adapters or sources. Administrative guidance remains null. No legal,
adoption or administrative authority follows from those supplied codes.

All three area rows retain Oakland/TIGERweb/city/`0653000`/US/CA study-place
properties. Those properties do not author a jurisdiction declaration. In
particular, they coexist with explicit unresolved context without restoring the
legacy assessment. The jurisdiction manifest stays a separate attribute record.
Registry review dates remain historical. This review does not refresh legal
sources or expand geographic coverage.

## The failed parent fixture remains excluded

`declared-jurisdictions.json`, SHA-256
`5a223505d4fb67b0eb12f40226f858fa8278b06abf8d7955c9cc4a23ed8b6ab7`,
is retained and hashed. Inspection confirms both entries use `sovereign` despite
the second label referring to overlap. It is not the corrected pair and has no
accepted matching package here.

The parent brief records a timed-out selection of `overlapping`, while the valid
option value is `overlap`, followed by an accidentally saved second sovereign
entry. Parent acknowledges that fixture error, removes/re-adds the second entry
and saves the corrected state through the UI. This reviewer verifies the frozen
before/corrected distinction, not that browser sequence. The retained wrong
selection is not classified as an application defect. A private-copy control
substituting that earlier JSON for the corrected input fails the exact
declaration check, rather than silently becoming a fourth accepted snapshot.

## Empty engagement and minimized account data have bounded evidence

Every actual package registers `engagement_geometry`, but contains zero rows.
No private or pending fixture engagement feature is therefore present in that
table. Its schema contains geometry lineage, source type, date and moderation
status; it has no comment text, submitter identity or moderation-note column.
The layer status says the publishable source was examined without supplying
qualifying geometry. File inspection confirms the empty output, not the source
query's completeness or the underlying moderation decisions.

APP49's route invokes the shared publishable-geometry loader. Source inspection
shows public campaign reachability, approved status and public/nonprivate
filtering before export. The reviewer does not execute that loader or repeat
its privacy campaign. The current file check cannot establish inclusion of an
eligible approved public feature, because none is present in these packages.

The probe checks readable SQLite values, schemas and original bytes, together
with the three good JSON files. No internal actor field or known synthetic
owner/viewer/outsider UUID, email, password or access token appears. Values are
read from the existing private fixture only in memory and never printed or
committed. This covers known fixture accounts, not universal anonymization or
unknown encodings. The failed parent JSON receives custody hashing and scope
inspection only; it is excluded from accepted-pair privacy and parity claims.

## New controls test the actual artifact checks

Run the bounded standalone checker with Python's standard library:

```bash
python3 -B docs/reviews/2026-10-15-v6-actual-project-geography-artifact-review/inspect_artifacts.py
```

One harmless JSON whitespace mutation survives the complete pair inspection.
Sixteen targeted faults fail their named diagnostics. They cover a stored CHECK
violation, missing manifest table, wrong SRS, omitted-corridor count, unavailable
count changed to zero, moved point with a matching changed extent, reversed line,
deleted area hole with unchanged exterior/extent, corrupted canonical checksum,
unresolved legacy substitution, wrong retained declaration, promoted staff
support, mismatched embedded JSON, wrong embedded revision, added submitter
column and a known fixture account value inserted into a manifest.

Semantic controls do not invoke the original-file pin gate. They fail at their
intended inspection category, rather than any changed-byte hash. The area check
deliberately uses the independently reported geometry digest, which detects a
lost hole even when the total extent remains unchanged. These controls exercise
the artifact detector; they do not mutate or prove application behavior.

Every trial restores private copies in `finally` and checks every restored hash
and size. The restored semantic baseline equals the original result. All frozen
original hashes remain unchanged afterward. Detailed outcomes and checker hash
are in [evidence.json](evidence.json). The earlier 23-fault workbook/artifact
campaign is not rerun. Private run 01 used a ring-order change; final run 02 uses
the more direct hole-loss fault. Both summaries are retained. There is no failed
application or checker execution in these two bounded runs.

## Limits and parent handoff

- Custody hashes identify bytes. They do not independently prove browser origin,
  runtime identity or collection honesty. Parent owns navigation, desktop/390px,
  console and build-attested journey evidence.
- SQLite/WKB checks cover these stored 2D shapes, exact coordinate order, rings,
  hole parity, registrations and metadata. They do not establish full OGC
  conformance, polygon topology, authoritative boundary accuracy, reprojection,
  spatial indexes or general GIS interoperability.
- Payload checks cover these exact revisions and registry representation. They
  do not validate real authority, adoption, legal applicability, source accuracy,
  current laws or nationwide readiness. Canonicalization is checked for this
  payload's keys and values, not arbitrary JavaScript values or Unicode keys.
- Privacy checks cover these empty engagement tables, omitted fields and known
  fixture accounts. They do not prove source moderation, arbitrary private text
  removal, approved-public inclusion, live RLS or future populated exports.
- No QGIS, Excel or other recipient application opens the files. Native GIS,
  workbook use, practitioner and public-participant acceptance remain unproved.
  Workbook artifacts are outside this assigned review.
- No source edit, test suite, product-direction command, build, service, live
  database, browser, hosted/cloud action, nested delegation, push, PR, merge or
  release occurs. The local fast-forward and documentation commit are the only
  Git mutations. No new deployment or product acceptance follows from this review.

The parent can use this bounded artifact finding alongside its separately owned
journey evidence. This report leaves all release and human acceptance boundaries
unchanged.
