# Does model agreement predict accuracy? — dev counties

Does agreement between two independent demand models predict accuracy against observed traffic counts?

11 of 11 counties contributed usable stations.

## Pooled — trip-based accuracy

- stations: **844**, median APE **81.2%**
- rank correlation between disagreement (GEH) and error (APE): **0.1375**
- where the models agree: median APE **87.93%** (98 stations)
- where they diverge: median APE **81.17%** (693 stations)
- predicting APE ≤ 30.0% from agreement: precision **0.1327**, recall **0.0802**, base rate **0.1919**, lift **0.6911**

### Counties where agreement did NOT predict accuracy

- **06047** (CA, medium): stations where the models agreed were LESS accurate (median APE 86.91%) than where they diverged (78.21%)
- **06069** (CA, small): stations where the models agreed were LESS accurate (median APE 210.74%) than where they diverged (83.69%)
- **08014** (CO, small): stations where the models agreed were LESS accurate (median APE 76.45%) than where they diverged (47.72%)
- **08059** (CO, large): stations where the models agreed were LESS accurate (median APE 67.73%) than where they diverged (48.48%)
- **08101** (CO, medium): stations where the models agreed were LESS accurate (median APE 75.84%) than where they diverged (37.1%)
- **41005** (OR, large): stations where the models agreed were LESS accurate (median APE 2615.25%) than where they diverged (107.47%)
- **41041** (OR, small): agreement carried no lift over the base rate (lift 0.0)
- **53011** (WA, large): stations where the models agreed were LESS accurate (median APE 76.0%) than where they diverged (74.72%)
- **53077** (WA, medium): stations where the models agreed were LESS accurate (median APE 275.0%) than where they diverged (53.71%)

## Pooled — activity-based accuracy

- stations: **837**, median APE **66.28%**
- rank correlation between disagreement (GEH) and error (APE): **-0.1355**
- where the models agree: median APE **86.34%** (104 stations)
- where they diverge: median APE **59.84%** (680 stations)
- predicting APE ≤ 30.0% from agreement: precision **0.1346**, recall **0.0722**, base rate **0.2318**, lift **0.5808**

### Counties where agreement did NOT predict accuracy

- **06047** (CA, medium): stations where the models agreed were LESS accurate (median APE 86.91%) than where they diverged (49.04%)
- **06069** (CA, small): stations where the models agreed were LESS accurate (median APE 207.27%) than where they diverged (81.92%)
- **06107** (CA, large): stations where the models agreed were LESS accurate (median APE 69.11%) than where they diverged (47.59%)
- **08014** (CO, small): stations where the models agreed were LESS accurate (median APE 77.28%) than where they diverged (52.34%)
- **08059** (CO, large): stations where the models agreed were LESS accurate (median APE 61.71%) than where they diverged (43.59%)
- **08101** (CO, medium): stations where the models agreed were LESS accurate (median APE 76.56%) than where they diverged (32.95%)
- **41005** (OR, large): stations where the models agreed were LESS accurate (median APE 92.01%) than where they diverged (68.66%)
- **53011** (WA, large): stations where the models agreed were LESS accurate (median APE 83.97%) than where they diverged (66.28%)
- **53077** (WA, medium): stations where the models agreed were LESS accurate (median APE 296.8%) than where they diverged (67.93%)

## What this is not

- Neither model is ground truth. Agreement means the two methods concur, not that either is right; both can be wrong in the same direction, and the pooled figures below can only detect that where counts exist.
- The two models' volumes are never averaged anywhere in this study.
- Accuracy here is measured only in the four states whose DOTs publish an AADT feed this repository can read. Whether the relationship holds elsewhere is exactly what the study cannot observe, and is the reason it is worth running at all.
- The behavioural coefficients of the activity-based side are estimated for the San Francisco Bay Area and applied unmodified. Its accuracy figures carry that limit.
