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

**Measured**: external traffic already contributes more vehicle-miles than the
county's entire published daily VMT in four of the five development counties.
It cannot absorb a multiplier.

So the cap is currently the only thing bounding a flat per-crossing guess. The
order matters: **replace the guess with observed data first, then lift the
cap.** 58% of the gateways in these five counties have a published count
station within 3 km of the crossing, so most of them can be seeded with a real
AADT rather than a constant, falling back to the class figure elsewhere and
saying which is which.

Doing it the other way round would take a model that over-assigns 2.1x and make
it worse, while the headline "more crossings modelled" would read as an
improvement.
