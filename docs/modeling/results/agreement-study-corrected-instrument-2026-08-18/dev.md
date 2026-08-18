# Does model agreement predict accuracy? — dev counties

Does agreement between two independent demand models predict accuracy against observed traffic counts?

11 of 12 counties contributed usable stations.

## Pooled — trip-based accuracy

- stations: **845**, median APE **115.83%**
- rank correlation between disagreement (GEH) and error (APE): **0.181**
- where the models agree: median APE **113.09%** (58 stations)
- where they diverge: median APE **119.44%** (770 stations)
- predicting APE ≤ 30.0% from agreement: precision **0.1379**, recall **0.0714**, base rate **0.1325**, lift **1.0406**

### Counties where agreement did NOT predict accuracy

- **06069** (CA, small): agreement carried no lift over the base rate (lift 0.0)
- **08059** (CO, large): stations where the models agreed were LESS accurate (median APE 97.95%) than where they diverged (74.54%)
- **08101** (CO, medium): stations where the models agreed were LESS accurate (median APE 1267.72%) than where they diverged (85.0%)
- **41005** (OR, large): agreement carried no lift over the base rate (lift 0.0)
- **53011** (WA, large): agreement carried no lift over the base rate (lift 0.0)
- **53077** (WA, medium): stations where the models agreed were LESS accurate (median APE 442.86%) than where they diverged (63.8%)

## Pooled — activity-based accuracy

- stations: **893**, median APE **70.92%**
- rank correlation between disagreement (GEH) and error (APE): **-0.1679**
- where the models agree: median APE **109.03%** (63 stations)
- where they diverge: median APE **68.06%** (806 stations)
- predicting APE ≤ 30.0% from agreement: precision **0.1429**, recall **0.0452**, base rate **0.2228**, lift **0.6411**

### Counties where agreement did NOT predict accuracy

- **06069** (CA, small): stations where the models agreed were LESS accurate (median APE 96.17%) than where they diverged (81.64%)
- **06107** (CA, large): stations where the models agreed were LESS accurate (median APE 84.21%) than where they diverged (41.99%)
- **08059** (CO, large): stations where the models agreed were LESS accurate (median APE 97.88%) than where they diverged (45.06%)
- **08101** (CO, medium): stations where the models agreed were LESS accurate (median APE 1254.95%) than where they diverged (50.8%)
- **41005** (OR, large): agreement carried no lift over the base rate (lift 0.0)
- **53015** (WA, small): stations where the models agreed were LESS accurate (median APE 67.27%) than where they diverged (66.06%)
- **53077** (WA, medium): stations where the models agreed were LESS accurate (median APE 446.56%) than where they diverged (95.98%)

## What this is not

- Neither model is ground truth. Agreement means the two methods concur, not that either is right; both can be wrong in the same direction, and the pooled figures below can only detect that where counts exist.
- The two models' volumes are never averaged anywhere in this study.
- Accuracy here is measured only in the four states whose DOTs publish an AADT feed this repository can read. Whether the relationship holds elsewhere is exactly what the study cannot observe, and is the reason it is worth running at all.
- The behavioural coefficients of the activity-based side are estimated for the San Francisco Bay Area and applied unmodified. Its accuracy figures carry that limit.
