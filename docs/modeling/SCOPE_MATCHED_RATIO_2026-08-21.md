# A scope-matched accuracy ratio, reported beside the old one — pre-registration

> **Written BEFORE the change, 2026-08-21.** The commit that adds this file is
> the pre-registration. Results are appended below it, once.

## What is being added

`THE_VMT_RATIO_IS_A_BRACKET_2026-08-20.md` established that the ratio behind
every "× too much driving" figure in this lane compares two different
quantities: network vehicle-miles over ALL loaded links, including the buffer
outside the county and all through traffic, divided by the county's residents
times a **state** per-capita rate.

`vmt_sources.py` now supplies the missing half — the county's own published
travel, derived from FHWA HPMS.

This wires the two together into a second ratio whose numerator and denominator
describe the same thing:

- **numerator** — the run's network vehicle-miles, **clipped to the analysis
  boundary** and **excluding the classes HPMS excludes** (local, rural minor
  collector), because HPMS Full Extent does not publish them by county;
- **denominator** — that county's HPMS vehicle-miles, same scope.

## What will NOT change

**`vmt_ratio` keeps its current definition and value.** Every figure this lane
has published rests on it, and silently redefining a number that appears in
dated records is how a record stops being one. The new figure is an additional
field with a different name, and both are reported together so a reader can see
the two constructions disagree.

**No default, threshold or gate moves.** Nothing consumes the new ratio.

## What each outcome will mean, fixed in advance

- **The scope-matched ratio is systematically closer to 1.0 than `vmt_ratio`**:
  a real share of the apparent over-assignment was the instrument, and the size
  of that share is the finding. It does not make the model accurate — the count
  comparison is a separate instrument that fails its gate independently.
- **It is systematically further from 1.0**: the model over-assigns more than
  the published figures say, and the lane has been flattering itself. Report it
  at least as loudly.
- **It moves counties in both directions** — the expected outcome, given the
  two corrections already measured pointed opposite ways for Broomfield and
  Pueblo. Then the instrument's error is not a bias to subtract but a spread,
  and no single corrected headline is available.
- **It cannot be computed for most runs**: the wiring is not worth keeping, and
  the reason is the finding.

## What it still cannot settle

The denominator remains a **derivation** at 2018 vintage against 2022–23 model
counts, and FHWA warns its aggregates do not reconcile with Highway Statistics.
A scope-matched ratio is a better instrument, not a true one, and it must carry
those labels wherever it appears.
