# Twin Cities input custody

This is an input-only preparation for the seven-county development footprint
identified in the frozen TBI 2019 preregistration. It does not use respondent
locations, weights, trips, or choices. The 704 zones are the 2019 Census tract
internal points within Anoka, Carver, Dakota, Hennepin, Ramsey, Scott, and
Washington counties. They are an explicit preparation zone system, not a claim
that a completed seven-county highway bundle already exists.

## The transit archive represents 2019

- Publisher: Metro Transit / Metropolitan Council.
- Feed: [GTFS20191005.zip](https://svc.metrotransit.org/mtgtfs/archive/GTFS20191005.zip).
- Archive listing: <https://svc.metrotransit.org/mtgtfs/archive/>.
- Selected service day: Tuesday, October 8, 2019. The archive's calendars include
  that day. It is a declared weekday plausibility sample, not a reconstruction
  of every TBI 2018–2019 survey date.
- SHA-256: `74f51981c4861a427caa06fcbf47cf5238733a8ae5ef123a03f1ebce9e59b020`.
- Acquisition: October 23, 2026, public HTTPS download, no credentials or fee.
- Feed version: dated archive name and exact SHA-256. No `feed_info.txt` exists.
- Calendar basis: `calendar.txt` plus `calendar_dates.txt`; local agency timezone
  America/Chicago. The run retains the exact active service IDs and exceptions.
- Terms: the archive includes [notice.rtf](evidence/notice.rtf). It identifies
  the Minnesota Government Data Practices Act as the release basis, disclaims
  warranties and accuracy, and requires redistribution with the disclaimer.
  The original notice bytes travel with this record.
- Coverage: [the feed README](evidence/feed-readme.txt) states that the archive
  excludes Minnesota Valley Transit Authority service. The presence of MVTA in
  `agency.txt` is not proof of operating trips. This run does not add another
  feed or treat absent coverage as a complete regional transit system.
- The archive contains no fare tables. The run supplies no inferred fare,
  flat-fare override, route-family overrides, or drive connectors.

The publisher's [landing page](https://svc.metrotransit.org/) says archives begin
in November 2020. Its linked directory exposes older files, and the 2019 archive
above downloaded and parsed successfully. The archive contents, not the landing
page's starting-date sentence, establish this run's feed vintage. This is not a
current feed relabeled as 2019.

## Zone points represent the same year

Source: [2019 national Census tract Gazetteer](https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2019_Gazetteer/2019_Gaz_tracts_national.zip).
The download is a free public federal dataset. The source uses the 2019 tract
vintage. `INTPTLONG` and `INTPTLAT` supply zone points, not geometric centroids
recomputed from polygons. Tracts sort by GEOID, then receive zone IDs 1–704.
The source archive hash, the extracted CSV hash, and county counts appear in
[source-custody.json](evidence/source-custody.json).

These points retain the bundle column names `centroid_lon` and `centroid_lat`
for compatibility. Their interpretation remains Census internal points. The
configured 800-meter radius and 1.34-meter-per-second walk speed are declared
screening assumptions, not measured access paths. The code uses the full feed
network, including trips outside the selected counties; it does not clip transit
paths to county boundaries.

## Reproduce acquisition and zone selection

[prepare-sources.py](evidence/prepare-sources.py) verifies retained input hashes,
recreates the zone CSV from the already downloaded Gazetteer, and verifies the
committed zone bytes. Download the two public archives to
`data/_screening_cache/activitysim-transit-2019/` first. It does not query TBI or
fetch any observed outcomes. The committed config uses relative local paths so
another checkout can reproduce the run.
