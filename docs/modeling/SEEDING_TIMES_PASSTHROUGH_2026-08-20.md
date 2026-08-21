# Seeded crossings × a measured pass-through share — pre-registration

> **Written BEFORE any run of this experiment, 2026-08-20.** The commit that
> adds this file is the pre-registration. Results are appended below it, once,
> and the rules here are not edited afterwards.

## The prediction this tests was made by the record, not by me

Boundary vehicle-miles are the product of two terms, and both are guesses:

- **how much traffic crosses** — a flat daily figure by road class, motorway
  15,000, trunk 9,000, primary 6,000, identical in every county in the country;
- **what share of it passes through** — a flat `GATEWAY_PASSTHROUGH_SHARE` of
  0.35, likewise everywhere.

Seeding the first from published counts is built (`gateway_counts.py`,
`OPENPLAN_SEED_GATEWAYS_FROM_COUNTS`) and **off**, rejected twice: counts
improve about 11 points, total vehicle-miles get worse. Both rejections held the
pass-through share at 0.35. `TRIP_LENGTH_CALIBRATION_2026-08-17.md` says why
that mattered, and names what it could not measure:

> Broomfield says what is actually binding. Its measured crossings are 66,500 a
> day against a flat cap of 20,000, so real volumes more than triple its
> boundary demand, and routing 35% across still leaves the rest flooding a
> county 33 square miles across. For a small county bisected by two interstates
> the true through-share is nowhere near 35%.
>
> So the next number to measure is `GATEWAY_PASSTHROUGH_SHARE` itself.

**That number is now measured.** `ROUTED_COMMUTE_THROUGH_TRAVEL_2026-08-20.md`
puts Broomfield's floor at 54–76% from commuting alone, and
`PASSTHROUGH_AT_ITS_FLOOR_2026-08-20.md` confirmed the mechanism moves the model
in the predicted direction. The two terms have never been tested together, and
they multiply.

## What will be run

A 2×2 per county, every arm reusing that county's existing network so nothing
but the two settings differs:

| | pass-through 0.35 (flat) | pass-through at the county's floor |
|---|---|---|
| **crossings flat** | already run | already run |
| **crossings seeded from counts** | new | new |

- **08014 Broomfield** — floor **0.54**, above the default. Where the record's
  prediction says the pair should work.
- **08101 Pueblo** — floor **0.20**, below the default. The falsifier: if only
  the county whose floor rises is tested, any improvement is unfalsifiable, and
  here seeding-plus-floor should be WORSE than seeding alone.

Seeding consumes published counts, so `assert_counts_not_reused_for_grading`
already refuses to grade the model on a station that set its own demand. Any run
that trips it is a failed run, not a result.

## What will be measured

Median absolute percent error, network vehicle-miles, matched stations, stations
on unloaded links, and how many crossings the seeding actually found a count for
— a "seeded" arm that seeded nothing is an inert run, not a null result.

## What each answer will mean, fixed in advance

- **Seeding + floor beats both singles in Broomfield, on counts AND on
  vehicle-miles**: the interaction is real, the two rejections of seeding were
  rejections of seeding-at-the-wrong-through-share, and the case for measuring
  both terms per county is made. The record predicted this.
- **Seeding + floor still worsens vehicle-miles**: seeding stays off, and the
  reason is no longer "we did not try it with a better share". The remaining
  suspect becomes the crossing volume itself rather than its disposition.
- **Pueblo improves too**: suspicious. Its floor moves the opposite way, so a
  gain on both would mean something other than these two terms is absorbing the
  change. Report it and find out before believing it.
- **Nothing moves materially**: boundary demand is not where the residual
  over-assignment lives, despite being 61% of modelled vehicle-miles, and the
  search moves inside the study area.

## What this may not do

**It may not turn seeding on, and it may not change the pass-through share.**
Two counties are not a country; the floors are commute-only and rest on
assumptions that are not measurements; and the crossing counts are sparse — 58%
of crossings have a station within 3 km, so a seeded arm is part-seeded and
part-default by construction. A default flip needs the national method, not two
good counties.
