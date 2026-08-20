# Short-distance through travel, from a source the record said did not exist — pre-registration

> **Written BEFORE any routed result, 2026-08-20.** The commit that adds this
> file is the pre-registration. Results are appended below it, once, and the
> rules here are not edited afterwards.

## The gap this addresses

`TRIP_LENGTH_CALIBRATION_2026-08-17.md` bounded the share of boundary-crossing
traffic that passes through a county rather than stopping in it:

- **floor 1–18%**, from FHWA's TAF long-distance flows routed on the FAF5
  network;
- **ceiling 45–100%**, from published count profiles;
- the flat `GATEWAY_PASSTHROUGH_SHARE = 0.35` sits inside that band everywhere.

and closed with the reason it could not be narrowed:

> The gap between the bounds is short-distance through travel, which TAF does
> not cover and counts cannot separate.

That matters more than any other open number in this lane, because
`WHY_THE_MODEL_OVER_ASSIGNS_2026-08-17.md` measured that **a median 61% of all
modelled vehicle-miles is traffic injected at the boundary** (range 25.7–82.6%),
computed from a flat per-class daily figure — motorway 15,000, trunk 9,000,
primary 6,000 — "identical in every county in the United States and observed
nowhere."

## The source, and why it is not a new dependency

**LEHD LODES origin–destination files.** They give home-block to work-block
commute flows for every county pair in the United States, free, no key. This
repository already downloads and streams them
(`workers/aequilibrae_worker/lodes.py::download_lodes_od`), and its aggregator
takes an arbitrary GEOID length, so `geoid_len=5` yields county pairs from
tested code.

Routing them needs nothing new either. `routed_taf_through_trips.py` reads a
three-column `origin,destination,flow` CSV and routes it on the FAF5 strategic
network. LODES county pairs written in that shape go through the same proven
router unchanged — an adapter, not a second implementation.

**Measured before writing this, to check the magnitude is worth the work:**
Colorado's LODES8 2022 OD aggregates to 1,534,044 inter-county commuters in 82
seconds. On the Boulder–Denver axis that Broomfield sits astride, twelve county
pairs alone carry 130,945 one-way commuters. Broomfield's TAF long-distance
through floor is 3,304 vehicles a day. Commuting is on a different order of
magnitude, and no routing was needed to see that.

## What will be measured

Colorado's three development counties — **08014 Broomfield, 08059 Jefferson,
08101 Pueblo** — using CO `main` + `aux` LODES parts, routed on FAF5, boundaries
taken from the runs already on disk.

1. **Routed commute trips passing through each county** — neither endpoint in
   it, route crossing it.
2. That figure as **daily vehicle trips**, stated with its occupancy and
   trips-per-worker assumptions written down, against each county's **modelled
   boundary crossings**.
3. The **unroutable share**, reported rather than dropped, exactly as the TAF
   run reported its 39,100 unreachable pairs per county.

## What each answer will mean, fixed in advance

- **Routed commute through-travel is a large multiple of the TAF floor**: the
  1–18% floor is confirmed as a floor on LONG-DISTANCE travel only and is
  useless as an estimate of through travel. The band narrows from below.
- **It is comparable to the TAF floor**: short-distance through travel is
  smaller than expected, the existing band stands, and 0.35 keeps whatever
  support it had.
- **It exceeds the count-derived ceiling**: something is wrong in one of the two
  measurements, and the disagreement is the finding — report it, change nothing.

## What this CANNOT do, stated before the number exists

**It cannot on its own license a change to `GATEWAY_PASSTHROUGH_SHARE`.**
Commuting is roughly a fifth of all trips. A commute-only through share is a
component of the answer, not the answer, and adopting it as the parameter would
be fitting a whole to one of its parts — the same error as the gamma sweep.

It also cannot see: non-work through travel of any distance, trips whose route
the FAF5 strategic network does not carry, or the difference between a worker
and a daily vehicle trip, which is an assumption here and not a measurement.
LODES counts jobs, not journeys: telework, non-daily schedules and multi-job
workers all sit between its number and a road.

What it CAN do is replace "a source this lane does not have yet" with a measured
lower bound that includes short trips.
