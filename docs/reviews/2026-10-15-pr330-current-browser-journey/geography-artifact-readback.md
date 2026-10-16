# PR330 downloaded geography artifact readback

The downloaded GeoPackage contains one area, one site point, and one corridor in EPSG:4326. SQLite reports `integrity_check = ok` and no foreign-key violations. The point is exactly `[-122.27, 37.8]`. The corridor is exactly `[[-122.27, 37.8], [-122.26, 37.81]]`, matching the uploaded GeoJSON and the parent-supplied native storage. Its name is `Synthetic UI display corridor`.

The area exactly matches the type, ring order, and every coordinate number in the parent-supplied native source JSON. It is a nonempty Polygon with two closed rings and 2,548 coordinate positions. OGR/GEOS reports all three geometries valid. Area bounds are `[-122.355881, 37.631714, -122.114793, 37.885355]`. The native source file is 163,917 bytes with SHA-256 `d591005aa9e00705c7514b3f8110f315c1e148bfd5fcac02e23e57d94b896078`.

The eight-row layer-status manifest marks all three core layers included, each with one feature. No core layer is unavailable. The five supplemental feature tables are empty and disclosed as unavailable with null record counts. Their absence does not mean zero observations. `project_info` records zero omitted corridors.

The standalone jurisdiction JSON equals the GeoPackage's embedded readiness payload. Its canonical payload checksum recomputes exactly. `context` is null, `contextSource` is `legacy_study_place`, and the disclosure leaves adopting authority and legal applicability unresolved. The stored Oakland place label identifies study-place context. It does not declare jurisdiction. Readiness entries retain `reviewedAt = 2026-08-28` and `reviewBy = 2026-09-28`; this readback does not renew their review.

These downloads retain project revision `2026-10-16T03:12:29.403202+00:00`; the GeoPackage generation time is `2026-10-16T03:12:30.853Z`. The parent obtains the native source JSON after two later UI jurisdiction declarations. This review compares geometry alone against that later source. It does not claim the earlier downloaded null context remains current after those edits.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| GeoPackage | 139264 | `346a4840bb6de8c5c1b83b22020793938e5d676e18c5f76023a165e5289d95e5` |
| Jurisdiction JSON | 10483 | `16df13de92ef2d859443cdd396810b82cfd5712d3ffe04a6509a223254e51c52` |
| Uploaded corridor GeoJSON | 187 | `5876ca8916bec0ab8d68bee50ea409f0a8c1009c92a3f91ab925cab88b2c41aa` |

The payload checksum is `77281fcfa3d480f211d7f41936e9ade29a70b3cf51f9b7525709c30d433a551e`. `report.json` retains sanitized schema, count, coordinate, manifest, and checksum observations with input paths.

The parent supplies source `f0cbeddff5ae3fc37e0dd8b91c02601429d977a6`, app `a13c491da3ad3ba5b237ca5fa8802b236c4ef27b`, and BUILD_ID `Z9s8u410cuLfXdEF5aeoi`. This reviewer does not independently attest build or browser custody.

Inspection uses SQLite `mode=ro&immutable=1`, standard-library WKB decoding, and installed GDAL/OGR. No application guard or test suite runs. No source, database, service, browser, dependency, or provider changes occur. The only writes are this private report and its JSON companion. An initial report command had a Python syntax error before execution and wrote nothing.

Literal comparisons can expose wrong coordinates, wrong inspected counts, malformed WKB, or mismatched embedded JSON. They cannot inspect upstream records omitted before export. Geometry validity does not establish survey accuracy or legal boundary authority. This work does not establish QGIS, practitioner, mobile, rendered-map, scientific, hosted, release, nationwide, or whole-product acceptance.
