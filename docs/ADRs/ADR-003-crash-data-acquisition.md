# ADR-003: Crash Data Acquisition and Storage for the Safety Module

## Status
Accepted (2026-07-23)

## Context

Wave 8.1 introduces a Safety module. Its foundation is crash data, and the existing crash lane could
not supply any.

### The existing lane is broken in production, and aimed at a retired system

`src/lib/data-sources/crashes.ts` has three tiers: a local SWITRS CSV, the NHTSA FARS API, and an
area-based estimate.

1. **The SWITRS tier cannot run on Vercel.** `loadSwitrsRecordsForBbox()` reads
   `process.env.SWITRS_CSV_PATH` from the filesystem. That variable *is* set in Vercel production, but
   no CSV is committed and `next.config.ts` declares no `outputFileTracingIncludes`, so the read
   throws, the `catch {}` swallows it, and `fetchCrashPointFeaturesForBbox()` returns `[]`. OpenPlan
   has never displayed a real crash point in production.
2. **The FARS tier produces no geometry.** `fetchFars()` reads only `FATALS`, `PEDS`, and
   `BICYCLISTS` — never a coordinate — so it can contribute summary counts but zero map features. Its
   query years are hardcoded to `[2022, 2021, 2020]`.
3. **The estimate tier fabricates every field from bbox area.** It is disclosed (`isEstimatedSource()`
   flags it, and it carries an "area-based estimate" note), which is defensible for the Explore
   *scorecard*. It is not defensible as an input to a safety analysis.

Underneath all of that sits the decisive fact: **CHP shut down iSWITRS on 2025-01-08 and replaced it
with the California Crash Reporting System (CCRS).** SWITRS receives no new records. Every SWITRS
artifact — the CSV reader, the public mirrors, the ~76 regional ArcGIS republications surveyed during
this work — is frozen legacy data by construction. Automating SWITRS acquisition would have replaced a
fabrication problem with a silent staleness problem.

### What is actually available

Surveyed and probed directly:

| Channel | Verdict |
| --- | --- |
| **CCRS on data.ca.gov** | **Statewide, record-level, keyless, public domain, daily. Chosen.** |
| TIMS (UC Berkeley SafeTREC) | Canonical statewide *geocoded* SWITRS, but account-gated with no public API. Automating it would mean scripting a session against an HTML tool — brittle, and a materially different posture from querying something deliberately published for machine access. |
| Regional ArcGIS FeatureServers | Real and keyless (SACOG verified), but a patchwork of single-agency and one-off consultant uploads, and SWITRS-era, therefore frozen. |
| Caltrans open data / ArcGIS | No crash or collision layer published. Enumerated the full REST server and the 67-dataset DCAT catalog. |
| CA OTS, data.chhs.ca.gov | Aggregate rankings and 2002–2010 indicator tables only. No record-level data. |
| NHTSA FARS | National but fatal-only; retained as a secondary adapter, not a primary. |

CCRS is published with the CKAN DataStore enabled, which means `datastore_search_sql` accepts an
arbitrary read-only `SELECT` — so a bounding-box predicate executes server-side. Verified: no key, no
account; `license_title: "Other (Public Domain)"`, `rights: "No restrictions on public use"`;
`accrualPeriodicity: R/P1D`; per-year resources `Crashes_2016` … `Crashes_2026`; a Nevada County query
returns real records in roughly 0.2 s.

## Decision

**1. Adopt CCRS as the primary crash source, behind a pluggable adapter registry.**

`src/lib/safety/sources/` defines a `CrashSourceAdapter` contract and a resolver. This mirrors the
multi-state traffic-count adapters (WA/CO/OR) already in the repo: new coverage is a new descriptor,
not an edit to call sites. The legacy SWITRS reader is retained for self-hosted and historical use but
is labelled a discontinued source frozen at 2025-01-08.

**2. No estimate tier is reachable from the Safety module.**

The adapter contract admits only observed, geolocated crashes. Where nothing covers a study area the
resolver returns an explicit `out_of_coverage` result and the UI says so. The `safety_crashes` table
carries a `CHECK` restricting `source_id` to registered observed sources, so the database itself
refuses an estimate. The disclosed `fars-estimate` tier stays where it is — powering the Explore
scorecard — and is structurally unable to reach a safety analysis.

**3. Coverage is a first-class, persisted, rendered concept — including geocoding completeness.**

Roughly 22% of CCRS records carry no coordinates (verified: 311,311 of 400,614 for 2025). Those can
never satisfy a bounding-box predicate, so a map is always a subset of what was reported. Every ingest
records both `matchedTotal` and `geocodedTotal`, and the UI discloses the difference. Filtering by
`County Code` is the lossless way to obtain the true denominator, which is why the adapter accepts a
county code alongside the bbox.

**4. Severity is derived, and its limits are declared.**

CCRS `Crashes_*` has no KABCO column — only `NumberKilled` (typed TEXT) and `NumberInjured`. The
adapter therefore derives fatal / injury / PDO and declares
`severityCompleteness: "fatal_injury_only"`. **Suspected serious injury (KABCO A) is not derivable
from this table**, so no KSI figure may be presented until the
`InjuredWitnessPassengers_YYYY.ExtentOfInjuryCode` join lands. This is enforced by unit tests and by
`src/test/safety-claim-boundaries.test.ts`.

**5. Store numeric latitude/longitude with a GENERATED PostGIS column.**

The repo's convention is numeric lat/lng with geometry built at query time in RPCs
(`projects_location.sql:7`; `engagement_items_near_geometry`). That same RPC states the exit criterion
— *"revisit with a generated geometry column if a workspace ever accumulates tens of thousands"* — and
a county-decade crash extract is on the order of 10⁵ rows. So `safety_crashes` stores numeric
lat/lng as the source of truth plus:

```sql
geom geometry(Point, 4326) GENERATED ALWAYS AS
  (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)) STORED
```

with a GiST index. This also sidesteps a hard constraint: **supabase-js cannot write PostGIS values**
(the repo's only geometry write path is a one-row-per-call plpgsql function). With a generated column
the client writes plain numbers and Postgres derives the geometry.

**6. Acquisition is a background, resumable job — never a request-time fetch.**

CCRS holds roughly 400k crashes per year statewide; a county-scale pull is far beyond a single
serverless request. Ingestion writes a status row and pages, following the existing `vercel.json`
crons + `CRON_SECRET` pattern.

**7. Coverage is tested by overlap, not containment.**

The legacy `isCaliforniaBBox()` required the entire bbox to sit inside California, silently dropping
any study area crossing a state line — a real problem for Truckee, Tahoe, Yreka, and Needles.
`overlapsCalifornia()` replaces it.

## Consequences

**Positive.** The Safety module has a live, official, daily-refreshed, public-domain statewide source
with no key and no account. The pilot geography (Nevada County, `County Code = 29`) is covered. The
adapter contract generalizes to other states, and the honesty posture is enforced by the schema and by
tests rather than by convention.

**Negative / accepted.**

- Coverage outside California is fatal-only (FARS) or absent, and the UI must say so plainly.
- CCRS begins in 2016; longer trend analysis would need the frozen SWITRS archive as a separate,
  clearly-labelled historical source.
- No KSI until the injury-severity join lands, which constrains what SS4A framing the module can
  legitimately support in the interim.
- Dependence on data.ca.gov availability. A source outage surfaces as `source_unavailable`, an honest
  state — not as a fabricated fallback.

## References

- CCRS package: `https://data.ca.gov/api/3/action/package_show?id=ccrs`
- Legacy lane: `openplan/src/lib/data-sources/crashes.ts`
- Adapter contract: `openplan/src/lib/safety/sources/types.ts`
- Claim boundaries: `openplan/src/test/safety-claim-boundaries.test.ts`
- iSWITRS retirement: documented upstream in `agude/SWITRS-to-SQLite`
