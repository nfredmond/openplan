# Phase 2: ActivitySim Synthetic Population Data Spec

**Date:** 2026-03-19  
**Owner:** Bartholomew Hale (COO)  
**Status:** Scoping  

## Objective
To move OpenPlan from static LODES commute expansion (Phase 1) to an Activity-Based Model using ActivitySim (Phase 2), we must generate a **Synthetic Population** for the 26 Nevada County zones in our pilot model.

ActivitySim requires a microsimulated list of individual households and persons that statistically match the demographic profile of each zone, serving as the "agents" whose daily travel choices are modeled.

## 1. Geography Alignment
Our pilot model consists of **26 Census Tracts** in Nevada County, California (FIPS `06057`).
- We need marginals at the **Tract** level.
- We need PUMS microdata at the **PUMA** (Public Use Microdata Area) level. Nevada County is covered by PUMA `0606100` (which covers Nevada and Sierra Counties).

## 2. Required Data Sources (ACS 2022 5-Year Estimates)

### A. Seed Microdata (PUMS)
We need the raw survey responses for households and persons in PUMA `0606100`.
- **Household file:** `psam_h06.csv` (filtered to PUMA 06100)
  - Required attributes: `SERIALNO` (ID), `NP` (persons), `HINCP` (income), `VEH` (vehicles), `TEN` (tenure/rent vs own).
- **Person file:** `psam_p06.csv` (filtered to PUMA 06100)
  - Required attributes: `SERIALNO` (HH link), `SPORDER` (Person ID), `AGEP` (age), `SCHG` (school grade), `ESR` (employment status), `SEX` (gender).

### B. Control Marginals (Tract Level)
We need aggregate counts for each of our 26 tracts from the ACS Summary File to constrain the PUMS weighting.

**Household Controls (Tract level):**
1. Total Households (B11001)
2. Households by Size (1, 2, 3, 4+ persons) (B08201)
3. Households by Income ($0-35k, $35k-75k, $75k-150k, $150k+) (B19001)

**Person Controls (Tract level):**
1. Total Population (B01003)
2. Population by Age (0-17, 18-64, 65+) (B01001)

## 3. Tooling Options for Synthesis

To fit the PUMS seed data to the Tract marginals, we have two primary options:

1. **PopulationSim (ActivitySim Ecosystem)**
   - *Pros:* Native compatibility with ActivitySim, robust handling of multi-level controls (PUMA + Tract).
   - *Cons:* Heavy dependency footprint, steep learning curve for configuration.
2. **Custom IPF (Iterative Proportional Fitting) Python Script**
   - *Pros:* Zero external dependencies, transparent, easy to orchestrate natively in the OpenPlan worker.
   - *Cons:* We have to write and tune the matrix balancing logic manually.

**Recommendation:** Since our pilot only has 26 zones and simple control variables, a **Custom IPF Python Script** is the most robust and maintainable path for v1. We can graduate to PopulationSim later if we scale to a multi-county regional model.

## 4. Next Steps / Execution Plan

1. **Data Acquisition:** Use the Census API (or standard download) to pull the PUMS seed files and the specific ACS Tract marginals for Nevada County.
2. **Crosswalk Construction:** Map the Census categories to the exact column names expected by ActivitySim (`persons`, `income_segment`, `age_segment`, `worker_status`, `student_status`).
3. **IPF Execution:** Write a python script to run Iterative Proportional Fitting to assign weights to each PUMS household per tract.
4. **Agent Expansion:** Convert the fractional weights into discrete integer households (integerization) and export `households.csv` and `persons.csv` matching the ActivitySim schema.