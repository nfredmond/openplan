# Does model agreement predict accuracy? — holdout counties

Does agreement between two independent demand models predict accuracy against observed traffic counts?

11 of 12 counties contributed usable stations.

## Pooled — trip-based accuracy

- stations: **848**, median APE **121.01%**
- rank correlation between disagreement (GEH) and error (APE): **0.0625**
- where the models agree: median APE **182.13%** (38 stations)
- where they diverge: median APE **120.39%** (802 stations)
- predicting APE ≤ 30.0% from agreement: precision **0.1316**, recall **0.049**, base rate **0.1203**, lift **1.0939**

### Counties where agreement did NOT predict accuracy

- **06007** (CA, medium): one agreement class had no stations, so the comparison could not be made
- **06053** (CA, large): stations where the models agreed were LESS accurate (median APE 874.72%) than where they diverged (65.49%)
- **08035** (CO, medium): one agreement class had no stations, so the comparison could not be made
- **08077** (CO, small): stations where the models agreed were LESS accurate (median APE 114.0%) than where they diverged (91.0%)
- **41017** (OR, medium): stations where the models agreed were LESS accurate (median APE 446.45%) than where they diverged (148.37%)
- **41067** (OR, large): stations where the models agreed were LESS accurate (median APE 573.53%) than where they diverged (115.94%)
- **53029** (WA, small): agreement carried no lift over the base rate (lift 0.0)
- **53063** (WA, large): agreement carried no lift over the base rate (lift 0.0)

## Pooled — activity-based accuracy

- stations: **908**, median APE **63.14%**
- rank correlation between disagreement (GEH) and error (APE): **-0.2713**
- where the models agree: median APE **187.49%** (41 stations)
- where they diverge: median APE **61.91%** (858 stations)
- predicting APE ≤ 30.0% from agreement: precision **0.122**, recall **0.022**, base rate **0.25**, lift **0.4878**

### Counties where agreement did NOT predict accuracy

- **06007** (CA, medium): one agreement class had no stations, so the comparison could not be made
- **06053** (CA, large): stations where the models agreed were LESS accurate (median APE 874.85%) than where they diverged (43.84%)
- **08035** (CO, medium): agreement carried no lift over the base rate (lift 0.0)
- **08077** (CO, small): stations where the models agreed were LESS accurate (median APE 114.0%) than where they diverged (44.48%)
- **41003** (OR, small): stations where the models agreed were LESS accurate (median APE 216.58%) than where they diverged (149.32%)
- **41017** (OR, medium): stations where the models agreed were LESS accurate (median APE 446.45%) than where they diverged (99.32%)
- **41067** (OR, large): stations where the models agreed were LESS accurate (median APE 448.38%) than where they diverged (67.08%)
- **53029** (WA, small): stations where the models agreed were LESS accurate (median APE 70.88%) than where they diverged (34.52%)
- **53063** (WA, large): stations where the models agreed were LESS accurate (median APE 83.17%) than where they diverged (75.89%)

## What this is not

- Neither model is ground truth. Agreement means the two methods concur, not that either is right; both can be wrong in the same direction, and the pooled figures below can only detect that where counts exist.
- The two models' volumes are never averaged anywhere in this study.
- Accuracy here is measured only in the four states whose DOTs publish an AADT feed this repository can read. Whether the relationship holds elsewhere is exactly what the study cannot observe, and is the reason it is worth running at all.
- The behavioural coefficients of the activity-based side are estimated for the San Francisco Bay Area and applied unmodified. Its accuracy figures carry that limit.
