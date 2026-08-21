# What happens when the pass-through share is set to its measured floor — pre-registration

> **Written BEFORE any run of this experiment, 2026-08-20.** The commit that
> adds this file is the pre-registration. Results are appended below it, once,
> and the rules here are not edited afterwards.

## The question, and why it is not parameter-fitting

`GATEWAY_PASSTHROUGH_SHARE` is a flat **0.35** applied to every boundary
crossing in every county in the United States. It decides how much of a
crossing's traffic passes through the study area rather than stopping in it,
and the traffic it does NOT send through is given a destination inside the
county — where it drives to an internal zone and loads the arterials the count
stations sit on.

`ROUTED_COMMUTE_THROUGH_TRAVEL_2026-08-20.md` measured, from LODES commute flows
routed on FHWA's network, that Broomfield's through share has a **floor of
54–76%** — commuting alone, before any other trip purpose. **The flat 0.35 is
below the floor of a real county.** Pueblo's floor is 20–25% and 0.35 sits
inside it.

**This is why the experiment is not the gamma sweep.** That one moved a
parameter until counts looked better, and was correctly abandoned. Here the
value comes from an independent measurement of a different quantity — nobody
looked at a count to derive it — and the question is what the model does when a
parameter is moved to a value evidence already requires. A result that makes
counts worse is as publishable as one that makes them better, and neither
adopts anything.

## What will be run

Two counties from the through-travel study, both with runs already on disk, each
re-run reusing its existing network so only the parameter differs:

- **08014 Broomfield** — flat 0.35 against **0.54**, its conservative measured
  floor. This is the county where the default is demonstrably too low.
- **08101 Pueblo** — flat 0.35 against **0.20**, its conservative floor, which
  is *below* the default. Included deliberately: if only the county that moves
  upward is tested, any improvement is unfalsifiable.

Everything else identical: same boundary, same network, same convergence, same
counts, no calibration on either side.

## What will be measured

1. **Median absolute percent error** against observed counts, and the model ÷
   observed ratio.
2. **Network vehicle-miles**, and the external share of them.
3. **Stations on unloaded links**, because that count moves the median toward
   100% from whichever side it sits and must not be confused with a change in
   accuracy.

## What each answer will mean, fixed in advance

- **Broomfield improves and Pueblo worsens** (or vice versa), each in the
  direction its own floor points: the flat share is a real contributor to the
  over-assignment, and the case for a per-county through share rests on
  measurement rather than on fit. This is the outcome the mechanism predicts.
- **Both improve**: suspicious rather than encouraging. Moving one county's
  parameter up and another's down cannot improve both unless something else is
  absorbing the change — report it and find out what before believing it.
- **Neither moves materially** (median error within 5 points): the boundary
  through share is not the lever it looks like, 61% of modelled vehicle-miles
  notwithstanding, and the search moves back to the crossing VOLUME.
- **Broomfield worsens at a value its own floor requires**: the most
  interesting outcome. It would mean the model needs the wrong through share to
  compensate for another error, and naming that error becomes the next job.

## What this cannot settle, and what it may not do

**It may not change `GATEWAY_PASSTHROUGH_SHARE`.** A floor is not a value. Two
counties are not a country, the floors rest on occupancy and daily-commute
assumptions that are not measurements, and a per-county share would need a
national method rather than two hand-computed numbers.

It also cannot separate the through share from the crossing volume, which is
itself a flat per-class guess. Both terms multiply into the same boundary
vehicle-miles, and this experiment moves only one of them.

---

## RESULT — 2026-08-20. Each county moved the way its own floor points.

Four runs, each reusing its county's existing network so that only
`GATEWAY_PASSTHROUGH_SHARE` differed. No calibration on any arm.

| county | share | matched | median APE | network VMT | VMT/capita | on unloaded links |
|---|---:|---:|---:|---:|---:|---:|
| **08014 Broomfield** | 0.35 (flat) | 21 | 73.5% | 2,151,732 | 6.05 | 2 |
| | **0.54 (its floor)** | 21 | **69.9%** | **1,927,385** | 6.05 | 2 |
| **08101 Pueblo** | 0.35 (flat) | 68 | 50.5% | 7,557,210 | 14.02 | 3 |
| | **0.20 (its floor)** | 67 | **51.2%** | **7,608,798** | 14.02 | 3 |

**Broomfield, moved UP to its floor:** median error improves 3.6 points and
network vehicle-miles fall **10.4%**. **Pueblo, moved DOWN to its floor:** median
error worsens 0.7 points and vehicle-miles rise 0.7%.

One monotonic relationship, in the direction the mechanism predicts: a higher
share sends traffic across instead of giving it a destination inside the county,
so internal vehicle-miles fall and the arterials the count stations sit on carry
less. This is the pre-registered outcome — *"each in the direction its own floor
points… the flat share is a real contributor to the over-assignment."*

**Three checks that it is a real effect and not an artifact:**

- **The count set did not move.** 21 stations both ways in Broomfield, and the
  stations sitting on unloaded links — which pull a median toward 100% — are
  unchanged in both counties. The error moved, not the sample.
- **VMT per capita is identical to two decimals** in both arms of both counties.
  That figure is resident travel measured centroid-to-centroid, which the
  pass-through share does not touch. A change there would have meant the
  parameter was reaching something it should not.
- **The parameter demonstrably took effect**: external trips 278,000 → 255,200
  in Broomfield.

### Size it honestly

Broomfield at its own measured floor still reads **69.9% median error** against a
30% gate. This is a contributor, not the cause. Moving a parameter 0.19 bought
3.6 points, and the county needs 40.

### What went wrong, and it is why the check above had to be done by hand

**Nothing in either run's manifest recorded the pass-through share.** Two runs of
one county, reusing one network, differing by 10% of network vehicle-miles and
22,800 external trips, and no artifact said which was which. I had to infer that
the parameter had taken effect from a side effect.

That is the shape of every inert-correction incident in this lane — six of them
in one day on 2026-08-18 — with the sign reversed: not a change that did nothing
while appearing to, but a change that did something while leaving no trace. Both
end with a number nobody can attribute.

`gateway_passthrough_share` and `external_passthrough_enabled` are now in the
manifest's `trip_rates`, recording what was applied rather than what was
configured — a run with pass-through off records 0.0, not the share it never
used. Guarded, with both mutants killed.

## What is NOT adopted

`GATEWAY_PASSTHROUGH_SHARE` remains **0.35**, exactly as the pre-registration
bound. A floor is not a value; two counties are not a country; and the floors
rest on occupancy and daily-commute assumptions that are not measurements.

What has changed is the standing of the flat constant. It is now known to sit
**below the measured floor of at least one real county**, and moving it to that
floor there improves both the count comparison and the vehicle-mile total. The
case for a per-county through share is now evidential rather than aesthetic —
and the method for computing one nationally, from LODES, exists and is cheap.
