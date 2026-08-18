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
