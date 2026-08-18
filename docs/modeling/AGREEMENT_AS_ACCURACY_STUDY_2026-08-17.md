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
their own model, and would poison any calibration fitted to these counts.

### FIXED 2026-08-17, and here is what it moved

Each registry entry now declares how ITS publisher marks a station that does not
measure a mainline (`non_mainline_patterns` in `count_sources.py`). WSDOT marks
ramps in its Location text; ODOT marks both ramps and numbered CONNECTIONS;
Caltrans and CDOT publish neither and therefore declare nothing. The count
builder stamps `station_role` on every row, and the validator sets those
stations aside before matching — reporting how many and why, never quietly.

Re-validated across all 24 study counties, same count files, same project
databases, only the exclusion differing:

| | before | after |
|---|---:|---:|
| matched stations | 3,658 | 2,696 |
| median absolute error | 120.9% | **100.0%** |
| model ÷ observed | 2.21 | **1.90** |
| within the 30% gate | 13.8% | 16.6% |

**Every California and Colorado county is identical before and after** — the
control that shows the rule fires only where its feed declared it. The movement
is entirely in Oregon and Washington, and it is large where ramps dominated:
Cowlitz County WA 280.7% → 83.1% (ratio 3.81 → 1.43), Klickitat 135.9% → 76.4%,
Hood River OR 296.2% → 139.2%.

**The headline figures elsewhere in this document are the pre-fix ones**, and
are left as they were rather than restated: they are what the study actually
ran on. The direction of the correction is that the models are somewhat better
than this document reports, and the ~1.8-1.9× over-assignment survives it
unchanged.

### The shared-link half, fixed the same day

A model link holds ONE volume, so several stations matched to it are several
observations of one number. After ramp exclusion, 33% of matched stations still
sat on a shared link (404 links), and only 166 of those groups had counts that
agreed with each other. The worst pair was **2 vehicles a day against 33,723**
on one link, with the model holding 72,220.

`resolve_shared_links` now compares such a group once at its median when the
stations agree within the screening gate's own 30% band — reusing that
threshold rather than inventing one — and excludes the whole group when they do
not, because nothing in the data says which station belongs to the link.
Choosing the nearest would be a guess wearing a method.

### What cleaning the measurement twice actually bought

All 24 counties, same runs, only the count handling differing:

| stage | stations | median error | model ÷ observed | within the 30% gate |
|---|---:|---:|---:|---:|
| as the study ran | 3,658 | 120.9% | 2.21 | 13.8% |
| ramps excluded | 2,696 | 100.0% | 1.90 | 16.6% |
| + shared links resolved | 1,998 | 100.0% | **1.78** | 17.1% |

967 stations were set aside as ramps or connectors, 482 as ambiguous pairings,
and 216 merged into a station they agree with — 45% of the original set. That is
a large fraction, so it was checked for the obvious way it could flatter the
model: **the surviving set is not the easy one.** The motorway share FELL from
16.2% to 12.1%, and the median observed volume rose from 10,800 to 14,972 — the
stations that left were disproportionately the small and the bogus.

By road class, before and after:

| class | stations | median error |
|---|---|---|
| motorway | 592 → 242 | 86.6% → **37.6%** |
| trunk | 888 → 498 | 194.7% → 138.2% |
| primary | 1,307 → 826 | 126.8% → 104.5% |
| secondary | 668 → 334 | 109.8% → 100.0% |

**The most useful thing here: on freeways the model is far closer than this
study believed** — 37.6% median error against a 30% gate, rather than 86.6%.
Everything below a freeway remains 100-140% out and ~1.8× over-assigned, and
that residual did NOT move when the measurement was cleaned. It is the model,
not the counts.

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

---

## Hunting the 1.8× over-assignment — four causes ruled out (2026-08-17)

With the measurement cleaned twice and the residual unmoved, the over-assignment
is the model. Four candidate causes were tested against the 24 counties. **All
four were rejected**, which narrows the search rather than ending it.

| hypothesis | test | result |
|---|---|---|
| through/external demand is too big | correlation of external share with over-assignment across 24 counties | **+0.09** — none |
| zones are too coarse | correlation of zone count with over-assignment | **−0.19** — weak, wrong sign |
| the 8-gateway cap concentrates through traffic | correlation of share of boundary crossings kept with over-assignment | **+0.21** — wrong direction |
| connectors attach demand to arterials | 4 counties re-run with the class weight at 0 | **null** (see below) |

Trip generation is close to right and cannot account for it either: **4.32
trips per capita** median across the counties, against roughly 3.8-4.0 in US
household travel survey figures — around 10% high, not 78%.

### The connector experiment, in full

`rank_connector_candidate` scores a node as `priority × 250 − distance`, so a
zone will reach 1,500 m past a residential street to attach its demand to a
motorway. The hypothesis was that this injects every trip onto an arterial and
starves the local network, which would match the road-class signature exactly.

The mechanism is real: at weight 0 the connectors moved off motorways (42 → 10
in Merced County) and onto residential streets (49 → 100). The accuracy did not
follow. Pooled across three development counties, 209 stations:

| | weight 250 (shipped) | weight 0 |
|---|---:|---:|
| median error | 88.6% | 87.3% |
| model ÷ observed | 1.66 | 1.64 |
| within the 30% gate | 20.1% | 21.6% |
| motorway error | 33.6% | **39.7%** |
| secondary error | 100.0% | 88.6% |

No coherent improvement, and motorways got worse. **The default is therefore
unchanged.** `OPENPLAN_CONNECTOR_CLASS_WEIGHT_M` now exists so the question can
be re-measured rather than re-argued, and it defaults to the shipped 250.

Two disclosures. A fourth county, 41017, was also run and is **excluded from
this conclusion**: it is a holdout county of the study above, and using it to
choose a parameter would spend a holdout on a question it was not reserved for.
It got worse too (101.0% → 110.4%). And this experiment had no pre-registration,
so three counties could not have justified moving a shipped default even had
they looked good — the most they can support is a properly registered evaluation.

### What is left to test

The strongest remaining candidate is that the model's traffic is spread over
too few roads: if total travel is roughly right (VMT per capita is credible)
and trips per capita is roughly right, but the network carries that travel on
fewer parallel routes than reality has, every counted road reads high. That is
consistent with the class signature — arterials 2-3.4× and tertiary at 0.01 —
and it is not something a demand-side scalar can reach. Testing it means
comparing the model's VMT-by-road-class distribution against the published
distribution, not adding another correction factor.

---

## RE-READ WITH A CORRECTED INSTRUMENT, 2026-08-18 — the answer holds

**The pre-registered rules above are unchanged. Nothing in them was edited, and
no threshold moved.** What changed is the instrument: the validator that graded
every station was comparing whole-road counts against one carriageway of a
divided highway, affecting 26% of matched stations and 71% of motorway ones
(`WHY_THE_MODEL_OVER_ASSIGNS_2026-08-17.md`, correction section).

**Why the holdout was read a second time.** The rule was "read it once", and
that rule exists to stop a result being re-cut until it looks good. It does not
oblige anyone to stand behind a measurement now known to be defective. The
correction was to the instrument, was made for reasons independent of this
study, and was applied identically to both halves and both models. Both
readings are reported here; neither is hidden.

### Holdout, pooled

| | original | **corrected** | |
|---|---:|---:|---|
| trip-based lift | 0.56 | **1.09** | 1.0 = agreement tells you nothing |
| activity-based lift | 0.33 | **0.49** | |
| trip-based Spearman (GEH vs error) | 0.05 | **0.06** | |
| activity-based Spearman | −0.18 | **−0.27** | |
| trip-based median error | 122.4% | 121.0% | |
| activity-based median error | 68.3% | 63.1% | |
| counties where agreement fails to predict | 9 of 11 | **9 of 11** | |

**The answer to the pre-registered question is still NO.** Agreement between the
two demand models does not predict accuracy against observed counts.

The nuance that did change is worth stating exactly: trip-based agreement moves
from **actively misleading** (lift 0.56 — agreeing corridors were *less* likely
to be accurate than average) to **carrying no information** (lift 1.09, where
1.0 is chance). Activity-based agreement remains below chance at 0.49. Neither
is a basis for reporting confidence in a corridor, which is what the study set
out to test.

### One thing this comparison does NOT isolate

Pooled station counts fall from ~1,509 to ~848. That is **not** the carriageway
fix. The corrected directories were produced with today's validator, which also
excludes ramp counts matched to mainlines and resolves stations sharing one
model link — both landed after the original study ran. Three changes are in that
station-count difference and this table does not separate them. It is reported
as what it is: the same question, asked again with the current instrument.

Machine-readable results, both halves:
`docs/modeling/results/agreement-study-corrected-instrument-2026-08-18/`. The
run trees they were computed from are gitignored (gigabytes per county); these
files are the durable record.
