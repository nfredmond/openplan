# Fitting trip length to published travel — pre-registration

> **Written BEFORE any parameter was fitted, 2026-08-17.** The commit adding
> this file is the pre-registration. Results are appended once, below it, and
> the rules here are not edited afterwards.

## What is being fixed, and why it is the right target

OpenPlan's screening model generates **about 2.2 times as much driving as
actually happens** — measured across 24 counties against FHWA Highway
Statistics 2022 and Census population, with no reference to traffic counts, and
agreeing with the 1.78× over-assignment measured independently against 1,998
count stations (`WHY_THE_MODEL_OVER_ASSIGNS_2026-08-17.md`).

It is trip **length**, not trip generation:

| | model | real |
|---|---:|---:|
| internal trips per capita | 3.57 | ~3.0–3.3 |
| network miles per trip | **11.63** | **~5.7** |

Correlation of miles-per-trip with a county's overshoot is **+0.93**. Five other
causes were tested and rejected: external demand share, zone count, the gateway
cap, connector road-class preference, and finer (block-group) zoning.

## The lever

`screening_runtime.py` distributes trips with `impedance ** -gamma`. Higher
gamma decays distance faster and shortens trips:

```
HBW_GAMMA = 1.8      home-based work
HBO_GAMMA = 1.5      home-based other
NHB_GAMMA = 1.2      non-home-based
```

These are OpenPlan's own screening defaults. They are not drawn from any
published trip-distribution manual and have never been fitted to anything.

## What will be fitted, and against what

**One multiplier applied to all three gammas**, not three free parameters. The
relative ordering (work trips tolerate distance least readily than other
purposes… in fact work trips travel furthest, which is why HBW has the LOWEST
decay in most published models — OpenPlan's ordering is the reverse and that is
a separate question this study does not touch) is left exactly as it is. One
parameter over five counties is already a thin fit; three would be fitting
noise and calling it behaviour.

**Fitted against published VMT per capita (FHWA ÷ Census), NOT against traffic
counts.** This matters: the result is then judged against the counts, which are
independent data the fit never saw. Fitting to counts and reporting count error
is the trap this lane has documented twice.

## The counties

- **Fit on five DEVELOPMENT counties:** 06069, 08014, 06047, 08101, 06107.
  Same five as the zone-resolution experiment, all from the agreement study's
  development half.
- **Confirm on five HOLDOUT counties:** 06007, 06039, 08035, 41003, 53029 —
  drawn from the study's holdout half, never used to choose anything.
- Nevada County (06057) is excluded from both, as everywhere in this lane.

## The decision rule, fixed in advance

The fitted multiplier is adopted as the new default **only if all four hold**:

1. On the **holdout** counties, median model VMT per capita ÷ published VMT per
   capita moves to within **1.0 ± 0.35** (from 2.16).
2. On the **holdout** counties, median absolute percent error against traffic
   counts **improves by ≥ 20 points** (from ~100%).
3. **No road class with ≥ 20 holdout stations gets materially worse** — its
   median error rising by more than 10 points.
4. The fitted multiplier is **within 0.5× to 3× of 1.0**. A value outside that
   is not a calibration, it is the model being wrong in a way one parameter
   should not paper over, and it gets reported as such rather than shipped.

Anything less is reported as measured, and the defaults stay. A partial
improvement is a real finding about where the error lives; it is not a licence
to change what every planner's run does.

## What this cannot do, stated now

- **A right total is not a right distribution.** Matching VMT per capita says
  the model produces the right amount of driving; it says nothing about whether
  that driving is on the right roads. Criterion 3 exists to catch the case
  where the total improves while individual corridors get worse.
- **Ten counties in four states** is a thin basis for a national default. If it
  passes, the honest framing is "fitted on ten counties, confirmed on five it
  never saw", not "calibrated for the United States".
- **State VMT per capita is not county VMT per capita.** A county with an
  interstate through it carries travel generated elsewhere. This is why the
  criterion is a median over counties with a wide band, not a per-county gate.
- Gamma changes trip **distribution**, so it moves VMT and link volumes
  together. It cannot fix the tertiary-road problem (0.07× observed), which is
  a zone-resolution artifact and was measured as untouched by finer zones.

---

## Mechanism verified before the sweep finished (2026-08-17)

The lever works and is recorded. First county (06069) at multiplier 1.5:

- gammas recorded as 2.7 / 2.25 / 1.8 with `gamma_multiplier: 1.5` in the run's
  own assumptions, so the run says what shaped it;
- trip COUNT unchanged (392,662 both arms) — it redistributes trips rather than
  generating fewer, which is what the parameter is supposed to do;
- distributed mean trip length responds strongly: on that county's real skim,
  ×1.5 shortens the mean trip 27%, ×2.5 halves it.

**But assigned VMT moved far less than trip length did** (ratio 2.82 → 2.65 for
a 27% shorter trip). The reason is worth recording separately from the
experiment:

### External gateway traffic is untouchable by gamma, and it is a flat guess

Trips that cross the study-area boundary are injected at gateways and routed
across; the gravity model never sees them. `GATEWAY_DAILY_TRIPS` assigns each
crossing a flat daily figure by road class — motorway 15,000, trunk 9,000,
primary 6,000, secondary 3,000, tertiary 1,500 — regardless of where in the
country it is or what actually crosses there.

Across the 24 study counties external traffic is a **median 17.3% of all
trips, ranging from 7% to 54%**. So in a typical county gamma can move about
83% of the demand, and the experiment is sound — but in the extreme cases it is
mostly powerless, and 06069 (40.7% external) is one of those. Its weak response
is explained, not anomalous.

Correlation of external share with a county's VMT overshoot is +0.37 — real but
secondary to trip length's +0.93, and consistent with the earlier finding that
external demand alone does not explain the over-assignment.

**This does not change the pre-registered rule.** It is recorded because the
per-county spread is wide enough that a county-level result should be read with
its external share beside it, and because the flat gateway figure is now a
named next target rather than a suspicion.

## First arm (×1.5), five development counties — and the trade-off it exposes

Both arms graded on the SAME station set (the baseline re-validated with
current ramp and shared-link exclusions; 306 against 302 stations).

| | baseline | ×1.5 |
|---|---:|---:|
| median VMT ratio (model ÷ published) | 2.29 | **1.70** |
| median count error | 97.5% | **76.2%** |
| primary roads | 227.8% | **133.9%** |
| trunk roads | 112.1% | 106.1% |
| secondary | 100.0% | 100.0% |
| tertiary | 82.7% | 83.6% |
| **motorway** | **30.7%** | **47.2%** |

Every county moved the right way on VMT (2.88→2.27, 2.29→1.68, 1.99→1.70).

**But motorways got 16.5 points worse, and it is real rather than noise:** 66
stations across the three well-sampled counties, every one degrading —
06047 43%→53%, 08101 17%→36%, 06107 19%→41%.

### Why — and a correction to my first explanation of it

My first reading was that shortening trips pulls traffic off the long-distance
network, so freeway SHARE would fall. **That was wrong, and measuring it said
so:** freeway share of vehicle-miles barely moved (06047 30.3%→29.7%; 06107
30.2%→**34.5%**, the opposite direction).

What actually happened, at the stations themselves:

| county | motorway stations | model ÷ observed |
|---|---:|---|
| 06047 | 25 | 0.62 → **0.49** |
| 08101 | 17 | 0.86 → **0.73** |
| 06107 | 23 | 0.81 → **0.59** |

Motorways were already UNDER-assigned, and gamma pushed them further down.
Gamma removes travel from the network roughly proportionally; the arterials
could afford to lose it and the freeways could not.

### The defect, stated precisely

Across all 24 counties, 1,998 stations:

| class | stations | model ÷ observed | |
|---|---:|---:|---|
| motorway | 242 | **0.78** | under-assigned |
| trunk | 498 | 2.38 | over-assigned |
| primary | 826 | 2.05 | over-assigned |
| secondary | 334 | 1.30 | over-assigned |
| tertiary | 98 | **0.07** | under-assigned |

**The model is wrong in two directions at once, and a single multiplier moves
every class the same way.** It can trade the arterial error for a freeway
error, and the headline figures (VMT ratio 2.29→1.70, error 97.5%→76.2%) will
call that progress.

That is exactly what criterion 3 exists to catch, and why it was written before
any number existed. The fix is not a scalar on trip length; it is whatever
distinguishes a long freeway trip from a short arterial one — a network or
assignment property, not a demand-magnitude one.

### Two follow-up hypotheses, both tested and both refuted

Having said the fix is "whatever distinguishes a long freeway trip from a short
arterial one", the obvious candidates were tested rather than assumed.

**1. Network speeds are wrong.** They are not. The model's free-flow speeds
match reality closely: motorway 65.9 mph, trunk 56.4, primary 44.3, secondary
37.1, tertiary 31.4, residential 25.1.

**2. Missing intersection delay makes arterial routes look artificially fast.**
The model has no signal delay at all, which is true and sounds decisive. It is
not: worked over a 25% freeway detour, the freeway wins on modelled time at
every trip length from 2 to 30 miles, so adding arterial delay would not change
a single one of those choices. (My first version of this test printed a
conclusion that its own table contradicted — the table is what stands.)

**3. Over-assigned arterials are running parallel to freeways** — traffic that
should be on the freeway going through town instead. Measured in 06047:
arterial stations within 2 km of a freeway are **2.95×** observed; those more
than 2 km from any freeway are **3.26×**. If anything the far ones are worse.

**So the arterials are over-loaded everywhere, not beside freeways.** This is
not a routing swap between parallel roads. Something is putting too much
traffic on mid-tier roads across the whole network while leaving freeways
under-loaded, and none of trip length, zone size, gateway count, connector
choice, network speed or route choice between parallels explains it.

That is where this investigation stands. It is a narrower question than it was
this morning, and it is not answered.

## THE FREEWAY GAP IS PARTLY A MEASUREMENT DEFECT (2026-08-17)

The eighth hypothesis is the one that held. OpenStreetMap maps a divided
highway as **two one-way links**, one per carriageway, and the model reports
each carriageway's own volume — but a DOT count station on that corridor
measures **both directions**. Comparing them compares half a road against a
whole one.

How the network is split, one county:

| class | two-way links | one-way links | % one-way |
|---|---:|---:|---:|
| motorway | 9 | 1,174 | **99%** |
| trunk | 252 | 383 | 60% |
| primary | 2,437 | 846 | 26% |
| secondary | 3,941 | 1,594 | 29% |
| residential | 39,315 | 1,367 | 3% |

**Freeways are almost entirely one-way pairs; local roads almost none.** So the
defect lands hardest exactly where the model looked worst.

### Measured, within each class, over all 24 counties

| class | link kind | stations | model ÷ observed |
|---|---|---:|---:|
| trunk | two-way | 309 | 3.08 |
| trunk | one-way | 189 | **1.48** |
| primary | two-way | 654 | 2.31 |
| primary | one-way | 172 | **1.08** |

**Two-way links read 2.09× and 2.14× higher than one-way links of the same
class** — the halving, measured twice independently on 1,324 stations. Every
motorway station in the study sits on a one-way link, which is why motorways
read 0.78 while everything around them read 2-3.

### What it does NOT explain, stated plainly

Doubling every one-way link's modelled volume narrows the spread between road
classes from **3.04× to 2.11×** — the defect is real and large — but it does
not make the model right:

| class | as measured | one-way doubled |
|---|---:|---:|
| motorway | 0.78 | **1.57** |
| trunk | 2.38 | 3.04 |
| primary | 2.05 | 2.28 |
| secondary | 1.30 | 1.44 |
| pooled | 1.78 | 2.20 |

Motorways go from under-assigned to over-assigned. **The model still puts about
twice as much traffic on the network as belongs there** — the finding from this
morning's independent FHWA comparison (2.16× published VMT per capita, which
never touched a count station) survives intact and is now corroborated by the
corrected count comparison at 2.20×.

So there were two defects stacked, and separating them changes what each lane
must do:

1. **The validation must compare like with like.** A station on a divided
   highway is measuring both carriageways; the comparison must sum them. This
   is a fix to `count_validation.py` and the scripts-lane validator, not to the
   model.
2. **The model over-assigns by roughly 2×, uniformly.** With the measurement
   defect removed, the road-class spread is much smaller than it looked, which
   makes a magnitude correction more plausible than it appeared an hour ago —
   and the trip-length lever is back in scope for exactly that.

---

## CORRECTION, 2026-08-18: the motorway result above was a measurement defect

**Everything above this line stands as written on 2026-08-17. This section
supersedes its motorway conclusion, and the pre-registered rules are unchanged.**

The ×1.5 arm was reported as failing criterion 3 because motorway error rose
30.7% → 47.2%. That comparison was wrong, and in a way that had nothing to do
with gamma.

**A count station on a divided highway measures both directions. OSM maps that
road as two one-way carriageways, each carrying half the traffic.** The
validator compared the station's whole-road count against ONE carriageway. 59 of
73 motorway stations in these five counties sit on a divided highway, so the
class most affected was the class the criterion turned on.

Re-graded with both carriageways summed — same runs, same stations, same rules,
only the comparison corrected:

| | baseline | ×1.5 | ×2.0 |
|---|---:|---:|---:|
| median VMT ratio (model ÷ published) | 2.29 | 1.70 | **1.52** |
| median count error | 97.5% | 82.7% | **67.1%** |
| motorway (73 stations) | 58.3% | **39.6%** | 41.5% |
| primary | 227.8% | 169.6% | 125.0% |
| secondary | 237.1% | 205.7% | 178.9% |
| trunk | 101.2% | 91.6% | 85.7% |
| tertiary (10 stations — below the criterion's threshold) | 65.5% | 67.1% | 76.2% |

Motorway model ÷ observed: **1.08 baseline → 0.91 at ×1.5 → 0.82 at ×2.0.**

So the earlier claim that "motorways were already under-assigned and gamma
pushed them further down" is **wrong on its first half**. At baseline motorways
are assigned very nearly correctly (1.08); gamma pushes them below 1.0, and
×1.5 lands them closer to the truth in absolute error than the baseline did.

**Criterion 3 now passes for ×1.5 and for ×2.0** — no road class with ≥ 20
stations gets materially worse; every one of them improves.

### What this changes about the lane's conclusions

- The per-class over-assignment table in
  `WHY_THE_MODEL_OVER_ASSIGNS_2026-08-17.md` (motorway 0.78, tertiary 0.07)
  was computed with the same defect and **understates every divided-highway
  class by roughly a factor of two.** The worker lane was corrected in
  `f527df2c` and the scripts lane in `c26873fd`; that table has not yet been
  recomputed and should not be quoted until it is.
- The conclusion that "the fix is not a scalar on trip length" was reasoned
  from the motorway regression. That reasoning no longer holds. It may still be
  true — a scalar cannot fix a two-directional error — but it is no longer
  supported by this experiment.

### What has NOT changed

Criterion 1 is still failed by every arm measured so far. The band is
1.0 ± 0.35 and the VMT ratio goes 2.29 → 1.70 → 1.52: **improving, flattening,
and still outside.** Gamma at 2.0 leaves half again as much driving as
published.

The likely reason is recorded above and is not speculative: external gateway
trips are injected at the boundary and never pass through the gravity model, so
gamma cannot touch them — a median 17.3% of all trips across the study
counties, on a flat per-crossing guess.

**×3.0 and ×4.0 arms are running on the same five development counties to
measure where the curve asymptotes.** ×4.0 is outside criterion 4's adoptable
band by construction; it is diagnostic, not a candidate. If the curve flattens
above 1.35, that is the measured answer that gamma alone cannot reach the
target, and the gateway figure — not the decay parameter — is the next thing to
fix.

### The mechanism that let this happen

The correction code was present, tested, and inert in the scripts lane: the
candidate dictionaries are rebuilt field by field rather than copied, so
`is_one_way` never reached the pairing. A synthetic divided highway read 20,000
against a 38,000 count with the fix "installed". Three mutations now kill that,
and a two-way negative control kills the opposite error of doubling everything.

Runs made before the property was exported are still gradable: direction is
recovered from the AequilibraE project database each run was assigned on, and
the summary records that the fact came from there rather than from the geometry.

## The 8-gateway cap is not only a speed limit — 2026-08-18

`CLAUDE.md` lists `OPENPLAN_MAX_GATEWAYS` (default 8) among the things that
exist purely to keep runs fast, and therefore among the things to lift now that
accuracy outranks runtime. That framing is incomplete, and lifting the cap on
its own would make the model considerably worse.

**Read from the code** (`workers/aequilibrae_worker/gateways.py`): each
crossing is given `GATEWAY_DAILY_TRIPS[road class] x lanes`, capped at 20,000,
**independently of every other crossing**. Total external demand is therefore
close to linear in the number of gateways. Counties routinely have 25-47
crossings, so lifting the cap multiplies external demand several times over.

**Estimated, and the estimate is biased high — stated because I published the
number before checking its basis.** Subtracting internal VMT (internal trips x
mean trip length) from total network VMT puts external traffic at 51-71% of all
vehicle-miles, rising as gamma shortens internal trips. But that mean trip
length is `internal_od_centroid_distance` — centroid to centroid, not the
assigned network path — so it **understates internal VMT and therefore
overstates the external share**. A second caveat runs the same way: the
"published county VMT" it was compared against is a state-average per-capita
rate applied to county population, and a county with an interstate through it
genuinely carries travel generated elsewhere.

The direction is not in doubt: external traffic is a large and rising share of
network vehicle-miles, and gamma cannot touch any of it. The magnitude is being
measured properly by re-running the five counties with
`--external-demand-scalar 0`, which assigns internal demand only and gives the
decomposition by subtraction from an identical network. That result replaces
these figures.

So the cap is currently the only thing bounding a flat per-crossing guess. The
order matters: **replace the guess with observed data first, then lift the
cap.** 58% of the gateways in these five counties have a published count
station within 3 km of the crossing, so most of them can be seeded with a real
AADT rather than a constant, falling back to the class figure elsewhere and
saying which is which.

Doing it the other way round would take a model that over-assigns 2.1x and make
it worse, while the headline "more crossings modelled" would read as an
improvement.

---

# CLOSED 2026-08-18 — NOT ADOPTED. The defaults stay.

**Graded by `grade_against_preregistered_criteria` in
`scripts/modeling/gamma_fit_analysis.py`, which applies the four rules above as
arithmetic rather than leaving them to a reading of a table.**

Five development counties (06047, 06069, 06107, 08014, 08101), all arms graded
from the carriageway-corrected validation directory:

| multiplier | VMT ratio | count error | motorway | primary | secondary | tertiary | trunk | verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1.0 (default) | 2.29 | 97.5% | 64% | 228% | 100% | 83% | 101% | — |
| ×1.5 | 1.70 | 85.6% | 44% | 164% | 100% | 84% | 92% | fails 1, 2 |
| ×2.0 | 1.52 | 72.1% | 37% | 123% | 96% | 88% | 86% | fails 1 |
| ×2.5 | 1.43 | 62.3% | 39% | 100% | 98% | 93% | 83% | fails 1 |
| ×3.0 | 1.38 | 64.2% | 42% | 86% | 99% | 90% | 82% | fails 1 |

**No arm is adoptable. Criterion 1 — the VMT band of 1.0 ± 0.35 — fails for
every one**, and the steps shrink by half each time (−0.59, −0.18, −0.09,
−0.05).

*(Correction: I first wrote that the curve "asymptotes near 1.33". That was
extrapolation from four points, and the ×4.0 arm then came in at 1.51, which
looked like a reversal. It was neither. One county's ×4.0 run had not finished,
so that median covered four counties against the others' five — the tool named
the ungraded run and I read the medians instead. Every county falls
monotonically. `arms_are_comparable` now travels with the comparison so an arm
with a different county set cannot be read as a result.)*

Count error also has a minimum at ×2.5 and rises again at ×3.0, so the two
metrics do not even agree on a best arm.

## The reason, measured rather than inferred

### The median hid the thing worth knowing

Per county, at ×3.0, the model-to-published VMT ratio and how far the lever
moved it:

| county | external share of VMT | ratio at 1.0 | at ×3.0 | overshoot reduced by |
|---|---:|---:|---:|---:|
| Tulare, CA | 25.7% | 2.29 | **1.03** | 55.0% |
| Merced, CA | 53.5% | 2.88 | 1.74 | 39.7% |
| Pueblo, CO | 60.9% | 1.99 | 1.38 | 30.4% |
| Broomfield, CO | 75.2% | 1.41 | 1.21 | 14.3% |
| San Benito, CA | 82.6% | 2.82 | **2.49** | 11.5% |

**Correlation between a county's external share and how much gamma can reduce
its overshoot: −0.985** (n = 5, over a 3× range of external share). The lever
works almost exactly in proportion to how much of the county's driving the
county itself generates. Tulare, where three quarters of the vehicle-miles are
internal, lands inside the criterion-1 band. San Benito, where five sixths come
from the boundary, barely moves.

That is the same finding the headline gives, stated per county: the parameter is
fine and it is pointed at the wrong term.

**A median 61% of modelled vehicle-miles is boundary traffic** (25.7%–82.6%
across all five development counties, measured by re-running with
`--external-demand-scalar 0`). The spread matters as much as the median: the
lever's power over a given county depends on how much of its driving it
generates itself.
Gamma cannot touch any of it. It can only shrink the other third, which is why
the curve flattens exactly where it does.

And the third it shrinks was already the right size: **network miles per
internal trip is 5.59 against a real ~5.7**
(`WHY_THE_MODEL_OVER_ASSIGNS_2026-08-17.md`, correction). At ×2.5 gamma drives
the mean internal trip to 3.59 miles — well below anything real — and the count
error improves anyway, because the external term then carries the network almost
alone.

**So this experiment did not fail to find a good multiplier. It established that
no multiplier is the right instrument**, and it did so through a rule written
before any number existed. Had criterion 1 been "does it improve", ×2.5 would
have looked like a 35-point win and shipped.

## What the pre-registration got right, and what it did not

Right: fitting against published VMT rather than counts, so the counts stayed
independent; the band around 1.0 rather than a test for improvement; grading
per road class with a station floor; and writing all of it down first.

Not right: the premise. The rules were sound and the diagnosis they were built
on — "the model sends every trip roughly twice as far as real trips go" — was an
artifact of comparing network-miles-per-trip against a per-resident figure. A
pre-registration protects the analysis, not the hypothesis.

## Next

Replace the flat per-crossing figure with observed AADT where a count station
sits near the crossing — 58% of gateways in these counties have one within 3 km
— label the rest as the class default, and only then ask whether any demand
parameter still needs to move. The gateway cap must not be lifted before that;
see the section above.

---

## How far the gateway lever can actually reach — measured 2026-08-18

`scripts/modeling/gateway_counts.py` existed, tested, and called by nothing. It
is now wired (`50d6eb59`), and its first run exposed a bug of the same shape as
three others found today: the gateway record was built field by field and
dropped `name`, so identity matching refused every crossing and every county
reported "no published count is near any of my crossings" as though it were a
fact about the county (`c77604fa`).

With that fixed, across 24 crossings in the five development counties:

| | crossings |
|---|---:|
| have an OSM name to match on | 19 |
| **have a published count on that road within 2 miles** | **8** |
| have one within 5 miles | 10 |
| have one within 10 miles | 11 |
| have no count on that road anywhere in the county's set | 8 |
| have no OSM name at all | 5 |

**The distance rule is not what is limiting this.** Going from 2 miles to 10
buys three more matches and starts accepting counts several junctions away —
Pueblo's two I-25 crossings would match stations 15 and 30 miles off, which is a
different road's worth of traffic under the same name. The limits are that a
third of crossings are unnamed in OSM, and that state count sets cluster in
towns rather than at county lines.

So today the lever measures **about a third of boundary crossings**, and the
rest keep the class default and say so per crossing. That is worth having — the
measured ones are the freeways, which carry most of the boundary traffic — but
it is not a complete fix, and the honest framing is "some crossings are now
measured", never "boundary traffic is now real".

The improvement worth trying next is matching on route designation (OSM `ref`,
"I 25") as well as ceremonial name, because state DOT feeds are organised by
route number and OpenPlan is matching against names like "John F. Kennedy
Memorial Highway".

---

## Seeding boundary traffic from real counts — measured, and NOT switched on

Five development counties, seeded arm against unseeded baseline, **both graded
on the same stations** (the seeded run withholds the stations that set its own
boundary traffic, so the baseline was re-graded on that same reduced set).

| county | crossings measured | count error base → seeded | VMT ratio base → seeded |
|---|---:|---:|---:|
| Merced, CA | 4 of 8 | 137.8% → **153.9%** | 2.88 → 3.18 |
| San Benito, CA | 4 of 8 | 98.6% → **80.0%** | 2.82 → **2.58** |
| Tulare, CA | 5 of 8 | 156.0% → 151.6% | 2.29 → 2.38 |
| Broomfield, CO | 4 of 8 | 74.3% → 68.7% | 1.41 → **2.56** |
| Pueblo, CO | 0 of 8 | 87.9% → 87.9% | 1.99 → 1.99 |
| **median** | | **98.6% → 87.9%** | **2.29 → 2.56** |

**The two measures disagree, and the disagreement is the finding.** Agreement
with observed counts improves by about 11 points. Total vehicle-miles gets
worse, by a lot in Broomfield.

### Why, measured rather than reasoned

**Correlation between the change in injected boundary crossings and the change
in total network VMT: +0.981.** Broomfield's crossings rose 84.7% and its
network VMT rose 81.4% — very nearly one for one.

Total VMT is close to a linear function of how many trips are injected at the
edge, because **every one of them is routed into the study area's interior and
back out.** A gateway's `daily_in` is distributed across all zones by
employment and its `daily_out` drawn from all zones by population; there is no
gateway-to-gateway demand at all. So a vehicle that in reality clips a corner of
Broomfield on I-25 is modelled as a trip from the county line to somewhere in
the middle of the county, plus another one back.

Replacing the guessed volume with the real one therefore makes that structural
error **bigger**, in exact proportion. Broomfield is the extreme case for a
reason: 33 square miles with two interstates through it, so nearly all of its
boundary traffic is genuinely passing through.

### The decision

**`OPENPLAN_SEED_GATEWAYS_FROM_COUNTS` stays OFF by default.** Seeding is more
honest per crossing and the run records which crossings are measured, so it is
available to anyone who wants it — but switching it on today would trade a wrong
number for a differently wrong number and report the improved count agreement as
progress.

**The blocker is now named and it is not the gateway volume.** It is that
boundary traffic has no through-movement: the model cannot represent a vehicle
crossing the study area. Until gateway-to-gateway demand exists, a truer
crossing volume makes the total worse, and no amount of accuracy in the volume
changes that.

That is the next piece of work in this lane, and it is a demand-structure
change, not a parameter.

---

## Pass-through travel reaches the county-script lane — measured, and kept ON

The worker has routed a share of a two-crossing route straight across the study
area since it was written. This lane never did, so every measurement above was
taken on a model where no vehicle could drive across a county. Closed
`dc27421a`; one shared implementation `0b2ead92`.

Five development counties, **the same network in both arms** (the pass-through
runs reuse each baseline's retained project, so only the demand construction
differs), graded on the same stations:

| county | crossings paired | VMT ratio | | count error | |
|---|---:|---:|---:|---:|---:|
| | | before | after | before | after |
| Merced, CA | 4 of 8 | 2.88 | **2.70** | 137.8% | **121.7%** |
| San Benito, CA | 2 of 8 | 2.82 | 2.72 | 97.4% | 91.6% |
| Tulare, CA | 4 of 8 | 2.29 | 2.26 | 151.9% | 136.9% |
| Broomfield, CO | 6 of 8 | 1.41 | **1.20** | 76.2% | 69.9% |
| Pueblo, CO | 2 of 8 | 1.99 | 1.97 | 87.9% | 88.3% |
| **median** | | **2.29** | **2.26** | **97.4%** | **91.6%** |

**Both measures improve, and they improve together** — which the gateway-seeding
change did not do. Broomfield gains most and has the most paired crossings: 33
square miles with two interstates through it, where nearly all boundary traffic
genuinely passes through. Its ratio moves from 1.41 to 1.20, **inside the
criterion-1 band**, on a change that fits no parameter to anything.

It is kept on, and it does not close the gap: the median county still assigns
2.26× the published vehicle-miles.

### The measurement that was wrong first, and why

The first attempt at this table showed +0.3% — no effect. Pass-through had never
run. The arms reuse each baseline's network, a reused network adopts the source
run's gateway records, and every run made before 2026-08-18 recorded no road
name on them; route pairing matches on road identity, so nothing paired. The
output was a normal-looking run with the same gateway count and the same
volumes.

**That is the fifth instance in one day of a correction being present and
unreached**, after `is_one_way` in the count validator's candidates, `direction`
in its project-database query, `name` on the gateway record, and the whole of
`gateway_counts.py`. Every one produced plausible numbers and would have been
read as a finding about the world.

Reused gateways now recover their road name from the project database they came
with (`backfill_gateway_names_from_project`), so runs already on disk can pair.
Removing the call — not the function, the call — fails a test that drives the
reuse path end to end, because testing the function alone is what let this
through.

### Seeding re-measured on top of pass-through — the answer does not change

Seeding was rejected before pass-through existed, and the two interact directly,
so it was re-run with both on. Same network, same stations:

| county | VMT: pass-through | + seeded | error: pass-through | + seeded |
|---|---:|---:|---:|---:|
| Merced, CA | 2.70 | 2.97 | 117.7% | 147.3% |
| San Benito, CA | 2.72 | **2.48** | 98.6% | **74.2%** |
| Tulare, CA | 2.26 | 2.35 | 140.2% | 149.2% |
| Broomfield, CO | **1.20** | **2.01** | 58.1% | 60.1% |
| Pueblo, CO | 1.97 | 1.97 | 88.3% | 88.3% |
| **median** | **2.26** | **2.35** | **98.6%** | **88.3%** |

Still a trade: counts better, total worse. **`OPENPLAN_SEED_GATEWAYS_FROM_COUNTS`
stays off**, now tested under both conditions.

**Broomfield says what is actually binding.** Its measured crossings are 66,500
a day against the flat cap of 20,000, so real volumes more than triple its
boundary demand — and 35% of that routed across still leaves the other 65%
flooding a county 33 square miles across. For a small county bisected by two
interstates the true through-share is nowhere near 35%.

**So the next number to measure is `GATEWAY_PASSTHROUGH_SHARE` itself.** It is a
flat uncalibrated constant applied identically to a freeway and a county road,
and it is now the largest unmeasured quantity in the boundary story — the same
class of guess the per-crossing volume was, one level up. A share that varied
with road class and with how much of the route lies inside the study area is the
obvious shape; measuring it needs a source this lane does not have yet, and
saying that is better than fitting it to these five counties.

---

## The through-share itself: bounded from counts, swept, and NOT adopted

The model routes a flat 35% of every two-crossing route across the study area —
the same figure for an interstate and a county road, fitted to nothing. I said
measuring it needed a source this lane does not have. **That was worth checking
rather than asserting, and it was wrong.**

### It can be bounded, from counts already downloaded

Every vehicle crossing the study area passes the lowest-volume point on its
route inside it, so through travel is at most that minimum. Across five
counties, 11 crossings with enough count profile:

| route | county | ceiling |
|---|---|---:|
| Interstate 5 | Merced, CA | **0.84** |
| State Route 99 | Merced, CA | **0.45** |
| State Route 99 | Tulare, CA | 0.69–0.88 |
| State Route 43 | Tulare, CA | 0.61 |
| US 36 | Broomfield, CO | 0.76 |
| State Route 156 | San Benito, CA | 1.00 (uninformative) |

Median **0.84**, against the 0.35 in use — and it varies the way the road does.
I-5 bypasses Merced's towns and bounds high; SR-99 runs through Merced city and
bounds low. **One flat figure cannot describe both.**

**These are CEILINGS.** Counts say how many vehicles are at a place, never which
of them are the same vehicles, so no arrangement of counts measures through
travel. A route whose minimum sits at its own crossing bounds at 1.0 — true, and
it means the counts cannot tell. Those are marked and excluded rather than
averaged in.

### A sweep says higher is better, and does not say how much higher

Five counties, same networks, flat share varied:

| through share | median VMT ratio | median count error |
|---|---:|---:|
| 0.00 (this lane before today) | 2.29 | 97.4% |
| **0.35 (the default)** | 2.26 | 91.6% |
| 0.55 | 2.23 | 92.0% |
| 0.75 | 2.21 | 89.4% |
| 0.90 | **2.19** | **87.3%** |

Both measures improve monotonically to the clamp. **That is not a calibration —
it is a parameter improving right up to the edge of its allowed range without
turning over, which identifies no value and is the classic signature of a knob
compensating for something else.** The total gain is 4% of a 2.2× error.

### The decision

**Nothing is adopted. `OPENPLAN_PASSTHROUGH_FROM_COUNTS` stays off and the flat
0.35 stays as the default**, now documented as unsupported rather than merely
uncalibrated:

- adopting the count ceilings would use an upper bound as an estimate, which
  overstates through travel wherever the bound is loose;
- adopting the sweep's best would be fitting a parameter to five counties, which
  is what the pre-registration for the gamma experiment existed to prevent, and
  it would have shipped a 35-point "win" there.

**What is now recorded honestly:** two independent lines of evidence say 0.35 is
too low, and neither says what it should be. **What would settle it** is a source
that observes travel rather than counting vehicles at points. One exists and is
free — FHWA's Traveler Analysis Framework — and it is used in the section below.

### The sweep's first run was inert, which is the sixth time today

At 0.35, 0.55, 0.75 and 0.90 it produced **byte-identical** network VMT. The
override was read in `main.py` while `gateways.py` hardcoded 0.35, so the worker
honoured it and the county-script lane never did. A flat result across a
four-fold parameter change would have read as "the share does not matter". The
share is now parsed and clamped in one place for both lanes, and a test asserts
they resolve to the same value.

---

## The data DOES exist and is free — and it corrects what I concluded above

I wrote, two sections up, that settling the through-share needed data that
observes travel rather than counting vehicles at points, that such data costs
money, and that the question should be parked. **The first two claims were
reasoning from memory instead of looking, and the third followed from them.**

**FHWA's Traveler Analysis Framework** publishes county-to-county person-trip
tables for long-distance travel, free, as plain CSV of `origin FIPS,
destination FIPS, annual person trips`. It is derived from observed travel, so a
flow whose endpoints both lie outside a county and whose path crosses it *is*
travel passing through. `scripts/modeling/through_trips_taf.py`.

### What it says

Share of long-distance travel touching each county that passes through:

| county | through/day | ends there/day | through share |
|---|---:|---:|---:|
| Merced, CA | 64,472 | 13,854 | **82%** |
| Tulare, CA | 69,784 | 19,532 | **78%** |
| San Benito, CA | 27,351 | 8,443 | **76%** |
| Pueblo, CO | 17,962 | 5,708 | **76%** |
| Broomfield, CO | 6,608 | 2,365 | **74%** |

### And it does NOT support what I said about 0.35

FHWA's long-distance threshold is 100 miles, so these are *only* the long trips.
Converting to vehicles at an occupancy of 2.0 and comparing against each
county's modelled boundary crossings gives a **floor** on the cordon share:

| county | long-distance through, vehicles/day | modelled crossings/day | floor |
|---|---:|---:|---:|
| Tulare, CA | 34,892 | 194,000 | **18%** |
| Merced, CA | 32,236 | 260,000 | 12% |
| San Benito, CA | 13,676 | 160,000 | 9% |
| Pueblo, CO | 8,981 | 146,000 | 6% |
| Broomfield, CO | 3,304 | 320,000 | **1%** |

So the through share at a cordon is now bounded on **both** sides from free
data: **at least 1–18% from observed long-distance travel, at most 45–100% from
the count profiles.** The flat 0.35 sits inside that band in every county
measured.

**I said 0.35 was "unsupported and probably too low". The first half stands —
nothing was ever fitted to produce it. The second half does not: the new
evidence puts it comfortably inside the only band the data supports, and in
Broomfield the long-distance floor is 1%.** The count ceilings alone had made it
look low; they are ceilings, and reading a ceiling as a target is the error I
warned about two sections above and then made myself.

### What this changes about what to do

- **Still nothing adopted.** A band of 1% to 100% does not identify a value.
- **But the question is no longer parked on money.** Both bounds come from
  files anyone can download, and both narrow as the inputs improve: routing the
  TAF flows on a real network instead of straight lines tightens the floor, and
  denser count profiles tighten the ceiling.
- **The gap between the bounds is short-distance through travel**, which TAF
  does not cover and counts cannot separate. **OpenPlan is free and open source,
  so a paid dataset is not a fallback for it.** Where free data cannot close a
  gap, the band and a plain statement of what it does and does not establish IS
  the deliverable — a planner has to be able to reach every number in this
  product without a purchase order.
