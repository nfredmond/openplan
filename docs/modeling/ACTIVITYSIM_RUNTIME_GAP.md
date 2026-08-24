# ActivitySim: what stood between OpenPlan and a trip list, and what closed it

> **DATED RECORD — first written 2026-08-16 describing an OPEN gap; rewritten the
> same day when the gap closed.** Everything below was measured against
> ActivitySim 1.5.1 and a real Nevada County run, not recalled. Re-measure before
> trusting any count here: the example configurations change between releases.

## The gap is CLOSED. ActivitySim runs an OpenPlan study area.

Measured 2026-08-16 on Nevada County, California (26 tract zones):

| | |
|---|---|
| Households simulated | 42,392 (fitted from real Census PUMS records) |
| Persons | 100,382 |
| Wall clock | **164 seconds** |
| Peak memory | 3.0 GB |
| Trips produced | **312,385** |
| Configuration | ActivitySim's stock `prototype_mtc`, unmodified |

The route is `scripts/modeling/activitysim_mtc_inputs.py` plus
`build_activitysim_input_bundle.py --population census --config-package mtc`.

## How it was closed, and why the stock configuration is untouched

The blocker was the skims. OpenPlan wrote one matrix; the stock specifications
reference **155 distinct skim names**, and the stock skim file contains **826
matrices** (the difference is 15 `*_WAIT` families the shipped specs never
read, plus the period suffixes).

Rather than shrink the model or author coefficients, the adapter now emits the
whole stock inventory:

- **Auto times** — real free-flow travel time from the OpenPlan network,
  written identically into all five time periods. Congestion by time of day is
  not represented, and every artifact says so.
- **Auto and non-motorised distances** — real routed network distance in miles.
- **Transit and tolls** — zero, in every family and period. This is not a claim
  that no transit exists: the stock specifications test `TOTIVT > 0` to decide
  whether a transit alternative is available at all, so an all-zero transit skim
  is the configuration's own documented way of saying "no transit service is
  represented in this run."

The bundle's own `settings.yaml` is a small overlay (`inherit_settings: True`)
passed as the FIRST `-c`, with the untouched stock directory as the second.
Nothing in site-packages is edited. The bundle records a SHA-256 over every
stock configuration file, and `workers/activitysim_worker/runtime.py`
recomputes it before every run — a stock directory that has changed since the
bundle was built fails the run rather than quietly running something else.

Two traps that cost real time, recorded so the next session does not pay again:

1. **A bracket-only scan of the specs misses six skim names.** `accessibility.csv`
   and `annotate_persons_workplace.csv` reference the generic `WLK_TRN_WLK_*`
   family with tuple syntax — `skim_od[('WLK_TRN_WLK_IVT', 'AM')]` — not
   `skims['NAME']`. The scan in `required_skim_names` reads both spellings.
2. **The screening skim OMX is indexed by aequilibrae NODE id, not zone id.**
   The node ids are minted above the maximum OSM node id, so they do not
   necessarily sort in zone order. `zone_row_positions` composes the OMX's own
   index with the run's recorded centroid map instead of assuming; a mutation
   that replaced it with positional order is caught by a test whose fixture
   deliberately reverses the two orderings.

## What the model then said, and why it must not be quoted as local behaviour

| Mode | Share |
|---|---:|
| Drive alone | 48.2% |
| Walk | **17.5%** |
| Shared ride 2 | 15.3% |
| Shared ride 3+ | 11.7% |
| TNC / taxi | 5.9% |
| Bike | 1.4% |
| Transit | 0.0% (disabled by construction, see above) |

**A 17.5% walk share in a rural county is the borrowed-coefficient problem
speaking out loud.** `prototype_mtc` is estimated for the San Francisco Bay
Area. The synthetic population underneath it is genuinely local — fitted from
real Census microdata to each zone's published totals — and that makes the
output *more* dangerous rather than less, because a locally-fitted population
lends the behaviour an authority it has not earned.

This remains the honesty bottleneck for the dual-model lane. Nothing produced
through this path may rise above screening grade. The three ways out, in
increasing order of work, are unchanged: name it and let it set the claim tier
(what the code does today); transfer the coefficients against stated local
evidence; or estimate locally from a household travel survey most agencies do
not have.

## What would tell you this document is stale

- ActivitySim's example set changes, or `prototype_mtc` is replaced. Re-run
  `python scripts/modeling/activitysim_mtc_inputs.py`, which counts the skim
  requirement live and prints the specs digest.
- The stock configuration digest recorded in a bundle stops matching the
  installed one. The worker will say so by refusing to run.
- A published transferable coefficient set for small rural regions appears.
  That would collapse the remaining blocker, and it is worth checking for
  during the landscape review that `OPEN_SOURCE_MODEL_LANDSCAPE.md` schedules.
