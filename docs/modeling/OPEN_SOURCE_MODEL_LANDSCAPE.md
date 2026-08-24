# Open-source travel modelling: what else is out there

**Reviewed 2026-08-15. Next review due 2027-02-15** (roughly every six months, or
sooner if a run hits a wall the current engines cannot get past).

This exists because the engines OpenPlan builds on change, and recalling what was
true a year ago is not the same as checking. It records what was looked at, what
was chosen, and — most usefully — *what would change the answer*.

## What OpenPlan uses today

| | Role | Status here |
|---|---|---|
| **AequilibraE** | Trip-based demand + network assignment | Runs; produces the county number |
| **ActivitySim** | Activity-based demand | Wired but preflight-only; see the dual-model plan |

### Status addendum — 2026-08-23

The ActivitySim row above records the 2026-08-15 review and is now stale.
OpenPlan has since executed ActivitySim for a real study area and converted its
trip list into the shared AequilibraE assignment and corridor-agreement path;
the measured closure is documented in
[`ACTIVITYSIM_RUNTIME_GAP.md`](ACTIVITYSIM_RUNTIME_GAP.md). Execution is no
longer the blocker. The unresolved scientific limit is the borrowed regional
behavioral coefficients: a successful run outside their estimation region does
not by itself support a locally calibrated claim.

## What else was reviewed, and why it was not adopted

**MATSim** — agent-based transport simulation with iterative replanning: agents
re-plan across repeated iterations until travel choices settle. Genuinely the
leading open-source agent-based option and strong at large scale. Not adopted:
it is a Java toolchain, which would add a second language runtime to a Python
worker stack, and its replanning loop is a poor fit for a six-minute screening
run that a planner triggers from a web page. Revisit if OpenPlan ever needs
within-day dynamics or policy experiments (congestion pricing, cordon tolls)
that a static assignment cannot express.

**SUMO** (Eclipse, from the German Aerospace Center) — microscopic traffic
simulation, vehicle by vehicle. Excellent at intersection behaviour, signal
timing, and vehicle dynamics. Not adopted: it answers a different question.
OpenPlan's corridor question is "how much traffic uses this road on an average
day", which is a demand-and-assignment question; SUMO's strength begins after
you already know that. It would be the right tool for a future intersection or
signals module, not for this one.

**The pattern worth knowing:** ActivitySim is a *demand* model and SUMO/MATSim
are *simulation* models, and the common professional pairing is to generate
demand with one and simulate it with the other. OpenPlan already does the
equivalent — AequilibraE supplies both the assignment and, today, the demand.
That is exactly why the dual-model plan holds the network and assignment
constant and swaps only the demand model: it is the same pairing logic, applied
as an experiment rather than a pipeline.

## Things worth knowing about ActivitySim specifically

- Administration of the ActivitySim project moved from AMPO to the **Zephyr
  Foundation in 2025**. Current documented release line is **v1.5.x**.
- The consortium of member agencies (MPOs, DOTs) sets development priorities;
  **membership is an annual contribution in the tens of thousands of dollars.**
  This does not affect OpenPlan: the software is free and openly licensed, and
  membership buys influence over the roadmap, not access. Recorded here so the
  figure is never mistaken for a cost of using it.
- It was first built for the San Francisco Bay Area's nine-county region. **Its
  example configurations carry the behaviour of the regions they were estimated
  for.** Running one unlabelled somewhere else produces output that looks like
  an activity-based model and encodes another region's behaviour — which is why
  the dual-model plan treats the coefficient source as a claim-tier input.

## What would change the answer

Check these at the next review rather than re-reading the same landing pages:

- An open-source **synthetic population** generator that works nationally from
  Census PUMS without per-region setup. This is the single biggest blocker to
  ActivitySim being a genuinely independent second method here.
- An assignment engine that is materially faster or better calibrated than
  AequilibraE for a county-scale network, or that handles external/cordon
  demand natively.
- Anything that turns a national road network into a routable, capacity-attributed
  graph without the OSM download that currently costs 63% of every run's wall
  clock.
- Movement in ActivitySim toward smaller-region or "starter" configurations
  aimed at agencies without an existing calibrated model — that would directly
  reduce prerequisite 3 in the dual-model plan.

## Sources consulted, 2026-08-15

- [MATSim](https://matsim.org/)
- [ActivitySim documentation, v1.5.1](https://activitysim.github.io/activitysim/v1.5.1/)
- [ActivitySim on GitHub](https://github.com/ActivitySim/activitysim)
- [ActivitySim consortium updates (RSG)](https://rsginc.com/news/activitysim-consortium-releases-major-updates-to-activitysim-and-populationsim/)
- [ActivitySim white paper (RSG)](https://rsginc.com/activitysim-white-paper/)
- [ActivitySim at the Zephyr Foundation](https://zephyrtransport.org/ActivitySim/)
- [ActivitySim at AMPO Research Foundation](https://research.ampo.org/activitysim)
- [Eclipse SUMO](https://eclipse.dev/sumo/conference/)

**A caution about searching this topic:** most of what a general web search
returns for "best transportation modelling software" is search-optimised listicle
content with no authorship and no evaluation behind it. The sources that are
worth reading are the projects' own documentation, the Zephyr Foundation, AMPO,
and agency model user guides. Weight accordingly at the next review.
