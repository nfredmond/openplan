# Does finer zoning load more of the network? — pre-registration

> **Written BEFORE any measurement of this question, 2026-08-20.** The commit
> that adds this file is the pre-registration. Results are appended below it,
> once, and the rules here are not edited afterwards.

## Why this is being asked, and the trap in asking it

`UNLOADED_LINK_COVERAGE_2026-08-20.md` measured that **77–85% of the links
inside a study boundary carry no assigned traffic**, and that the share is
strongly class-structured: 3–7% of motorway and primary links against 34–69% of
tertiary and 96–100% of residential and service roads.

`ZONE_RESOLUTION_EXPERIMENT_2026-08-17.md` asked whether census block groups
reduce the over-assignment, pre-registered a three-part bar, and **block groups
failed it** — median error improved 4.5 points against a required 15, the
model÷observed ratio moved 0.10 against a required 0.15, and trunk roads got
16.9 points worse. The default stayed tracts. That experiment measured count
error, the over-assignment ratio, gate share, by-class error, and intrazonal
trip share. **It did not measure network coverage.**

**THE TRAP, NAMED BEFORE ANY NUMBER IS LOOKED AT.** Measuring a new quantity
after a pre-registered experiment returned an answer, and then treating the new
quantity as grounds to reverse the old decision, is result-shopping with extra
steps. It is the same move as fitting a scalar and reporting the improvement.

So this pre-registration binds itself:

- **This cannot reverse the block-group decision.** The 2026-08-17 rule was
  fixed in advance and failed on two of three clauses by wide margins. Nothing
  measured here changes what `--zone-geography` defaults to. If coverage
  favours block groups, the result is a documented property of a choice a
  planner may already make, not a new default.
- **The headline of the old experiment is not restated or replaced.** Its
  median-error table stands as published.

## The two questions

**Q1 — coverage.** Do block-group zones load a larger share of the road network
than tract zones, on the same county, with everything else identical?

**Q2 — was the old comparison partly a coverage comparison?** A count station on
a link the assignment never loaded scores a guaranteed 100% error that measures
reach rather than demand. If the two arms differ in *which* stations sit on
unloaded links, then part of the 2026-08-17 median-error difference is a
coverage difference wearing an accuracy label. This is a sensitivity check on a
published result, reported ALONGSIDE it, never in place of it.

## What will be measured

The five development counties and the exact arms the 2026-08-17 experiment used
— `study-<fips>-base` (tracts) against `bg-<fips>` (block groups), already on
disk, same boundary, same convergence, no calibration either side.

1. **Share of in-boundary links carrying zero assigned volume**, overall and by
   road class, per arm. Boundary-clipped, because the network is built with a
   buffer and peripheral links legitimately carry nothing.
2. **Matched count stations sitting on an unloaded link**, per arm.
3. **Median absolute percent error restricted to stations matched in BOTH arms
   and loaded in BOTH arms** — the fairer accuracy comparison — reported next
   to the published all-stations figure for the same pair.

## What each answer will mean, fixed in advance

- **Coverage improves materially with block groups** (in-boundary zero share
  falls by ≥5 points pooled): finer zoning buys reach, which is a real property
  worth telling a planner about, and it is recorded as such. It remains true
  that it did not buy accuracy.
- **Coverage does not move** (<5 points): the skeleton is set by something other
  than zone size — connector placement or the network itself — and the search
  for what the model is missing moves there. This is the more useful outcome.
- **Coverage gets worse with block groups**: report it plainly; it would mean
  more zones spread the same travel over more centroid connectors without
  reaching more road, which would be a genuine surprise.
- **On Q2:** if the both-arms-loaded restriction moves either arm's median error
  by more than 5 points, the published comparison was measuring coverage as
  well as accuracy and every future zone comparison must control for it. If it
  moves less, the old comparison was clean on this axis and that is worth
  knowing too.

## What this cannot settle

Whether the unloaded links *should* carry traffic. Coverage is not correctness:
a residential street with no through movement genuinely carries little. Only a
count on a link settles that for that link, and counts are sparse and biased
toward big roads. Nothing here licenses a claim that the model is missing
travel — only that it says nothing at all about most of the network.
