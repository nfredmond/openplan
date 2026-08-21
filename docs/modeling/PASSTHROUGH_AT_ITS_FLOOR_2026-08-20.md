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
