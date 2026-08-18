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
