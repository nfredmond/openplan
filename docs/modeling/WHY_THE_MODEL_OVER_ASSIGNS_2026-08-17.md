# The over-assignment is trip LENGTH, and there is a nationwide way to check it

> **DATED RECORD — 2026-08-17.** Measured across the 24 counties of the
> agreement study, against published federal data. Every figure below is
> arithmetic over files on disk plus FHWA Highway Statistics 2022 table VM-2
> and Census Bureau 2022 population estimates.

## The finding

OpenPlan's screening model **generates about 2.2 times as much driving as
actually happens.**

| | |
|---|---|
| model daily VMT per capita, median over 24 counties | **~50** |
| published daily VMT per capita (FHWA 2022 ÷ Census 2022) | 22.1 (CA), 25.3 (CO), 23.6 (OR), 20.6 (WA) |
| **model ÷ real** | **2.16×** |

That figure is derived with **no reference to traffic counts at all**. It agrees
with the 1.78× over-assignment measured independently against 1,998 count
stations. Two different instruments, two different data sources, the same
answer: the model puts roughly twice as much traffic on the network as exists.

## Which half is wrong — and it is not trip generation

| | model | real |
|---|---:|---:|
| internal trips per capita | 3.57 | roughly 3.0–3.3 vehicle trips |
| external (through) trips per capita | 0.76 | — |
| **network miles per trip** | **11.63** | **~5.7** (22.1 VMT/capita ÷ ~3.9 trips) |

Correlation of each with how far a county overshoots:

| quantity | correlation with overshoot |
|---|---:|
| **network miles per trip** | **+0.93** |
| external share of demand | +0.37 |
| external trips per capita | +0.23 |
| internal trips per capita | −0.49 |

**Trip length explains it.** Trip generation is roughly right — about 10–15%
high, not 100%. The gravity model is sending every trip roughly twice as far as
real trips go, and that single quantity accounts for almost all the variation
between counties.

Everything previously observed falls out of this. Trips twice as long traverse
twice as much arterial network, which is why trunk reads 3.39× and primary
2.32× against counts while freeways read 0.87×; and why the model's own travel
distribution puts 37% of VMT on principal arterials where FHWA puts 21%.

## The lever

`screening_runtime.py` distributes trips with a gravity model whose deterrence
is `impedance ** -gamma`:

```
HBW_GAMMA = 1.8      home-based work
HBO_GAMMA = 1.5      home-based other
NHB_GAMMA = 1.2      non-home-based
```

A higher gamma decays distance faster and shortens trips. These are OpenPlan's
own screening defaults, not drawn from any published manual — the run's own
`model_assumptions()` says so — and nothing has ever fitted them to anything.

## Why this matters more than the number itself

**It is a calibration anchor available in all 50 states, with no traffic counts
needed.**

The four states whose DOT feeds OpenPlan can read are the only places a
corridor number can currently be checked. But FHWA publishes VMT by state every
year, and the Census publishes population every year, so **daily VMT per capita
can be computed for any state in the country** — and a study area's model can
be graded against it.

That does not make a corridor volume correct; a model can have the right total
travel distributed wrongly. But it catches the failure that is actually
happening here, which is a factor-of-two error in total travel, and it catches
it anywhere. The nationwide-calibration ambition previously had no anchor
outside four states. It has one now.

Two honest limits on the anchor:

- **State VMT per capita is not county VMT per capita.** A rural county with an
  interstate through it carries travel generated elsewhere; a bedroom county
  exports it. Grading a single county against its state's average has real
  spread, which is why the figure above is a median over 24 counties rather
  than a verdict on any one of them.
- **VMT per capita mixes residents' travel with through traffic**, and the
  model's external demand is a separate, cruder estimate. The correlations
  above say through traffic is not the driver, but it is noise in the anchor.

## What follows

Fitting gamma to close a factor of two is a real change to what every run
tells a planner, so it gets the same discipline as the agreement study: a
pre-registration naming the counties, the metric, and the decision rule, fitted
on development counties and confirmed on holdout ones. **A gamma fitted until
the counts look better would be exactly the trap this lane already documented**
— the anchor above is preferable precisely because it is independent of the
counts the result is then judged against.

---

## CORRECTION, 2026-08-18: the count instrument was reading low, and now the two instruments agree

**Everything above stands as written on 2026-08-17.** One number in it is
superseded: the count-based over-assignment of **1.78× is wrong. It is 2.11×.**

A count station on a divided highway measures both directions. OSM maps that
road as two one-way carriageways carrying half the traffic each, and the
validator was comparing the whole-road count against one of them. **26% of all
matched stations sit on a divided highway; 71% of motorway stations do.**

Re-graded on the **same 1,983 stations**, same runs, same matching — only the
comparison corrected:

| class | stations | before | **after** | on a divided highway |
|---|---:|---:|---:|---:|
| primary | 822 | 2.04 | **2.23** | 19% |
| trunk | 491 | 2.41 | **2.92** | 32% |
| secondary | 334 | 1.30 | **1.38** | 7% |
| motorway | 239 | 0.78 | **1.22** | 71% |
| tertiary | 97 | 0.07 | **0.07** | 1% |
| **all** | **1,983** | **1.78** | **2.11** | 26% |

Median absolute error rises 100.0% → 110.9%, because the model was
over-assigning and the correction reveals more of it rather than less.

### Why this matters more than a number moving

**The two instruments now agree almost exactly.** Published VMT per capita said
2.16×; corrected counts say 2.11×. Before the fix they said 2.16 and 1.78 — a
gap I had no explanation for and did not flag. They are measuring the same thing
and now say the same thing.

**Motorways are not under-assigned.** They read 1.22× — over-assigned, like
every other class except tertiary. The earlier 0.78 was an artifact of comparing
half a freeway to a whole-road count.

**So the claim that "the model is wrong in two directions at once"
(`TRIP_LENGTH_CALIBRATION_2026-08-17.md`) is now supported by one class, not
two.** Tertiary roads at 0.07 remain badly under-assigned, and that is a
zone-resolution artifact already measured as untouched by finer zoning — 97
stations, one of which is on a divided highway. Everything else is over-assigned
in the same direction, which is exactly the shape a single decay parameter can
move.

That does not make gamma the answer. It removes the specific evidence that had
been used to rule it out.
