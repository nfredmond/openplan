#!/usr/bin/env python3
"""
Nevada County Synthetic Population Generator (Iterative Proportional Fitting)
Pulls 2022 ACS 5-Year Estimates and PUMS data to generate household/person lists.
"""
import os
import sys
import json
import requests
import numpy as np
import pandas as pd
from io import BytesIO
from zipfile import ZipFile

pd.options.mode.chained_assignment = None

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
os.makedirs(DATA_DIR, exist_ok=True)

CENSUS_API_KEY = os.getenv("CENSUS_API_KEY", "")

# Nevada County is FIPS 06 (CA), 057 (Nevada). PUMA is 06100.
# We also include Sierra County (091) if needed, but our zones are just Nevada.
STATE_FIPS = "06"
COUNTY_FIPS = "057"
PUMA = "06100"
YEAR = 2022

# ── 1. Fetch ACS Marginals (Tract Level) ────────────────────────────────
# We need marginal controls for our 26 tracts.
# Variables:
#   B11001_001E : Total Households
#   B08201_002E : HH Size 1
#   B08201_003E : HH Size 2
#   B08201_004E : HH Size 3
#   B08201_005E : HH Size 4+
#   B19001_002E to B19001_007E : Income < $35k
#   B19001_008E to B19001_011E : Income $35k - $75k
#   B19001_012E to B19001_015E : Income $75k - $150k
#   B19001_016E to B19001_017E : Income $150k+

def fetch_acs_marginals():
    print("Fetching ACS 2022 5-Year marginals for Nevada County tracts...")
    base_url = f"https://api.census.gov/data/{YEAR}/acs/acs5"
    
    # HH Size variables
    vars_size = "B11001_001E,B08201_002E,B08201_003E,B08201_004E,B08201_005E,B08201_006E"
    # Income variables
    vars_inc = ",".join([f"B19001_{str(i).zfill(3)}E" for i in range(2, 18)])
    
    get_vars = f"NAME,{vars_size},{vars_inc}"
    
    params = {
        "get": get_vars,
        "for": "tract:*",
        "in": f"state:{STATE_FIPS} county:{COUNTY_FIPS}",
    }
    if CENSUS_API_KEY:
        params["key"] = CENSUS_API_KEY
        
    res = requests.get(base_url, params=params)
    if res.status_code != 200:
        raise ValueError(f"Census API Error: {res.text}")
        
    data = res.json()
    header = data[0]
    df = pd.DataFrame(data[1:], columns=header)
    
    # Convert numeric columns
    for col in df.columns:
        if col not in ["NAME", "state", "county", "tract"]:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
            
    # Aggregate controls
    df["total_hh"] = df["B11001_001E"]
    df["sz_1"] = df["B08201_002E"]
    df["sz_2"] = df["B08201_003E"]
    df["sz_3"] = df["B08201_004E"]
    df["sz_4p"] = df["B08201_005E"] + df["B08201_006E"] # 4 and 5+
    
    # Income bins
    inc_35 = sum([df[f"B19001_{str(i).zfill(3)}E"] for i in range(2, 8)])
    inc_75 = sum([df[f"B19001_{str(i).zfill(3)}E"] for i in range(8, 12)])
    inc_150 = sum([df[f"B19001_{str(i).zfill(3)}E"] for i in range(12, 16)])
    inc_up = sum([df[f"B19001_{str(i).zfill(3)}E"] for i in range(16, 18)])
    
    df["inc_1"] = inc_35   # < 35k
    df["inc_2"] = inc_75   # 35k - 75k
    df["inc_3"] = inc_150  # 75k - 150k
    df["inc_4"] = inc_up   # 150k+
    
    # Clean up and export
    df["geoid"] = df["state"] + df["county"] + df["tract"]
    controls = df[["geoid", "total_hh", "sz_1", "sz_2", "sz_3", "sz_4p", "inc_1", "inc_2", "inc_3", "inc_4"]]
    controls.to_csv(os.path.join(DATA_DIR, "tract_marginals.csv"), index=False)
    print(f"  Saved marginals for {len(controls)} tracts.")
    return controls

# ── 2. Fetch PUMS Seed Data ─────────────────────────────────────────────
# We need household and person microdata for PUMA 06100.
# The Census FTP provides CSVs by state.

def fetch_pums_data():
    print("Fetching 2022 PUMS microdata for California...")
    # hh_url = "https://www2.census.gov/programs-surveys/acs/data/pums/2022/5-Year/csv_hca.zip"
    # p_url = "https://www2.census.gov/programs-surveys/acs/data/pums/2022/5-Year/csv_pca.zip"
    # Downloading 300MB+ zip files takes a while. We can use the Census API for PUMS too!
    
    base_url = f"https://api.census.gov/data/{YEAR}/acs/acs5/pums"
    
    # Household variables: SERIALNO, WGTP (weight), NP (persons), HINCP (income), VEH (vehicles)
    params_h = {
        "get": "SERIALNO,WGTP,NP,HINCP,VEH",
        "for": f"public use microdata area:{PUMA}",
        "in": f"state:{STATE_FIPS}"
    }
    if CENSUS_API_KEY: params_h["key"] = CENSUS_API_KEY
    
    res_h = requests.get(base_url, params=params_h)
    if res_h.status_code != 200:
        raise ValueError(f"PUMS HH API Error: {res_h.text}")
        
    data_h = res_h.json()
    df_h = pd.DataFrame(data_h[1:], columns=data_h[0])
    for col in ["WGTP", "NP", "HINCP", "VEH"]:
        df_h[col] = pd.to_numeric(df_h[col], errors="coerce").fillna(0)
    
    # Classify seed households to match marginal bins
    df_h["sz_cat"] = df_h["NP"].apply(lambda x: min(int(x), 4))
    
    def inc_cat(inc):
        if inc < 35000: return 1
        elif inc < 75000: return 2
        elif inc < 150000: return 3
        else: return 4
        
    df_h["inc_cat"] = df_h["HINCP"].apply(inc_cat)
    
    df_h.to_csv(os.path.join(DATA_DIR, "seed_households.csv"), index=False)
    print(f"  Saved {len(df_h)} seed households.")
    
    # Person variables: SERIALNO, SPORDER, PWGTP, AGEP, SCHG, ESR, SEX
    print("Fetching PUMS persons...")
    params_p = {
        "get": "SERIALNO,SPORDER,PWGTP,AGEP,SCHG,ESR,SEX",
        "for": f"public use microdata area:{PUMA}",
        "in": f"state:{STATE_FIPS}"
    }
    if CENSUS_API_KEY: params_p["key"] = CENSUS_API_KEY
    
    res_p = requests.get(base_url, params=params_p)
    if res_p.status_code != 200:
        raise ValueError(f"PUMS Person API Error: {res_p.text}")
        
    data_p = res_p.json()
    df_p = pd.DataFrame(data_p[1:], columns=data_p[0])
    for col in ["SPORDER", "PWGTP", "AGEP", "SCHG", "ESR", "SEX"]:
        df_p[col] = pd.to_numeric(df_p[col], errors="coerce").fillna(0)
        
    df_p.to_csv(os.path.join(DATA_DIR, "seed_persons.csv"), index=False)
    print(f"  Saved {len(df_p)} seed persons.")
    
    return df_h, df_p

# ── 3. Iterative Proportional Fitting (IPF) ─────────────────────────────
# We balance the 2D joint distribution (Size x Income) for each tract.

def run_ipf(controls, seed_h):
    print("\nRunning Iterative Proportional Fitting (IPF) for 26 tracts...")
    
    # 1. Build the seed joint distribution (4 sizes x 4 incomes)
    seed_dist = np.zeros((4, 4))
    for sz in range(1, 5):
        for inc in range(1, 5):
            # Sum the PUMS weights (WGTP) for this cell
            mask = (seed_h["sz_cat"] == sz) & (seed_h["inc_cat"] == inc)
            seed_dist[sz-1, inc-1] = seed_h.loc[mask, "WGTP"].sum()
            
    # Add a tiny epsilon to avoid structural zeros
    seed_dist[seed_dist == 0] = 0.1
    
    weights = {} # tract -> adjusted seed_dist
    
    for _, row in controls.iterrows():
        geoid = str(row["geoid"])
        
        # Marginal targets
        target_sz = np.array([row["sz_1"], row["sz_2"], row["sz_3"], row["sz_4p"]], dtype=float)
        target_inc = np.array([row["inc_1"], row["inc_2"], row["inc_3"], row["inc_4"]], dtype=float)
        
        # Scale targets if they don't perfectly sum (they usually don't due to Census sampling)
        sum_sz = target_sz.sum()
        sum_inc = target_inc.sum()
        if sum_sz == 0 or sum_inc == 0:
            weights[geoid] = np.zeros((4, 4))
            continue
            
        target_inc = target_inc * (sum_sz / sum_inc)
        
        # IPF loop
        mat = seed_dist.copy()
        for iteration in range(20):
            # Row adjustment (Size)
            row_sums = mat.sum(axis=1)
            row_sums[row_sums == 0] = 1.0
            mat = mat * (target_sz / row_sums)[:, np.newaxis]
            
            # Col adjustment (Income)
            col_sums = mat.sum(axis=0)
            col_sums[col_sums == 0] = 1.0
            mat = mat * (target_inc / col_sums)
            
        weights[geoid] = mat
        
    print("  IPF converged.")
    return weights, seed_dist

# ── 4. Integerization and Expansion ─────────────────────────────────────
# We convert fractional weights into discrete households and sample from the seed.

def expand_population(controls, seed_h, seed_p, weights, seed_dist):
    print("\nExpanding fractional weights into discrete population...")
    
    syn_hh = []
    syn_p = []
    
    hh_id_counter = 1
    
    for _, row in controls.iterrows():
        geoid = str(row["geoid"])
        mat = weights.get(geoid)
        if mat is None or mat.sum() == 0: continue
        
        for sz in range(1, 5):
            for inc in range(1, 5):
                target_count = mat[sz-1, inc-1]
                # Integerize via floor + probabilistic rounding
                integer_count = int(np.floor(target_count))
                prob = target_count - integer_count
                if np.random.rand() < prob:
                    integer_count += 1
                    
                if integer_count == 0: continue
                
                # Get candidate households from seed
                candidates = seed_h[(seed_h["sz_cat"] == sz) & (seed_h["inc_cat"] == inc)]
                if len(candidates) == 0:
                    # Fallback to any household of that size
                    candidates = seed_h[seed_h["sz_cat"] == sz]
                
                if len(candidates) == 0: continue
                
                # Sample 'integer_count' times from candidates with replacement, weighted by WGTP
                sampled = candidates.sample(n=integer_count, replace=True, weights="WGTP")
                
                for _, hh in sampled.iterrows():
                    serialno = hh["SERIALNO"]
                    
                    # Create new synthetic household
                    syn_hh.append({
                        "household_id": hh_id_counter,
                        "zone_id": geoid,
                        "np": hh["NP"],
                        "income": hh["HINCP"],
                        "vehicles": hh["VEH"],
                        "source_serialno": serialno
                    })
                    
                    # Clone persons
                    persons = seed_p[seed_p["SERIALNO"] == serialno]
                    for _, p in persons.iterrows():
                        syn_p.append({
                            "household_id": hh_id_counter,
                            "person_id": len(syn_p) + 1,
                            "age": p["AGEP"],
                            "sex": p["SEX"],
                            "worker_status": 1 if p["ESR"] in [1, 2, 4, 5] else 0, # roughly employed
                            "student_status": p["SCHG"]
                        })
                    
                    hh_id_counter += 1

    df_sh = pd.DataFrame(syn_hh)
    df_sp = pd.DataFrame(syn_p)
    
    df_sh.to_csv(os.path.join(DATA_DIR, "synthetic_households.csv"), index=False)
    df_sp.to_csv(os.path.join(DATA_DIR, "synthetic_persons.csv"), index=False)
    
    print(f"  Generated {len(df_sh):,.0f} synthetic households.")
    print(f"  Generated {len(df_sp):,.0f} synthetic persons.")

if __name__ == "__main__":
    np.random.seed(42) # Determinism
    ctrl = fetch_acs_marginals()
    s_hh, s_p = fetch_pums_data()
    w, s_d = run_ipf(ctrl, s_hh)
    expand_population(ctrl, s_hh, s_p, w, s_d)
    print("\nDONE. Synthetic population is ready for ActivitySim!")
