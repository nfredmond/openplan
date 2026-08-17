# Does two-model agreement predict accuracy? A pre-registered study — the answer is no

> **DATED RECORD — 2026-08-17.** Every figure below was computed from 24 county
> model runs made on 2026-08-16/17, by `scripts/modeling/agreement_accuracy_study.py`.
> Nothing here was written by a language model; the arithmetic is in that file
> and is tested against hand-worked values.

## The question, and why it was worth asking

Only four state DOTs publish AADT feeds this repository can read (California,
Colorado, Oregon, Washington — `scripts/modeling/count_sources.py`). In the rest
of the country, a corridor volume produced by OpenPlan has **no check at all**.

Two independent demand models agreeing is evidence that *is* available
everywhere. If agreement predicted accuracy, it would become a confidence
signal usable in the 46 states where counts cannot be fetched — and reportable
in a grant.

So the study held the network and the assignment constant, varied only the
demand model, and asked whether the corridors where the two agreed were the
corridors where the model was right.

## How it was kept honest

- **Pre-registered.** 24 counties (4 states × 3 tract-size bands × 2), seeded
  selection, split 12 development / 12 holdout with both halves spanning every
  stratum. The registry was committed (`496c50cc`) **before the first county
  ran**; that commit is the pre-registration.
- **Nevada County excluded.** Every method decision in this lane was made while
  looking at it.
- **Neither side calibrated**, ever. Calibration alters link capacities and
  free-flow times, so the network would no longer be held constant. The batch
  driver refuses any run whose manifest carries a calibration record.
- **The network was held constant by mechanism, not by hope.** Both assignments
  in a county adopt the same retained AequilibraE project
  (`--reuse-network-from-run`); every comparison reports zero links present on
  only one side.
- **The assignment's own noise was measured in every county** by assigning one
  model's demand twice. It was **0.0%** everywhere at the tight convergence
  settings — so divergence is attributable to the demand model and nothing else.
- **The development half was read, then the rules were frozen** and recorded as
  a dated amendment in the registry. The holdout half was then run and analysed
  **once**.

## The answer

Both halves say the same thing, and the holdout says it more strongly.

### Holdout — 11 usable counties, ~1,509 stations

| | trip-based | activity-based |
|---|---:|---:|
| median absolute error vs counts | 122.4% | 68.3% |
| median error **where the models agree** | **165.9%** | **142.2%** |
| median error where they diverge | 121.2% | 66.9% |
| precision predicting error ≤ 30% | 0.082 | 0.077 |
| base rate | 0.145 | 0.231 |
| **lift over base rate** | **0.56** | **0.33** |
| Spearman (GEH disagreement vs error) | +0.05 | −0.18 |
| Spearman (scale-free disagreement vs error) | −0.14 | −0.23 |

**A lift below 1.0 means the signal is worse than useless**: a corridor flagged
as "the two methods agree here" was *less* likely to be accurate than a corridor
picked at random. In 9 of the 11 usable holdout counties, agreement failed to
predict — most often because the agreeing stations were *less* accurate than the
diverging ones.

The secondary metric — declared in the registry before any holdout county ran,
precisely so that a null primary result could not be quietly replaced by a
friendlier one — agrees, and its correlation is **negative** in both lanes.

### Development — 11 usable counties, ~1,522 stations

| | trip-based | activity-based |
|---|---:|---:|
| median error | 137.2% | 78.0% |
| lift over base rate | 0.98 | 1.11 |
| Spearman (GEH vs error) | +0.18 | −0.07 |

## What this does and does not license

**It does NOT license** reporting two-model agreement as a confidence signal
anywhere, in a grant or otherwise. That idea is dead in this form, and this
record exists so it is not quietly revived.

**It does not mean the two-model comparison is worthless.** It means agreement
does not predict *accuracy against counts*. The comparison still shows where two
independent methods disagree, which is a real statement about model uncertainty
— it simply is not a statement about correctness.

**A hypothesis this study cannot settle, offered as a hypothesis:** the
relationship runs slightly *backwards* in both lanes. One explanation is that
the two models agree most where the network structurally forces the routing —
a single road between two zone centroids — and with tract-sized zones those are
exactly the links most over-loaded by coarse zoning. That would make agreement a
marker of structural constraint rather than of correctness. Testing it needs a
zone-resolution experiment, not more counties.

## Three findings that matter more than the answer

### 1. The screening model over-assigns by ~1.8×, and it is not a Nevada County quirk

Across the 11 development counties (1,636 matched stations, four states), the
median model-to-observed ratio is **2.14**, and **1.77** after removing the
defective matches described below. Nevada County's separately-measured 1.8×
over-assignment therefore reproduces nationally. This is a far stronger basis
than the single county on which every decision in this lane was previously made.

By road class, all development stations:

| class | stations | median error | model ÷ observed |
|---|---:|---:|---:|
| motorway | 221 | 49.3% | 0.87 |
| secondary | 356 | 109.9% | 2.10 |
| primary | 603 | 132.5% | 2.32 |
| trunk | 344 | 239.1% | 3.39 |
| tertiary | 112 | 100.0% | **0.01** |

Freeways are roughly right; trunk, primary and secondary roads take two to three
and a half times too much traffic; tertiary roads receive essentially nothing.
**This is a zone-resolution consequence, not a parameter to tune**: with
tract-sized zones every trip runs centroid → arterial → trunk, so local roads
carry nothing the model can generate. A per-class scalar would fit the symptom.

Even motorways do not pass the gate: only **34%** of motorway stations fall
within 30%.

### 2. Roughly a quarter of count stations are matched to the wrong link

377 of 1,636 development stations (23%) have "ramp" in their label, and those
carry a median error of **258%** and a ratio of 3.58. The clearest case is in
Cowlitz County, Washington (53015), where three WSDOT ramp counts of 410, 510
and 530 vehicles/day are all matched to link 10805 "Tennant Way" — the mainline
carrying 29,040 — while the genuine mainline station on that same link (37,000
observed) matches it correctly at ratio 0.8.

Additionally, **29% of matched stations share a model link with another
station**. A link should carry one count; many-to-one is itself a detectable
matching failure.

This inflates every accuracy figure in this document, misleads a planner about
their own model, and would poison any calibration fitted to these counts. **It
must be fixed before any count-fitting work, nationwide or otherwise.** The fix
belongs in the per-feed registry — "Ramp" is a WSDOT spelling, not a universal
one — with a place-free many-to-one refusal alongside it.

### 3. About 8% of counties contain a zone that can reach nothing

Two of 24 counties (41029 Jackson OR, 53073 Yakima WA) have an internal zone
that sits in the largest *undirected* network component but is unreachable in
the *directed* graph — a centroid connector attached where a one-way street can
be left but not entered. The trip-based model hides this by masking those pairs;
the activity-based model cannot place those residents' destinations at all.

Since 2026-08-17 this is refused at bundle build with the zone named, costing a
five-minute run instead of a fifteen-minute crash inside pandas. The underlying
connector-selection defect — which requires only *undirected* component
membership — is still open and affects both models.

## Reproducing this

```bash
# the pre-registration (already committed; rebuilding must not change it)
python scripts/modeling/agreement_study_registry.py

# a half at a time; resumable, ~20 min per county
python scripts/modeling/run_agreement_study.py --half dev
python scripts/modeling/run_agreement_study.py --half holdout

# the answer
python scripts/modeling/agreement_accuracy_study.py \
    --study-half-dir data/agreement-study/runs/holdout
```

Per-county artifacts live under `data/agreement-study/runs/` and are gitignored:
6.2 GB per batch of model output, which is product, not evidence. The registry
and this document are the evidence.
