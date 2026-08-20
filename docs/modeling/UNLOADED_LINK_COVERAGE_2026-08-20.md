# Four fifths of the network carries nothing, and that is where the tertiary signature lives

**Measured 2026-08-20** across the twelve `u2-*-base` runs (11 with a project
database), covering counties in California, Colorado, Oregon and Washington.
A dated measurement, not a claim about what a future run will do.

## The question

`COUNT_FACILITY_MATCHING_2026-08-20.md` closed with an open item: **57 of 1,011
matched count stations (5.6%) have a modelled volume of exactly zero**, the
median observed volume at those stations is 4,700, the largest is 156,346, and
**46% of tertiary-class stations are in that group**. Zero is not "a little
traffic". In an equilibrium assignment it means no path used the link.

That mattered because the long-standing **0.07× tertiary signature**
(`WHY_THE_MODEL_OVER_ASSIGNS_2026-08-17.md`) has been carried in this lane's
records as "a zone-resolution artifact untouched by finer zoning", which was a
label rather than a measurement.

## Two plausible explanations, both wrong

**"The station matched the wrong link."** It looked overwhelming at first: an
I-70 station at 136,000 matched to "North I-70 Service Road"; another to "West
I-70 Frontage Road South"; an I-5 station at 87,000 matched to "Pinkerton
Drive". That is the mirror image of the frontage-road defect fixed earlier the
same day. But it does not survive counting: only **3 of the 57** matched a link
whose name says frontage or service. The pattern is real and it is not the cause.

**"The validator read a link that was not there and reported zero."** This
repository's signature defect — a read that failed reported as a read that found
nothing — and `loaded_links.geojson` really does contain only 18,419 of the
network's 124,981 links. But `link_volumes.csv` carries all of them, every one
of the 106,562 links absent from the GeoJSON genuinely carries 0.0, and the
stations' links are present in the CSV with a real zero. **The volume is not a
failed read. It is zero.**

## What is actually happening

The assignment loads a skeleton. Travel moves centroid to centroid on shortest
paths, so with a few hundred zones only a small part of the road network is ever
on a path.

Measured **inside the analysis boundary only** — the network is built with a
buffer beyond it, and peripheral links legitimately carry nothing, so the
uncontrolled figure overstates this (network-wide it reads 85.3% for Jefferson
County CO against 79.1% inside the boundary):

| class | links inside the boundary | carrying zero | share |
|---|---:|---:|---:|
| motorway | 1,207 | 42 | **3.5%** |
| primary | 4,556 | 305 | **6.7%** |
| secondary | 3,585 | 370 | **10.3%** |
| trunk | 509 | 73 | **14.3%** |
| tertiary | 7,726 | 2,797 | **36.2%** |
| unclassified | 1,469 | 1,404 | **95.6%** |
| residential | 31,920 | 30,603 | **95.9%** |
| service | 23,784 | 23,730 | **99.8%** |
| **all** | **75,762** | **59,911** | **79.1%** |

(Jefferson County, CO. Every county measured agrees.)

| run | links inside boundary | all classes zero | tertiary zero |
|---|---:|---:|---:|
| 06047 Merced CA | 36,096 | 80.7% | 43.1% |
| 06069 San Benito CA | 7,802 | 82.6% | 45.4% |
| 06107 Tulare CA | 64,968 | 80.7% | 47.7% |
| 08014 Broomfield CO | 10,769 | 79.9% | 67.1% |
| 08059 Jefferson CO | 75,762 | 79.1% | 36.2% |
| 08101 Pueblo CO | 35,192 | 84.7% | 55.4% |
| 41005 Clackamas OR | 61,308 | 76.7% | 46.0% |
| 41029 Jackson OR | 29,159 | 80.6% | 61.7% |
| 41041 Lincoln OR | 12,060 | 81.0% | 59.2% |
| 53011 Clark WA | 68,584 | 78.5% | 33.7% |
| 53015 Cowlitz WA | 18,019 | 81.5% | 53.8% |
| 53077 Yakima WA | 43,148 | 84.4% | 69.4% |

**77–85% of the road network inside the study area receives no assigned traffic
at all**, in every county measured, in four states. The gradient by class is the
whole story: 3–7% of motorway and primary links are unloaded against 34–69% of
tertiary and 96–100% of residential, service and unclassified.

So a count station on a minor road has a large chance of sitting on a link the
model structurally cannot load, and its error is then a fact about the zone
system's reach rather than about the demand estimate. **That is what the 0.07×
tertiary figure has been measuring**, and it explains why finer zoning did not
move it: block groups are still far coarser than the neighbourhoods those roads
serve.

## What was done, and what was deliberately not

Both count-validation lanes now report `stations_on_unloaded_links` with a note
saying what it means. **The stations are NOT excluded and their errors stay in
every figure.**

Excluding them is the obvious move and it is wrong. It would remove exactly the
comparisons the model loses, which is a validator flattering its own model —
the same reasoning that keeps an unnumbered `CONNECTION` in the count set.

The size of that temptation is measurable. On Jefferson County, run twice with
the same code and the same counts, varying only whether the full-link lookup
lets a station match an unloaded link:

| | stations matched | median APE | on unloaded links |
|---|---:|---:|---:|
| loaded links only | 155 | **51.57** | 0 |
| full-link lookup | 163 | **55.81** | 9 |

Four points of headline accuracy sit on that switch. A future session that finds
the accuracy figure has improved should check this before believing it.

## What this does not settle

- Whether the unloaded links *should* carry traffic. A residential street with
  no through movement genuinely carries little; a tertiary road at 24,000
  observed vehicles clearly does not carry zero. This measures coverage, not
  correctness.
- Whether a finer zone system would close the tertiary gap. The 2026-08-17
  block-group experiment failed its pre-registered bar, and nothing here
  re-opens it — but that experiment was graded on corridor accuracy, not on
  network coverage, so it did not ask this question.
- Anything about the mean-driven figures. Noted while measuring and still open:
  trunk's median volume ratio is 2.65 while its **mean is 239**. Medians in this
  lane's published figures stand; any metric fitted or gated on a mean is being
  set by a handful of stations.
