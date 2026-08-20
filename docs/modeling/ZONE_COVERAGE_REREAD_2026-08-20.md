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

---

## RESULT — 2026-08-20. Coverage does not move. The old decision stands.

### Q1 — finer zoning buys almost no network reach

Five development counties, `study-<fips>-base` (tracts) against `bg-<fips>`
(block groups), both already on disk. Centroid connectors are excluded from the
denominator: block groups add roughly three times as many, and including them
would credit finer zoning for links it invented. With them removed the two arms
contain **exactly the same links**, which is the check that the comparison is
about loading rather than about network content.

| county | zones | in-boundary links | tract carrying zero | block groups | change |
|---|---|---:|---:|---:|---:|
| 06069 | 12 → 46 | 7,744 | 81.2% | 76.9% | −4.3 |
| 08014 | 24 → 52 | 10,678 | 79.7% | 78.2% | −1.5 |
| 06047 | 63 → 164 | 35,893 | 79.9% | 79.7% | −0.2 |
| 08101 | 58 → 153 | 34,999 | 82.4% | 80.2% | −2.2 |
| 06107 | 103 → 305 | 64,639 | 76.0% | 74.4% | −1.6 |
| **pooled** | | **153,953** | **78.9%** | **77.4%** | **−1.5** |

**Tripling the zone count buys 1.5 points of network coverage.** The
pre-registered threshold for "improves materially" was 5 points, so this is the
outcome the pre-registration called the more useful one:

> the skeleton is set by something other than zone size — connector placement or
> the network itself — and the search for what the model is missing moves there.

Tertiary roads move furthest and still do not move far: **38.9% → 31.3%**
unloaded (−7.6 points), leaving roughly a third of tertiary links carrying
nothing at three times the zone resolution.

### Q2 — the unloaded stations pull a median toward 100%, from whichever side it is on

A station on an unloaded link scores an absolute percent error of **exactly
100%**, because the model says zero. So it does not simply make a run look
worse. It drags the median toward 100 — penalising a county whose typical error
is below that, and **flattering one whose typical error is above it**.

Restricting each arm to the stations both arms graded and both loaded:

| county | tract, all | tract, common | move | bg, all | bg, common | move | unloaded (t/bg) |
|---|---:|---:|---:|---:|---:|---:|---|
| 06069 | 97.4% | 97.4% | 0.0 | 90.9% | 90.9% | 0.0 | 0 / 0 |
| 08014 | 76.2% | 73.1% | −3.1 | 67.8% | 61.5% | −6.3 | 2 / 2 |
| 06047 | 128.4% | 128.4% | 0.0 | 119.4% | 119.4% | 0.0 | 1 / 2 |
| 08101 | 87.8% | 87.5% | −0.2 | 97.6% | 93.3% | −4.2 | 3 / 2 |
| 06107 | 153.8% | **175.2%** | **+21.3** | 111.4% | 117.3% | +5.9 | 7 / 1 |

The pre-registered rule was 5 points. **An arm moves more than that in two of
five counties**, overwhelmingly Tulare (06107), which has seven unloaded-link
stations in its tract arm and a median error of 154% — so those seven
exactly-100% stations were holding its headline 21 points below where the
loaded network puts it. In the three counties with few unloaded stations the
restriction changes nothing.

So: mostly clean, and badly confounded exactly where the model is worst. **Any
future zone or network comparison must report unloaded-link stations
separately**, which both lanes now do.

### The incidental finding, and it is the one worth remembering

The two arms of the 2026-08-17 experiment, as stored on disk, **were not graded
by the same code**. The tract arms were validated between 05:50 and 07:33 that
morning; the block-group arms between 21:16 and 21:38 that night. Shared-link
resolution (`229df071`) landed at 13:16, in between. It shows in the files: the
tract arms carry an empty `shared_model_links` block, the block-group arms a
populated one, and the tract arms grade 394 stations against the block-group
arms' 302 — a 23% difference produced by the validator, not the model.

**Regrading both arms with identical current code closes it**: 305 stations
against 302, and a pooled median error of 105.2% against 100.0%, a 5.2-point
edge to block groups. The published table recorded 88.7% against 84.2%, a
4.5-point edge, on that day's code. **Same direction, same size, same verdict.**
The uncontrolled difference did not change the answer — but nothing in the
record said it was there, and it was found only by looking at the timestamps.

This is precisely what `validation_rules_version` was invented for the next day
(`09e4c897`), and both these runs predate the stamp, so neither carries one. Had
they, the app would have refused to read them as comparable.

### What this does and does not change

- **`--zone-geography` still defaults to tracts.** The pre-registration bound
  itself to this before any number was looked at, and nothing here is grounds to
  revisit it. The regrade agrees with the published verdict.
- **The coverage question is answered and closed**: zone size is not what makes
  the network a skeleton.
- **The search moves to connector placement and the network itself**, which is
  where the pre-registration said it would go if coverage did not move.
- **A properly controlled zone re-run is now cheaper than it was**, because both
  lanes stamp their rules version and report unloaded-link stations. Whether one
  is worth running is a priority call, not a finding.

---

## FOLLOW-UP, same day — what the skeleton is actually made of

The result above sent the search to connector placement and the network itself.
Measured on four counties, 395,000 minor links (tertiary, residential,
unclassified, service) against 570–924 centroid-connector endpoints, distance
from each link's centre to the nearest connector.

**Prediction stated before running:** if connector placement is the mechanism,
loaded minor roads sit markedly closer to a connector than unloaded ones; if the
shortest-path skeleton is, the two distributions look alike.

| run | loaded, median distance | unloaded | ratio |
|---|---:|---:|---:|
| 08059 Jefferson CO | 0.26 mi | 0.58 mi | 2.2× |
| 06107 Tulare CA | 0.50 mi | 1.08 mi | 2.2× |
| 41005 Clackamas OR | 0.39 mi | 1.59 mi | 4.1× |
| 53011 Clark WA | 0.33 mi | 1.51 mi | 4.6× |

For collectors alone the separation is sharper — 0.35 mi against 3.10 mi in
Clark County, a factor of nine. **Loaded minor roads are access stubs.**

### And proximity is nowhere near sufficient, which is the real finding

Share of minor links that carry any traffic, by distance to the nearest
connector (Jefferson CO; the other three agree):

| distance | links | loaded |
|---|---:|---:|
| 0.00–0.10 mi | 6,581 | **18.7%** |
| 0.10–0.25 mi | 19,078 | 10.4% |
| 0.25–0.50 mi | 25,564 | 8.0% |
| 0.50–1.00 mi | 17,410 | 5.7% |
| 1.00–2.00 mi | 22,055 | 1.4% |
| over 2 mi | 16,980 | **0.4%** |

Proximity multiplies the odds by about fifty. It still leaves **five of every six
minor links immediately beside a connector carrying nothing.**

**So a connector loads a PATH, not an AREA.** Each one attaches to a single
network node, so exactly one route leads away from it, and the minor roads that
get traffic are the specific links on that route — not the neighbourhood around
it. That is why tripling the connector count with block-group zones moved
coverage 1.5 points: three times as many connectors is three times as many thin
paths, not three times the area reached.

It also explains the collector result measured the same day
(`VMT_BY_CLASS_2026-08-20.md`): roughly the right total collector travel,
concentrated on the minority of collector links that happen to lie on a
connector's access path. Distributional, not volumetric.

### The honest limit of this measurement

Connectors attach at zone centroids, which sit in populated, road-dense places
that carry real traffic anyway. Proximity is therefore **associated** with
loading, not proven to cause it. The 18.7%-versus-0.4% gradient is real; the
causal share of it is not established here, and the block-group result is the
reason not to assume it is large.

### What this means for a planner, and it is a claim boundary rather than a bug

The model cannot say anything about a minor road that does not lie on a
connector's access path, and that is roughly 95% of them. This is what the
existing zone-resolution caveat means in practice; the number now quantifies it.
It is not a defect to be fixed by adding connectors — it is the resolution of a
screening model, and the honest response is to keep saying so on any surface
that shows a minor-road volume.
