# Comparable observation study result — 2026-08-28

Release: `v0.41.0`  
Release-source SHA: `3ef6eff43d0f9dcf70afd8c308b63e819cdb7750`  
Scientific outcome: `inconclusive`

The v0.41 instrument retained 125,691 stable observation series and 131,018
exact source measurements across seven California development counties. It
published fourteen separate diagnoses: one AequilibraE and one ActivitySim
record per county. The frozen v0.39 and v0.40 artifacts and v1 matcher remain
unchanged.

| Geography | Series | Measurements | Matched before assignment | Ambiguous | Excluded | Genuine network absence |
|---|---:|---:|---:|---:|---:|---:|
| 06007 | 10,050 | 11,626 | 3 | 4,997 | 5,050 | 0 |
| 06039 | 29,245 | 29,245 | 17 | 11,245 | 17,982 | 1 |
| 06047 | 24,253 | 25,580 | 42 | 12,018 | 12,193 | 0 |
| 06053 | 19,535 | 19,535 | 57 | 11,351 | 8,127 | 0 |
| 06057 | 10,263 | 10,373 | 16 | 4,504 | 5,743 | 0 |
| 06069 | 8,289 | 8,289 | 29 | 4,511 | 3,749 | 0 |
| 06107 | 24,056 | 26,370 | 65 | 10,007 | 13,984 | 0 |

After assignment output was opened, AequilibraE retained 74 nonzero matched and
155 unloaded records. ActivitySim retained 57 nonzero matched and 172 unloaded
records. The methods remain separate; the study publishes values, differences,
and ratios but no average, ranking, or winner.

These counts describe repaired instrument coverage, not improved model
accuracy. The exact assignment evidence proves a representative peak-hour
factor of `0.10`, so the modeled quantity is **synthetic expanded daily traffic,
not AADT**. Vehicle/PCE equivalence is used only because the bound assignment
profile records `class_pce = 1`. The model base year remains `unknown`, and no
use-specific acceptance rule was frozen. Therefore no assessment can pass or
fail.

The exact release files are under
`data/modeling/comparable-observation-study-2026-08-28/`. The study-result hash
is `e5d576f31637fdfba33f7862f87599b73d381394b739e171fed93e564386fc82`.

Sources used by the US adapter are the FHWA Traffic Monitoring Guide data-format
specification and the FHWA HPMS Field Manual. Country and source selection are
owned by the v3 study registry, not by the country-neutral matcher.

## Boundaries

- no calibration or demand repair;
- no model-candidate selection;
- no new acceptance threshold;
- no opened holdout;
- no AADT claim for expanded assignment output;
- California and nationwide modeling capability remain `partial`.
