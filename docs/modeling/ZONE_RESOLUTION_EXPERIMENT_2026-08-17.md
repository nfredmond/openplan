# Does finer zoning fix the over-assignment? — pre-registration

> **Written BEFORE any run of this experiment, 2026-08-17.** The commit that
> adds this file is the pre-registration. Results are appended below it, once,
> and the rules here are not edited afterwards.

## The question

OpenPlan's screening assignment puts about **1.8× too much traffic** on counted
roads. That figure survived two rounds of cleaning the measurement (ramp counts
excluded, shared-link pairings resolved), so it is the model rather than the
counts — see `AGREEMENT_AS_ACCURACY_STUDY_2026-08-17.md`.

Four causes have already been tested and rejected: external demand share, zone
COUNT, the gateway cap, and connector road-class preference. What remains is a
structural suspicion rather than a parameter: **zone size is the model's spatial
resolution.** A trip that begins and ends inside one zone carries VMT and no
link volume at all, so with census-tract zones every local trip is either
invisible or forced onto the arterial network between two centroids. That
predicts exactly the measured signature — arterials 2–3.4× over, tertiary roads
at 0.01× — and it is not something any demand-side scalar can reach.

Census block groups are roughly three times finer than tracts. This asks whether
that resolution reduces the over-assignment.

**This is now testable because runtime stopped being a constraint** (Nathaniel,
2026-08-17: runs may take days). Block-group runs are several times slower;
that is the whole reason the question was never asked.

## What will be run

- **Counties: development half only** — 06069 (CA, small), 08014 (CO, small),
  06047 (CA, medium), 08101 (CO, medium), 06107 (CA, large). Five counties
  spanning all three size bands and two states. The holdout half of the
  agreement study is not touched.
- **Arms:** each county already has a tract-zoned run (`study-<fips>-base`).
  Each gets one block-group run, identical in every other respect — same
  boundary, same convergence settings (`rgap 0.0005`, 3,000 iterations), no
  calibration on either side, counts fetched the same way.
- Both arms are validated by the same code, which already excludes ramp counts
  and resolves shared-link pairings.

## What will be measured

Pooled across the five counties, and per county:

1. **Median absolute percent error** against observed counts.
2. **Median model ÷ observed ratio** — the over-assignment itself.
3. Share of stations within the 30% screening gate.
4. The same three **by road class**, because the defect is class-structured.
5. **Intrazonal trip share** — finer zones should lower it, and if it does not
   move, the mechanism under test did not actually change.

## The decision rule, fixed in advance

Block groups become the default **only if all three hold** on the pooled result:

- median absolute percent error improves by **≥ 15 points**, and
- the model ÷ observed ratio moves toward 1.0 by **≥ 0.15**, and
- **no road class with ≥ 20 stations gets materially worse** (its median error
  rising by more than 10 points).

Anything less is reported as measured, and the default stays tracts. A partial
improvement is a real finding about where the error lives; it is not a licence
to change what every planner's run does.

## What this cannot settle

Five counties in two states. If block groups help, the size of the help is
worth re-measuring on the holdout half before it is quoted anywhere. If they do
not, that is a strong negative result for the leading remaining hypothesis and
the search moves to the network itself — whether the model carries roughly the
right travel on too few parallel roads.

Block groups also cost one control in the population synthesiser: workers per
household (ACS B08202) is not published below tract level. That affects the
ActivitySim lane, not the trip-based model measured here, and is recorded in
`census_pums.py`.

---

## RESULT — 2026-08-17. Block groups do not clear the bar. Default unchanged.

Five development counties, tract runs against block-group runs, everything else
identical. Zone counts roughly tripled as expected (12→46, 63→164, 103→305).

| county | zones | median error | model ÷ observed | model VMT ÷ real |
|---|---|---|---|---|
| 06069 | 12 → 46 | 81.6% → 90.9% | 0.81 → 1.27 | 2.82 → 2.59 |
| 08014 | 24 → 52 | 70.5% → 70.2% | 0.34 → 0.43 | 1.41 → 1.42 |
| 06047 | 63 → 164 | 81.5% → 104.8% | 1.59 → 2.05 | 2.88 → 2.55 |
| 08101 | 58 → 153 | 85.1% → 90.7% | 1.70 → 1.55 | 1.99 → 1.97 |
| 06107 | 103 → 305 | 103.4% → 76.5% | 2.03 → 1.50 | 2.29 → 2.06 |

Pooled: median error **88.7% → 84.2%** (4.5 points), model ÷ observed **1.52 →
1.41** (0.10 toward 1.0), share within the 30% gate 20.6% → 20.8%.

**Against the rule fixed in advance — improve error by ≥15 points AND move the
ratio ≥0.15 toward 1.0 AND worsen no road class by >10 points — this FAILS on
the first two, and trunk roads worsen by 16.9 points. The default stays
tracts.**

Per county the result is not even consistent in sign: 06107 improved by 27
points, 06047 got 23 points worse. That spread across five counties is itself
the finding — zone resolution moves the number around without systematically
improving it.

### Why this is a coherent negative, not a disappointment

It matches the cause identified the same day
(`WHY_THE_MODEL_OVER_ASSIGNS_2026-08-17.md`): the model generates **2.16× the
real amount of driving**, because the gravity model sends trips roughly twice
as far as real trips go. Finer zones change where trips start and end; they do
not change how far the deterrence function sends them. The VMT ratio confirms
it — it barely moves (2.82→2.59, 1.41→1.42, 2.29→2.06) in exactly the counties
whose count-based error swings wildly.

**Finer zoning cannot fix a distance-decay problem, and now it has been
measured rather than assumed.** `--zone-geography block_group` remains
available for a study area where a planner wants the resolution; it is not the
default, and it is not a fix for the over-assignment.

### The cost, for anyone considering it anyway

Block-group runs took roughly 4-7 minutes each here against 2-4 for tracts, on
counties of this size, and the finest (06107, 305 zones) was slowest. That is
affordable under the runtime posture — it simply does not buy accuracy.
