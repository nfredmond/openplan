# 2026-03-22 — Placer proof claim boundary

## Topic
Claim boundary for the accepted first runnable **proof-only** Placer County AequilibraE assignment checkpoint.

## Exact artifact/package/run being referenced
- Working directory: `openplan/data/pilot-placer-county/`
- Package: `openplan/data/pilot-placer-county/package/`
- Run outputs:
  - `openplan/data/pilot-placer-county/run_output/demand.omx`
  - `openplan/data/pilot-placer-county/run_output/travel_time_skims.omx`
  - `openplan/data/pilot-placer-county/run_output/link_volumes.csv`
  - `openplan/data/pilot-placer-county/run_output/evidence_packet.json`
- Scripts used to produce the checkpoint:
  - `openplan/data/pilot-placer-county/build_network_package.py`
  - `openplan/data/pilot-placer-county/build_trip_tables.py`
  - `openplan/data/pilot-placer-county/step1_osm.py`
  - `openplan/data/pilot-placer-county/step2_assign.py`

## Accepted safe claim
OpenPlan can produce a first runnable **proof-only**, tract-based Placer County AequilibraE assignment under explicit screening assumptions.

## What this proof does establish
This checkpoint establishes that the current Placer pilot pipeline can:
- build a tract-based Placer County screening package,
- construct a routable AequilibraE graph for the county,
- connect all modeled tract centroids into the drivable network,
- generate finite skim outputs,
- route the full current proof demand matrix, and
- export a first evidence packet plus link-load outputs.

Observed proof facts from the accepted local run:
- zones: `92`
- centroids reachable: `92/92`
- reachable OD pairs: `8,372 / 8,372`
- total trips: `247,512`
- routable trips: `247,512`
- final relative gap: `0.007612708357883145`
- assignment iterations: `50`
- loaded links: `21,645`
- average skimmed travel time: `33.5` minutes
- maximum skimmed travel time: `126.3` minutes

## What this proof does NOT establish
This checkpoint does **not** establish:
- calibrated assignment validity,
- observed-count validation quality,
- production-ready forecasting quality,
- behavioral realism,
- client-safe congestion or volume prediction quality,
- external-station / county-edge demand treatment adequacy,
- a validated long-run zone system for mixed urban-rural analysis.

## Screening vs assignment vs behavioral
### Screening
The proof is explicitly screening-grade in the following senses:
- tract-level geography,
- LODES-derived demand approximation,
- screening road-class default speeds/capacities,
- closed-boundary assumptions,
- pilot evidence artifacts.

### Assignment
The proof does establish a runnable assignment lane:
- graph build,
- centroid connectors,
- skim export,
- link-loading export,
- evidence packet creation.

### Behavioral
No behavioral-model claim is earned here.
This checkpoint should **not** be described as ActivitySim-ready, behaviorally validated, or behaviorally calibrated demand.

## Explicit caveats
Current caveats that must travel with this proof:
- `Uncalibrated`
- `OSM default speeds/capacities` / screening-grade defaults posture
- `Closed boundary`
- `Screening-grade`
- `In-memory centroid/connectors (DB left unchanged)`

## Known composition caveat to state explicitly
The accepted proof checkpoint combines:
- an **OpenStreetMap** assignment network built by `step1_osm.py`, and
- pilot package inputs whose manifest reflects **TIGER/Line 2023** package-generation lineage.

That means the current proof is a mixed-source screening/assignment checkpoint.
The `run_output/evidence_packet.json` is correctly describing the assignment-network side of the run when it reports:
- `network_source: "OpenStreetMap"`

The preservation requirement is therefore **not** to overwrite that field blindly, but to keep the cross-source composition explicit whenever the package manifest and assignment evidence packet are read together.

## Client-safe internal language
Safe phrasing:
- "We now have a first runnable proof-only, tract-based Placer County AequilibraE assignment under explicit screening assumptions."
- "This is a screening/assignment proof, not a calibrated forecast."
- "This checkpoint demonstrates pipeline runnability, not validated assignment accuracy."

Unsafe phrasing:
- "Placer County model is validated"
- "Placer County is calibrated"
- "OpenPlan now has production forecasting for Placer"
- "This is behaviorally realistic demand"

## Truth gate for future use
Before expanding claims beyond the accepted safe claim, require at minimum:
- explicit mixed-source documentation that keeps OSM assignment lineage and TIGER/Line package lineage unblurred,
- preserved proof code on a clean branch,
- repeatable rerun from that clean branch,
- observed-count validation inputs,
- explicit calibration work and a calibration memo.

## Bottom line
This is a strong and useful **screening / assignment proof checkpoint**.
It is worth preserving.
It is not yet a calibration claim, and it is not a behavioral-model claim.
