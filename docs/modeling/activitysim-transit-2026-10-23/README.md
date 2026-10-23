# Opt-in scheduled transit skims for ActivitySim

October 23, 2026. Development implementation and input plausibility only.
This work does not validate mode choice or reopen a consumed holdout.
It reads no TBI respondent choices and does not run either demand model.

## What the bundle now supports

`build_activitysim_input_bundle.py --transit-config CONFIG.json` adds scheduled
GTFS skims to an MTC bundle. Without that argument, the existing path stays
unchanged, including its zero transit matrices. The tests compare bytes against
base commit `e7e9cd1b43fa25e6ebf82572cc763a09435a2356`, with the existing manifest
clock held fixed, HDF5 dataset timestamps suppressed for both implementations,
and the same output path. Ordinary outputs retain their existing timestamps. They cover the starter bundle, full
MTC fixture bundle, and skim OMX.

The opt-in path writes a raw `skims/transit_skims.npz`, a
`metadata/transit.json` custody record, and the MTC OMX. The manifest registers
both new files and embeds the custody. Unavailable raw components are NaN, with
`AVAILABLE` and `USABLE` masks. A measured zero fare remains distinct from an
unknown fare. The stock OMX uses zero `TOTIVT` to disable alternatives, with the
reason preserved outside OMX. Missing files, mismatched hashes, no service on
the selected date, and unusable inputs produce `status: unavailable` and a
reason. A zone with no access remains listed by zone ID.

GTFS does not supply drive access, parking conditions, or every fare system.
Drive-transit remains unavailable unless the caller supplies sourced,
directional zone-to-stop connectors. Unknown fares disable the affected mode
alternatives even when timetable travel times exist. Generic accessibility
skims retain those travel times with their separate missing-fare disclosure.

## Method and library

The implementation uses a directed, time-expanded timetable graph and
[SciPy's Dijkstra implementation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.sparse.csgraph.dijkstra.html).
SciPy is already declared in both the modeling and ActivitySim execution
environments. This adds no library or paid service. The run uses CPython 3.11,
NumPy 1.25.2, and SciPy 1.16.3 from the existing ActivitySim environment.
The computation refuses other Python minor versions before importing NumPy.

Each trip has arrival and departure nodes. On-board edges include running time
and dwell. Platform timelines carry waiting; boarding and alighting edges retain
pickup/drop-off restrictions. Transfers use same-stop minimum times and explicit
`transfers.txt` edges, including prohibitions. A two-layer graph requires an
actual ride on the named primary mode. Other mode families permit local-bus
feeders. The generic transit family permits all supported modes. Each origin
gets an independent shortest-path calculation. The selected path minimizes
elapsed time, not generalized cost or fare.

The existing worker `gtfs_skim.py` uses pooled headways, half-headway waits, and
at most one same-stop transfer. It does not supply this adapter's dated,
scheduled components. AequilibraE's
[transit skimmer](https://www.aequilibrae.com/docs/python/v1.6.0/public_transport/transit_skimming.html)
supports frequency-based hyperpath skimming. This task instead uses timetable
paths to preserve missed connections and hand-checkable waits. It does not
compare, average, or rank AequilibraE and ActivitySim outputs.

Calendar selection follows the [GTFS reference](https://gtfs.org/documentation/schedule/reference/):
inclusive date range and weekday, then `calendar_dates` additions/removals.
Times above 24:00 stay on the selected service day. The record retains the agency
timezone, active service IDs, applied exceptions, feed information, feed URL,
SHA-256, service date, config, ordered zone IDs, and zone digest.

## Skim definitions and periods

Raw times use minutes, distance uses miles, and fare uses nominal USD.
Boardings and transfers are counts. The MTC adapter checks that the stock
`TRANSIT_SCALE_FACTOR` is 100, multiplies times and drive distance by 100,
converts dollars to cents, and leaves boardings unscaled.

- `TOTIVT` or generic `IVT`: running plus on-board dwell time.
- `KEYIVT`: time on the required primary mode, excluding ferry time.
- `FERRYIVT`: ferry running and dwell time.
- `IWAIT`, `XWAIT`, `WAIT`: initial, transfer, and total waiting.
- `BOARDS`, raw `TRANSFERS`: boardings and boardings minus one.
- Raw `WACC`, `WEGR`, `WAUX`: walk access, egress, and transfer walk.
  Generic MTC transit keeps these separate. Named mode-family MTC `WAUX`
  includes all three, matching the stock expressions.
- `DTIM`, `DDIST`: supplied drive-connector time and distance.
- `FAR`: a supported GTFS fare or explicit sourced fare policy.
- Raw `TOTAL`: elapsed door-to-door time, including access and egress.

The stock families are `WLK_{LOC,EXP,HVY,LRF,COM}_WLK`, their `DRV_*_WLK`
and `WLK_*_DRV` counterparts, and `WLK_TRN_WLK`. Standard GTFS bus, subway,
rail, tram, and ferry types map to these families. Type 3 buses enter LOC unless
an explicit route-family map says otherwise. That convention does not establish
that each bus service is local; express classification needs agency evidence.
Unknown extended route types require a supplied classification or refusal.

The configured MTC periods are EA 00:00–05:00, AM 05:00–09:00,
MD 09:00–14:00, PM 14:00–18:00, and EV 18:00–24:00. The caller supplies
one departure in each period. These are sampled-departure skims, not period
averages. The native inventory check reads the installed ActivitySim 1.5.1
example: 826 matrices, including 718 transit matrices, and 155 referenced base
names. The stock-file digest and independently expected fixture values appear
in [stock-inventory.json](evidence/stock-inventory.json).

## Running another region

Use the same ordered internal zone rows as the bundle. Coordinates are WGS84
longitude and latitude. Feed acquisition happens outside the builder so the
caller can retain and verify the exact archive. Copy [config.json](config.json)
and change the path, public source URL, terms URL, SHA-256, service date,
access assumptions, and departures. No Twin Cities identifier appears in the
routing code. The standalone path also accepts a zone CSV with `zone_id`,
`centroid_lon`, and `centroid_lat`.

```bash
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 \
  /path/to/cpython311-environment/bin/python -B \
  scripts/modeling/activitysim_transit_skims.py \
  --config transit.json --zones zone_attributes.csv --output transit-output
```

The bundle path adds the same config to the existing census/MTC command:

```bash
/path/to/cpython311-environment/bin/python -B \
  scripts/modeling/build_activitysim_input_bundle.py \
  --screening-run-dir SCREENING_RUN --output-dir ACTIVITYSIM_BUNDLE \
  --population census --config-package mtc --transit-config transit.json
```

An optional `drive_connectors` array contains `zone_id`, `stop_id`,
`direction` (`access` or `egress`), `minutes`, `miles`, and `source`.
The code does not derive these values from zone-to-zone highway skims or assume
that every stop has parking. Connector feasibility and parking costs still need
separate admission. `route_families` optionally maps feed route IDs to supported
families. The config itself travels with the output for review.

Fare support is deliberately bounded. A single unrestricted USD fare in
`fare_attributes.txt` supports transfer counts and duration. Multiple fares,
route/zone rules, and Fares v2 remain unknown. A caller may supply
`fare_policy: {"kind": "flat_per_boarding", "usd": 2.50, "source": "PUBLIC_SOURCE"}`
only where that policy describes the agency. The Twin Cities run supplies no
fare override. No estimated scalar enters the calculation.

## Limits that remain visible

- Walk access uses centroid-to-stop great-circle distance and a declared speed.
  It does not resolve bridges, barriers, sidewalks, or station entrances.
- The selected service day does not merge the previous day's late trips or the
  next day's early trips. Frequency-based, conditional pickup, timed/in-seat,
  and trip/route-specific transfer rules are refused.
- Transfer walking uses explicit feed links. The code does not invent nearby
  stop-to-stop connections when the feed omits them.
- Intrazonal transit remains unavailable. A centroid is not every resident's
  access point. The route-family choice set is narrower than arbitrary mixed
  rail/bus itineraries; local feeders are supported.
- Fares retain their supplied nominal dollar vintage. Cost-base-year alignment,
  fare products, parking, capacity, reliability, crowding, and pedestrian
  accessibility remain unverified for behavioral studies.
- This work does not admit the frozen TBI 2019 study. Its other multimodal,
  population, endpoint, and time-period requirements remain independent gates.
  See [PR #379](https://github.com/nfredmond/openplan/pull/379) and its preserved
  preregistration. No observed travel choices enter this work.

See [SOURCE.md](SOURCE.md), [RESULT.md](RESULT.md), and
[VERIFICATION.md](VERIFICATION.md) for the regional input and execution record.
