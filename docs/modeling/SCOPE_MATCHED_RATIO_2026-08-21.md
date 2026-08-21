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

---

## RESULT — 2026-08-21. Both directions, so there is no corrected headline.

Wired into `gamma_fit_analysis.grade_run` as a `county_scoped` block reported
beside `vmt_ratio`, which is unchanged in definition and in value.

| county | `vmt_ratio` (unchanged) | scope-matched | move |
|---|---:|---:|---:|
| 08014 Broomfield | 1.049 | **0.853** | −0.196 |
| 08101 Pueblo | 1.666 | **1.737** | +0.071 |

**Broomfield falls below 1.0 and Pueblo rises further above it.** That is the
outcome the pre-registration called expected, and its meaning was fixed before
the numbers existed:

> Then the instrument's error is not a bias to subtract but a spread, and no
> single corrected headline is available.

So there is no "really it is 1.4×" to publish. The instrument was wrong by
different amounts in different directions, and the honest statement remains the
bracket.

### What the numerator dropped, reported rather than applied

| county | unclipped | outside the boundary | outside HPMS scope | scope-matched |
|---|---:|---:|---:|---:|
| Broomfield | 2,152,352 | 358,382 | 213,599 | **1,580,371** |
| Pueblo | 7,564,080 | — | — | **6,502,120** |

Broomfield loses 27% of its numerator to the two reductions, Pueblo 14%. Both
disclosures are in the output, and a test holds that they plus the remainder sum
to the unclipped total, so the two can never overlap into a figure larger than
the run drove.

### The judgement inside the class mapping, and why it is guarded

HPMS Full Extent excludes **local and rural minor collector** — not major
collectors. OSM `tertiary` is the closest class to a major collector, so it
**stays in the numerator**. Dropping it would remove 8.2% of the model's
vehicle-miles against a denominator that kept them, making the model look better
for a reason that has nothing to do with the model. A test fails if it is ever
added to the exclusion list.

### It degrades honestly, which was not hypothetical

The denominator needs a live HPMS query while `vmt_ratio` is computed from files
on disk, so a study that cannot reach the network must still grade. The first
run of this comparison returned `HPMS refused the query for Colorado_2018_PR
county 14: {'code': 500, 'message': 'The connection attempt failed.'}` — a
transient fault on FHWA's side. The block recorded `available: false` with that
reason and the run kept its other figures, rather than raising or reporting a
ratio built from nothing. It succeeded on retry.

## Still true

`vmt_ratio` is unchanged, no default or gate moved, and nothing consumes the new
figure. The denominator remains a **derivation** at 2018 vintage against 2022–23
model counts, carrying FHWA's own warning that its aggregates do not reconcile
with Highway Statistics — better instrument, not a true one.
