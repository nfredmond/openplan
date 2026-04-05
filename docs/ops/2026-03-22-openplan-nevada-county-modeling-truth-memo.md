# OpenPlan Nevada County Pilot — Modeling Truth Memo

**Date:** 2026-03-22  
**Author:** Dr. Adrian Velasco, Principal Travel Demand Modeler  
**Status:** Internal methodological truth memo  

## Scope and governing artifacts

### Reference alignment note
The requested Lane B QA note is **not present in the root repo** at `openplan/docs/ops/2026-03-21-lane-b-model-data-contract-and-qa-notes.md`.

The reviewed note exists at:
- `openplan-worktrees/modeling-aeq-activitysim/docs/ops/2026-03-21-lane-b-model-data-contract-and-qa-notes.md`

That worktree memo is consistent with the current root package/run artifacts, but it is **supporting interpretation**, not the governing evidence location.

### Canonical artifacts that should govern claims today
1. `data/pilot-nevada-county/package/manifest.json`
2. `data/pilot-nevada-county/package/zone_attributes.csv`
3. `data/pilot-nevada-county/package/od_trip_matrix.csv`
4. `data/pilot-nevada-county/run_output/evidence_packet.json`
5. `data/pilot-nevada-county/run_output/state_1de72401.json`
6. `data/pilot-nevada-county/run_output/link_volumes.csv`
7. `data/pilot-nevada-county/run_output/top_loaded_links.geojson`
8. `data/pilot-nevada-county/run_output/demand.omx`
9. `data/pilot-nevada-county/run_output/travel_time_skims.omx`

### Supporting but not yet canonical-to-run artifacts
- `openplan-worktrees/modeling-activitysim-proof/data/pilot-nevada-county/proof/input_provenance.json`
- `openplan-worktrees/modeling-activitysim-proof/data/pilot-nevada-county/proof/study_area_qc.json`
- `openplan-worktrees/modeling-activitysim-proof/data/pilot-nevada-county/proof/runtime_qc.json`
- `docs/ops/2026-03-21-openplan-four-priority-acceleration-plan.md`

## 1) What is proven today

### Proven package facts
- A Nevada County pilot package exists with **26 Census-tract zones**.
- `zone_attributes.csv` contains **101,987 estimated population** and **29,840 total jobs** across those 26 tracts.
- `od_trip_matrix.csv` is a **26 x 26** daily OD matrix totaling **66,572 trips**, with **488 positive OD cells** and **13,172 intrazonal trips** (~19.8%).
- `manifest.json` clearly labels the package as **uncalibrated screening** and ties the static package network to **TIGER/Line 2023 roads**.

### Proven run facts
- One concrete AequilibraE run exists: **run_id `1de72401-4bb7-4377-a1c0-bbb7381a8f95`**.
- The run used **AequilibraE 1.6.1**, **BFW assignment**, and **BPR (alpha=0.15, beta=4.0)**.
- The executed run used an **OpenStreetMap-derived network**, not the static TIGER network in the package manifest.
- Reported run outputs:
  - **49,005 directed links / 19,460 nodes / 26 zones** in assignment graph
  - **66,572 requested trips**
  - **34,840 routable trips** (**52.3% routable share**)
  - **380 / 650 reachable skim pairs**
  - **2,412 loaded links**
  - **final gap 0.01337 after 50 iterations**
- Root run artifacts physically exist for link volumes, top loaded links, demand OMX, and skim OMX.

### What this proves in plain English
OpenPlan currently proves a **working Nevada County screening pipeline** that can:
- package tract-based screening inputs,
- execute an AequilibraE assignment/skimming run,
- emit reproducible run artifacts,
- and summarize caveats honestly.

## 2) What is screening-only

The following are **screening**, not behavioral or validated demand:
- The OD matrix is **synthetic daily screening demand**, not ActivitySim output.
- Demand construction is based on **internal LODES commute flows expanded by factor 4.0**.
- The study area is **closed-boundary**; there are **no explicit external stations** in the current pilot package.
- Network speeds/capacities are **default estimates**, not calibrated or field-verified.
- Travel time skims and link volumes are valid as **prototype screening outputs** for this exact run setup only.

## 3) What remains unproven

- **Behavioral demand** is unproven. There is no executed ActivitySim run in the governing evidence bundle.
- **Calibration/validation** is unproven. There is no observed-count validation or travel-time validation in the governing evidence bundle.
- **Scenario credibility** is unproven. There is no demonstrated baseline-vs-scenario comparison artifact tied to a validated run.
- **Open-boundary realism** is unproven. The current run is closed-boundary and leaves **31,732 trips unroutable**.
- **Client-safe forecasting claims** are unproven. Nothing here supports defensible future-year behavioral forecasting.
- **Full run traceability** is incomplete. Provenance/QC artifacts exist in proof lanes, but are not yet co-located as part of the canonical root run bundle.

## 4) Safe claims vs unsafe claims

### Safe claims for internal use
- OpenPlan has a **real AequilibraE-based Nevada County screening run** with package and run artifacts on disk.
- The current pilot is **tract-based, uncalibrated, closed-boundary, and screening-grade**.
- The current run successfully emits **assignment outputs and skim artifacts**, but only **52.3% of requested demand is routable**.
- Current ActivitySim work is still **specification / scaffolding**, not proven behavioral execution.

### Safe claims for external/client-safe use
- OpenPlan has an **early Nevada County pilot screening prototype** for network assignment/accessibility workflows.
- The current outputs are appropriate for **internal prototype review and bounded screening discussion**, with explicit caveats.
- The current pilot demonstrates **artifact-producing workflow capability**, not validated forecast quality.

### Unsafe or premature claims
Do **not** claim any of the following:
- “behavioral demand model”
- “validated” or “calibrated” model
- “observed-count matched” network
- “decision-ready countywide forecast”
- “future-year demand forecast”
- “ActivitySim-integrated production lane”
- “complete multi-engine modeling stack”
- any statement implying the static TIGER package network and the executed OSM run network are the same artifact

## 5) Artifact/package mismatches and integrity risks

### A. Static package network and executed run network are not the same
This is the primary integrity risk.

- Static package manifest network: **TIGER/Line**, **9,111 links**
- Executed run network: **OpenStreetMap-derived**, **49,005 directed links** in assignment output

This means the current run is **not** a direct replay of `package/network_links.geojson`. Claims must preserve a hard distinction between:
- **static package network source**, and
- **executed assignment network source**.

### B. Provenance/QC is split across lanes
`input_provenance.json`, `study_area_qc.json`, and `runtime_qc.json` exist in proof/worktree locations, but they are **not yet part of the canonical root run bundle**. That weakens package-control clarity.

### C. Multiple state files exist in the canonical run folder
`run_output/` contains several `state_*.json` files, but only `state_1de72401.json` aligns cleanly to the current governing `run_id`. The extra state files create avoidable provenance ambiguity.

### D. Connectivity/boundary risk is material
The current run leaves **47.7% of requested trips unroutable** and reports only **95.3% largest connected component**. That is acceptable for early screening, but it materially limits any stronger claim.

### E. Some package-control notes are stale on artifact existence
Earlier package-control inventory notes flagged missing run/package artifacts. Those notes are no longer current on raw artifact existence. The stronger remaining issue is **traceability and validation**, not whether files exist.

## 6) Single next proof-critical step

**Run one bounded observed-count validation slice against the exact canonical OSM-based run bundle (`run_id 1de72401-4bb7-4377-a1c0-bbb7381a8f95`).**

Why this is the fastest ship-readiness move:
- it tests whether the current screening lane has any real-world explanatory value,
- it avoids pretending ActivitySim is ready,
- and it turns the discussion from “files exist” to “this run is or is not directionally credible on a real corridor/count set.”

If the validation slice fails badly, that is still useful truth and should narrow claims immediately.

## 7) Recommended 72-hour closure sequence

### 0–12 hours: freeze the governing bundle
- Declare the canonical claim bundle as the root `data/pilot-nevada-county/package/` + `run_output/` artifacts above.
- Add or promote co-located provenance/QC files for that exact run.
- Mark `state_1de72401.json` as the governing run-state file.

**Evidence checkpoint:** one explicit bundle index listing the exact artifact paths and run ID.

### 12–36 hours: perform one bounded validation slice
- Pick one corridor or count screenline with usable observed counts.
- Crosswalk observed counts to the loaded-link set from `link_volumes.csv` / `top_loaded_links.geojson`.
- Report coverage, fit direction, and caveats plainly.

**Evidence checkpoint:** one validation table/map plus a one-page interpretation note.

### 36–60 hours: correct only the narrowest blocker
- If failure is mostly boundary/connectivity, either:
  - narrow the claim to the validated subarea, or
  - make one minimal rerun that improves routability/package alignment.
- Do not broaden scope into full ActivitySim buildout during this closure window.

**Evidence checkpoint:** either a revised run ID with delta note, or an explicit bounded-claim memo.

### 60–72 hours: issue ship/no-ship decision for the modeling lane
- Publish updated safe claims.
- Lock external/internal language.
- State whether the lane is:
  - **internal prototype only**,
  - **bounded screening-ready**, or
  - **not ready for outward modeling claims**.

**Evidence checkpoint:** final modeling gate memo with approved language.

## Bottom line

Today’s Nevada County modeling lane proves a **real screening workflow** and **does not prove a behavioral, calibrated, or client-ready demand model**.

The fastest honest path forward is **not** broader buildout. It is one **canonical-bundle, observed-count validation slice** on the run that already exists.