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

---

## RESULT — 2026-08-20. The prediction is NOT supported, and the falsifier never fired.

### The falsifier is void, said first because it bounds everything below

**Pueblo seeded 0 of its 8 crossings.** No published count sits near any of
them, so both "seeded" Pueblo arms are byte-identical to their flat
counterparts — same error, same vehicle-miles, same external trips. That is the
inert case the pre-registration named, and it means **the 2×2 collapsed to a
1×2 and the Broomfield result is uncontrolled.** Every reading below carries
that.

Broomfield seeded **4 of 8**, raising boundary crossings from 320,000 to
**591,000 a day** — an 85% increase.

### Broomfield, with the station-set confound removed

Seeding consumes counts, and `assert_counts_not_reused_for_grading` correctly
held three of them out — the I-25 and US-36 crossing stations. So the seeded
arms grade 18 stations and the flat arms 21, and a naive comparison would
credit seeding with the removal of three hard stations. The middle column fixes
that by grading every arm on the 18 stations all four have in common.

| arm | median APE, common 18 | as published | network VMT | crossings/day |
|---|---:|---:|---:|---:|
| flat, 0.35 | 66.4% | 73.5% | 2,151,732 | 320,000 |
| flat, 0.54 (floor) | 67.0% | 69.9% | 1,927,385 | 320,000 |
| **seeded, 0.35** | **55.6%** | 55.6% | 3,724,250 | 591,000 |
| seeded, 0.54 (floor) | 61.9% | 61.9% | 3,146,642 | 591,000 |

**Seeding really does improve count agreement — 10.8 points on an identical
station set** (66.4% → 55.6%), confirming the 11 points the original study
reported and showing it was not a sample artifact.

**And raising the pass-through share on top of it does not rescue the
vehicle-miles.** Seeded runs carry 3.1–3.7 million vehicle-miles against
1.9–2.2 million flat: seeding still roughly doubles them, at either share.
Worse, on counts the floor makes seeding *worse*, 55.6% → 61.9%.

Against the rule fixed in advance, this is the second outcome:

> **Seeding + floor still worsens vehicle-miles**: seeding stays off, and the
> reason is no longer "we did not try it with a better share". The remaining
> suspect becomes the crossing volume itself rather than its disposition.

### Why the test was underpowered, which is the useful part

At 0.54, a seeded Broomfield still gives **272,000 vehicles a day a destination
inside a county of 33 square miles and about 75,000 residents** — some 3.6
external arrivals per resident. That is not a plausible amount of travel to
terminate there, and no share this experiment was permitted to test would have
made it one.

The floor is 54% because **commuting is the only through travel LODES can see.**
The plausible true share for a county bisected by US-36 and I-25 is far higher —
85–95% would not be surprising — and the count-profile ceiling for such
crossings runs to 100%. **The gap between a commute-only floor and the plausible
truth is now the thing to close**, and it is the same gap the through-travel
pre-registration named when it said commuting is about a fifth of trips.

So the record's August hypothesis — that seeding failed because the share was
wrong — is **tested and not supported at the share the evidence currently
licenses**. It is not refuted at the share the county probably has.

### A refinement of this morning's pass-through result

`PASSTHROUGH_AT_ITS_FLOOR_2026-08-20.md` reported that moving Broomfield to its
floor improved median error 3.6 points. That is correct on that run's own 21
stations. Decomposed here, **the improvement is concentrated in the three
stations nearest the boundary crossings**: on the 18 stations away from them the
same change reads 66.4% → 67.0%, marginally worse.

Mechanically that is what the parameter should do — it moves crossing volumes,
so it moves the stations near crossings. But it means the earlier figure is not
evidence of a general improvement across the county's roads, and quoting it as
one would overstate it. The direction of the vehicle-mile effect (−10.4%) is
unchanged and remains the stronger signal.

## What is NOT adopted

Seeding stays **off** and `GATEWAY_PASSTHROUGH_SHARE` stays **0.35**, as the
pre-registration bound. One county with four seeded crossings and a void control
is not grounds for either.

What has been learned is where to look: **not at the disposition of boundary
traffic, but at its volume — and at a through share whose floor is known to be
far below its truth.**
