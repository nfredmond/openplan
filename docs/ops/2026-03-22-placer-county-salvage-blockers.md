# 2026-03-22 — Placer County assignment salvage blockers

> Historical note: this memo captures the **pre-proof blocker posture** before the first accepted local Placer proof run completed. For the accepted safe claim and current truth boundary, use `2026-03-22-placer-proof-claim-boundary.md` alongside this memo.

## Topic
Placer County pilot salvage for the AequilibraE screening-assignment lane.

## Exact artifact/package/run being referenced
- Working package: `openplan/data/pilot-placer-county/package/`
- Current scripts under salvage:  
  - `openplan/data/pilot-placer-county/build_network_package.py`  
  - `openplan/data/pilot-placer-county/build_trip_tables.py`  
  - `openplan/data/pilot-placer-county/step1_osm.py`  
  - `openplan/data/pilot-placer-county/step2_assign.py`
- Current package facts observed on 2026-03-22:
  - package name: `placer-county-accessibility-v1`
  - geography: Placer County, CA (`06061`)
  - zone count: `92`
  - package population estimate: `414,956`
  - package jobs estimate: `173,129`
  - OD matrix shape: `92 x 92`
  - OD total trips: `247,512`
  - raw network after Step 1: `89,708` nodes / `108,124` links

## What is screening vs assignment vs behavioral
- **Screening**
  - tract-level package generation
  - LODES-derived tract demand with expansion assumptions
  - default road-class speeds/capacities
  - package/evidence artifacts
- **Assignment**
  - AequilibraE graph build
  - centroid connectors
  - skims and link loading
  - evidence packet for a first runnable proof
- **Behavioral**
  - none of this Placer work is behavioral modeling today
  - no ActivitySim or calibrated behavioral demand claim is earned by this lane

## Current status
What is already true:
- Step 1 network build is reproducible enough to regenerate the Placer AequilibraE project.
- The package build is producing a coherent 92-zone tract system with tract-level jobs/population fields.
- The current Step 2 salvage path has already improved centroid coverage enough to target a full-zone runnable proof.

What is not yet true:
- We do **not** yet have a clean, repeatable, first successful Placer assignment export.
- We do **not** yet have a trustworthy Placer evidence packet proving a complete assignment run.
- We do **not** have any calibration or observed-count validation basis for Placer.

---

## Blocker inventory

### 1) Network acquisition / cleaning
**Status:** partially solved  
**Classification:** `can solve now`

Observed condition:
- The network package exists and Step 1 can rebuild the AequilibraE project.
- Raw link types are heavily dominated by local road classes (`residential`, `service`, `tertiary`, `secondary`, etc.).
- Earlier Placer runs exposed that many imported links lacked reliable drivable defaults for mode/speed/capacity, which broke assignment setup.

Why it matters:
- AequilibraE needs consistent drivable link attributes for a first runnable proof.
- If local roads lose car mode or numeric defaults, the graph becomes effectively freeway/trunk-only and the skim/assignment outputs become unusable.

Current blocker detail:
- The in-memory Step 2 salvage still fails before assignment export because lane/default filling logic is not yet stable.
- Specific current implementation break: `step2_assign.py` is using `fillna(np.where(...))` on `lanes_ba`, which is a pandas-shape/type mismatch rather than a modeling truth issue.

### 2) Zone system
**Status:** usable for proof, not yet defended for production  
**Classification:** `needs assumption`

Observed condition:
- Current Placer package uses `92` tract zones.
- This is a mixed urban-rural county, so tract size heterogeneity is materially larger than in the Nevada pilot.

Why it matters:
- Large rural tracts and more urbanized western Placer tracts will create uneven centroid-to-network behavior and coarse intrazonal representation.

Current blocker detail:
- The tract system is acceptable for a first proof-only run.
- It is **not** yet a defended long-run zone system for comparative planning claims.

### 3) LODES demand generation
**Status:** runnable but assumption-heavy  
**Classification:** `needs assumption`

Observed condition:
- `build_trip_tables.py` scales tract population to roughly `415k`.
- It uses LODES workplace/OD data and expands work-trip flows by `4.0` to approximate all-purpose daily trips.
- The package currently has population/jobs fields but no household field in `zone_attributes.csv`.

Why it matters:
- This is enough for screening-grade assignment proof, but not enough for stronger travel-behavior claims.
- Closed-boundary tract OD approximation will distort commute sheds and external interaction for Placer.

Current blocker detail:
- Demand is good enough for a first runnable assignment proof if labeled honestly.
- Demand is **not** behaviorally grounded or externally validated.

### 4) Centroid connectors
**Status:** principal implementation blocker  
**Classification:** `can solve now`

Observed condition:
- Earlier salvage attempts got to the point where all 92 centroids could be made reachable.
- The original SQL-side renumbering/connector path proved brittle and unsafe across reruns.
- The latest salvage path correctly pivots to in-memory connector construction, but the implementation still breaks before the first clean assignment export.

Why it matters:
- Without stable centroid connectors, there is no defensible skim or assignment run.

Current blocker detail:
- Need a stable, repeatable in-memory connector/default-fill path.
- Need to ensure connectors attach to the largest drivable component and survive graph preparation without dead-end pruning surprises.

### 5) Parameter assumptions
**Status:** acceptable for proof-only, not yet defended  
**Classification:** `needs assumption`

Current assumptions in play:
- screening-grade road-class speed defaults
- screening-grade capacity defaults
- LODES work trips × `4.0`
- tract centroids as loading nodes
- closed county boundary

Why it matters:
- These assumptions are acceptable for a first runnable proof if clearly disclosed.
- They are not acceptable for calibrated forecasting claims without additional evidence.

### 6) Assignment convergence risks
**Status:** open  
**Classification:** `can solve now` for first proof, `needs calibration later` for stronger use

Observed condition:
- Previous failures were dominated by graph-preparation defects, null capacities, centroid pruning, and renumbering corruption.
- Convergence itself has not yet been the main unresolved methodological issue because the Placer lane has not completed a clean final run.

Why it matters:
- First proof requires a completed run with finite skims, routable trips, link loads, and an evidence packet.
- Later use requires demonstrating that convergence behavior is not just numerically complete but also methodologically defensible.

### 7) Validation / evidence gaps
**Status:** still open  
**Classification:** `needs external data` and `needs calibration later`

Observed condition:
- There is no observed-count validation package yet for Placer.
- There is no client-safe calibration summary yet.
- There is no defended external station treatment or county-edge demand treatment yet.

Why it matters:
- Even after the first runnable proof, we still cannot claim calibrated assignment validity for Placer.

---

## Blocker classification summary

### Can solve now
- in-memory lane/default fill bug in `step2_assign.py`
- stable in-memory centroid connector build
- graph preparation with drivable component protection
- first successful skim + assignment + evidence export

### Needs assumption
- tract zone system as temporary proof geometry
- screening-grade speed/capacity defaults
- LODES work trips × 4.0 all-purpose expansion
- closed-boundary demand treatment

### Needs external data
- observed traffic counts
- external station / county-edge demand treatment inputs
- better household/population control data if we want stronger demand credibility

### Needs calibration later
- VDF / capacity realism
- connector sensitivity checks
- observed-count validation
- claim boundary tightening for client-safe use

---

## Shortest-path plan
Goal: get to the **first runnable Placer assignment** as fast as possible while keeping the claim boundary explicit.

### Step 1 — fix the current implementation break
- Repair `step2_assign.py` so lane defaults are filled in a pandas-safe way.
- Replace `fillna(np.where(...))` patterns with deterministic masked assignment or `Series.where(...)` logic.
- Keep the graph build fully **in memory**; do not return to SQL-side node renumbering.

### Step 2 — freeze proof-grade graph rules
- Keep connectors attached to the largest drivable component.
- Keep dead-end pruning disabled for centroid preparation in the proof lane if needed.
- Retain explicit screening defaults for local road classes.

### Step 3 — get a first complete export
Produce, at minimum:
- `travel_time_skims.omx`
- `demand.omx`
- `link_volumes.csv`
- `evidence_packet.json`

### Step 4 — write the claim-boundary memo immediately after the run
Once the first runnable proof exists, record:
- what completed successfully
- what assumptions were used
- what the evidence packet actually proves
- what still remains outside the claim boundary

### Step 5 — only then discuss calibration expansion
Do **not** jump straight from runnable proof to production modeling claims.
Calibration, count validation, and boundary treatment come after the first honest runnable proof.

---

## Truth gate

### What we can honestly claim after the first runnable Placer run
- OpenPlan can generate a **screening-grade, tract-based, proof-only AequilibraE assignment run** for Placer County.
- The run uses:
  - an OpenStreetMap assignment network built by `step1_osm.py`
  - tract centroids
  - LODES-derived tract demand from the preserved pilot package
  - explicit screening defaults for link attributes
- The resulting evidence packet would prove that the pipeline is runnable for a larger mixed urban-rural county.

### What we still cannot claim after that first run
- calibrated assignment validity
- observed-count validation quality
- behavioral demand realism
- production-ready forecasting quality
- client-safe congestion/volume predictions without caveat

---

## Decision deltas
- The shortest path is **not** more sophistication in demand right now.
- The shortest path is a **stable first assignment proof** using the current tract package and explicit screening assumptions.
- The key change in posture is to treat the remaining problem as an implementation-stability blocker, not as a reason to redesign the entire modeling concept.

## Risks / asks
- Risk: pressure to over-interpret the first completed Placer run as calibrated assignment.
- Risk: temptation to redesign the zone system or demand method before getting one stable proof run.
- Ask: keep the claim boundary explicit — first target is **runnable proof**, not defended production validity.

## Manual-verification items
- Confirm `92/92` centroids remain connected in the final proof path.
- Confirm skim matrix is finite for the intended reachable OD pairs.
- Confirm `link_volumes.csv` and `evidence_packet.json` export cleanly.
- Spot-check that local road classes retain car mode and non-null speed/capacity values.
- Verify the evidence packet caveats explicitly say `Uncalibrated`, `Closed boundary`, and `Screening-grade`.
