# Rotated native raster spacing

The existing parser computes transformed pixel spacing from only the two
diagonal matrix entries. A quarter-turn therefore reports zero spacing despite
nonzero raster cell vectors. Rotation and shear understate the declared lengths.
Five byte-built TIFF cases reproduce four failures before correction; the
axis-aligned case already passes.

The correction uses the lengths of the full two-dimensional column and row
vectors. This follows the raster-to-model matrix in
[OGC GeoTIFF 1.1, section 7.3.3](https://docs.ogc.org/is/19-008r4/19-008r4.html).
The vector-length calculation is a mathematical inference from that matrix.
The scalar metre accessor continues to report native column spacing only when
the declared coordinate system uses metre units. It does not establish ground
distance, survey accuracy or imagery quality. No country or place is hardcoded.

The change preserves native extents, reprojection, requests, engine settings,
callbacks and stored historical artifacts. Full M3/M5b.2/v1 acceptance stays open.

## Controlled arithmetic checks

Python 3.14 and 3.11 each pass six TIFF cases, four positive cohorts,
six targeted faults and 48 failure-oracle controls. The harmless comment
survives. Each fault reaches its named assertion; source restores in finally.

GDAL 3.12.2 creates six actual GeoTIFFs. Independently decoded pixel positions
agree with the parser vectors. Native controls pass four positive cohorts,
six intended faults and 48 failure-oracle controls. Their successful service
uses a 128 MiB memory cap, zero swap and about 40.5 MiB observed peak.
The first native-control trial does not catch its axis-aligned matrix mutation.
GDAL writes that fixture with scale/tiepoint tags. The retained failed trial
remains evidence; the corrected fault challenges the actual scale branch.
The portable TIFF test separately challenges an axis-aligned matrix tag.

These synthetic checks establish tag interpretation and native vector arithmetic.
They do not establish coordinate-system correctness, physical pixel resolution,
survey accuracy, aircraft operation, useful rendering or planner acceptance.
The retained native fixtures use one declared metre CRS. No geographic or
scientific capability grade changes. All 37 aerial worker suites pass 846 cases under Python 3.14. This unit
regression does not establish live database behavior. Twenty documentation
cases pass from the actual nested application package. GitHub CI remains pending.

Private proof base:
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-rotated-pixel-spacing-20261014/`.
Public JSON records retain source bindings and exact failure categories.
