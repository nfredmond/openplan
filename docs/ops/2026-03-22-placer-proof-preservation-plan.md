# 2026-03-22 — Placer proof preservation plan

## Topic
Recommended git and artifact-preservation posture for the accepted first runnable Placer County proof-only assignment checkpoint.

## Exact artifact/package/run being referenced
- Pilot root: `openplan/data/pilot-placer-county/`
- Current proof outputs:
  - `run_output/demand.omx`
  - `run_output/travel_time_skims.omx`
  - `run_output/link_volumes.csv`
  - `run_output/evidence_packet.json`
- Current supporting scripts:
  - `build_network_package.py`
  - `build_trip_tables.py`
  - `step1_osm.py`
  - `step2_assign.py`
- Current package inputs:
  - `package/manifest.json`
  - `package/od_trip_matrix.csv`
  - `package/zone_attributes.csv`
  - `package/zone_centroids.geojson`
  - `package/zones.geojson`
  - `package/corridors.json`

## Preservation objective
Preserve the proof checkpoint honestly and reproducibly without:
- bloating the repo with heavy regenerable artifacts,
- implying productization,
- implying calibrated assignment quality,
- implying behavioral readiness.

## Recommended clean git posture
### Recommended branch
Create a dedicated branch from current `main` for the Placer proof checkpoint, e.g.:
- `modeling/placer-proof-checkpoint`

Purpose of that branch:
- preserve the exact proof-capable code path,
- preserve the minimal package inputs needed to rerun the proof,
- preserve the claim-boundary and preservation memos,
- keep the proof separate from product-facing feature work.

## What should be committed now
### A) Commit the proof scripts
Commit these files now:
- `openplan/data/pilot-placer-county/build_network_package.py`
- `openplan/data/pilot-placer-county/build_trip_tables.py`
- `openplan/data/pilot-placer-county/step1_osm.py`
- `openplan/data/pilot-placer-county/step2_assign.py`

Why:
- they are the actual runnable proof logic,
- they encode the in-memory connector/default-fill salvage that made the Placer proof possible,
- they are small enough and central enough to deserve source control.

### B) Commit the minimal proof package inputs
Recommended to commit:
- `openplan/data/pilot-placer-county/package/manifest.json`
- `openplan/data/pilot-placer-county/package/od_trip_matrix.csv`
- `openplan/data/pilot-placer-county/package/zone_attributes.csv`
- `openplan/data/pilot-placer-county/package/zone_centroids.geojson`
- `openplan/data/pilot-placer-county/package/zones.geojson`
- `openplan/data/pilot-placer-county/package/corridors.json`

Why:
- these are small enough,
- they preserve the exact tract system and demand snapshot used for the proof,
- they make the checkpoint more reproducible without requiring immediate rebuild of every upstream step.

### C) Commit lightweight documentation / proof descriptor files
Commit now:
- `openplan/docs/ops/2026-03-22-placer-county-salvage-blockers.md`
- `openplan/docs/ops/2026-03-22-placer-proof-claim-boundary.md`
- `openplan/docs/ops/2026-03-22-placer-proof-preservation-plan.md`

Recommended to commit after wording cleanup:
- `openplan/data/pilot-placer-county/run_output/evidence_packet.json`

Why:
- the docs capture the truth gate,
- the evidence packet is the lightest structured fingerprint of the accepted proof,
- but the network-source wording mismatch should be corrected before treating it as the canonical proof descriptor.

## What should stay local for now
Keep these local for now:
- `openplan/data/pilot-placer-county/aeq_project/`
- `openplan/data/pilot-placer-county/roads/`
- `openplan/data/pilot-placer-county/__pycache__/`
- `openplan/data/pilot-placer-county/run_output/link_volumes.csv`
- `openplan/data/pilot-placer-county/run_output/demand.omx`
- `openplan/data/pilot-placer-county/run_output/travel_time_skims.omx`
- `openplan/data/pilot-placer-county/package/network_links.geojson`

Why these should stay local now:
- they are heavy and regenerable,
- they are better treated as build artifacts or external evidence artifacts than as normal git content,
- committing them now would make the checkpoint noisier without materially improving methodological truth.

## What should remain proof-only / non-productized
These should remain explicitly proof-only and should **not** be productized yet:
- in-memory centroid-connector salvage logic as a production-facing modeling claim,
- screening-grade speed/capacity defaults,
- tract-based Placer package as if it were a calibrated production model,
- LODES work-trip × `4.0` expansion as if it were behaviorally validated demand,
- any UI or API language that suggests calibrated forecasting or behavioral realism.

In practical terms, do **not**:
- wire this checkpoint into client-facing product language,
- advertise it as a calibrated county model,
- describe it as behavioral demand,
- generalize it to other counties without repeating the claim-boundary discipline.

## Recommended immediate cleanup before preservation commit
Before making the preservation commit for the proof lane:
1. Correct the `network_source` wording in `run_output/evidence_packet.json` so it matches the actual Placer package source posture.
2. Remove `__pycache__` noise.
3. Confirm the proof reruns cleanly from committed scripts + committed package inputs.
4. Keep the heavy generated artifacts out of the commit unless there is a deliberate artifact-storage decision.

## Recommended preservation sequence
1. Correct the lightweight evidence wording mismatch.
2. Create `modeling/placer-proof-checkpoint`.
3. Commit scripts + minimal package inputs + docs.
4. Rerun once from that branch.
5. If rerun matches the current safe claim, optionally add the corrected `evidence_packet.json`.
6. Keep heavy artifacts outside normal git unless Nathaniel explicitly wants a repo-preserved artifact checkpoint.

## Recommended commit boundary
### Commit boundary: yes
- source code
- small CSV/GeoJSON package inputs
- documentation
- corrected lightweight evidence descriptor

### Commit boundary: no (for now)
- raw TIGER download payloads
- full AequilibraE project database
- large generated link-volume exports
- generated OMX outputs
- cache / compiled files / logs

## Bottom line
Preserve the **logic, inputs, and truth documentation** in git.
Keep the **heavy generated artifacts** local for now.
Keep the entire Placer lane framed as an accepted **proof-only screening/assignment checkpoint**, not a productized or calibrated model.
