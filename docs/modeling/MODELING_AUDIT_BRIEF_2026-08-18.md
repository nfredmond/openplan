# Audit brief: check this work, and find what I missed

**For whichever model picks this up — Fable 5, GPT-5.6 Sol, or a later one.**
Nothing here depends on which you are. Written by Opus 5 on 2026-08-18 about its
own work, at Nathaniel's request.

He wants an independent check and ideas I did not have. **Assume I am wrong
somewhere in here.** On the day this covers I was wrong seven times in ways I
caught myself, and once more that only Nathaniel caught — I told him the data to
settle a question "costs money" without looking. It is free, and finding it took
twenty minutes.

**So do not take any statement below on trust, including the ones that sound
measured.** Every number is reproducible from the repository. Check the ones your
conclusions rest on, and say which you checked.

**If you disagree with a judgment call, overrule it — but write down why before
you look at the number that would settle it.** Two calls in here are judgment
rather than measurement and are marked as such.

---

## The two judgment calls — overrule these if you disagree

Everything else in here is arithmetic you can re-derive. These two are choices:

**1. Nothing was adopted for the boundary through-share.** Three free sources
bound it (count profiles: ceiling 0.45–1.00; FHWA county-to-county trip tables:
floor 1–18%; a flat sweep: improves monotonically to the clamp). The band is
1%–100% and the flat 0.35 sits inside it, so I changed nothing. **You could
argue the count-derived per-road ceilings are better than one national constant
even as upper bounds, because they at least vary with the road.** I think that
trades a known-arbitrary number for a known-biased one; I am not certain.

**2. The holdout half was not read a third time** after the units were fixed.
It has said "agreement does not predict accuracy" twice, and the development
half now says it more strongly. I judged a third reading to be shopping for a
number rather than testing anything. **If you overrule this, write your
prediction down first.**

---

## The single sentence

OpenPlan's trip-based screening model assigned **2.2× as much traffic as
actually exists**; a day of work found the cause was three unrelated things —
a broken measuring instrument, boundary traffic routed into the county's
interior instead of across it, and person-trips assigned as if they were cars —
and the model now sits at **1.67×** with none of it fitted to anything. Both
demand models are in the same units for the first time, and the pre-registered
agreement study has been re-run on that footing.

---

## Read in this order

1. `docs/modeling/WHY_THE_MODEL_OVER_ASSIGNS_2026-08-17.md` — read the
   **CORRECTION** sections, not the body. The body's headline finding is wrong
   and says so.
2. `docs/modeling/TRIP_LENGTH_CALIBRATION_2026-08-17.md` — the pre-registration,
   then everything after `CLOSED 2026-08-18`.
3. `docs/modeling/AGREEMENT_AS_ACCURACY_STUDY_2026-08-17.md` — the re-read
   section at the end.
4. Memory: `over-assignment-is-boundary-traffic`,
   `count-comparison-read-half-a-freeway`, `free-through-trip-data-exists`,
   `openplan-is-free-no-paid-data-sources`.

---

## What I claim, and how to break each claim

### 1. The measuring instrument was broken three ways

| defect | scale | commit |
|---|---|---|
| whole-road counts compared to ONE carriageway of a divided highway | 26% of stations, 71% of freeway stations | `c26873fd`, `f527df2c` |
| ramp counts graded against the mainline they leave | 23% of stations | `1d011671` |
| one link graded once per station matched to it | 33% of stations | `5ecb9d67` |

National over-assignment moved **1.78× → 2.11×** on the *same* 1,983 stations.

**How to break it:** the carriageway pairing uses a fixed 0.0015° radius
(~150 m). Check it does not merge two genuinely different roads in a dense grid
— my tests use synthetic pairs, not a real downtown. Check
`corridor_volume` in `workers/aequilibrae_worker/count_validation.py`.

### 2. It is NOT trip length — that was my error

The original diagnosis compared network-VMT-over-ALL-trips (11.63) against
published-VMT-per-CAPITA-over-trips-per-capita (~5.7). Different quantities.
Measured properly with external demand switched off: **5.59 network miles per
internal trip against ~5.7 real. Internal trip length was already right.**

**How to break it:** `scripts/modeling/external_demand_share.py` computes the
internal figure by re-running with `--external-demand-scalar 0`. The subtraction
assumes assignment is additive; it is not, and the module says so. Quantify that
bias if you can — I only stated its direction.

### 3. The gamma sweep is closed, NOT ADOPTED

Every multiplier fails pre-registered criterion 1. At ×2.5 the mean internal
trip falls to 3.59 miles (real: ~9–10) and **count error still improves** —
better for the wrong reason, which the pre-registration existed to catch.

**How to break it:** the criteria are code now
(`grade_against_preregistered_criteria`). Check I did not weaken any threshold
between writing them and applying them. `git log -p` the file.

### 4. The two lanes disagreed about whether a car can cross a county

The worker routed 35% of a two-crossing route straight across since it was
written. The county-script lane had **no pass-through at all**, so every figure
I measured all day came from a model where boundary traffic entered the county
and came back out. Three implementations of the external-OD layer existed; one
was orphaned and pass-through-free.

**How to break it:** the shares now come from one place, but `main.py` still
builds its external OD inline rather than calling the shared builder. That is a
fourth implementation waiting to drift. Nobody has diffed the two constructions
line by line. **Do that.**

### 5. Person trips were assigned as vehicles — the largest single fix

`activitysim_demand_package.py` divides by occupancy and warns that not doing so
"would report the demand models disagreeing when what actually differed was the
unit." The trip-based lane did not do it. **The two models in OpenPlan's own
side-by-side comparison were assigned in different units.**

Fixed with NHTS 2022 Table 5-2 occupancies by purpose. Measured:
**VMT 2.26 → 1.68, count error 91.6% → 80.6%.**

**How to break it — and I think this is the most likely place for me to be
wrong:**
- **DONE after this brief was first written.** The scripts lane now calls the
  worker's mode-choice model, so walk and cycle trips are no longer assigned as
  cars. Auto share comes out 76.5–88.5% across the five counties, which brackets
  the national figure. Effect on VMT is small (1.68 → 1.67) and that is
  physically right — the trips removed are the short ones. Count error 80.6% →
  78.2%.
  **My first version of it returned a 98.5% auto share**, because AequilibraE's
  distance skim is in METRES and the mode model wants miles: it asked whether
  anyone would walk thirty-five thousand miles. A rural county with almost no
  walking is plausible, so the number survived until it was compared against the
  published non-auto share. **That is a seventh instance of the pattern below,
  and I made it.** With no transit skim the split is auto-versus-active only and
  claims no transit share.
- Is `HBW_PROD_RATE`'s basis (`max(workers, households × 0.35)`) a person-trip
  rate at all? I assumed yes from the provenance string. Verify.
- **DONE.** The agreement study has been re-run with both models in the same
  units (development half, 11 counties, both arms rebuilt on each county's
  original network). In Merced the two arms were 985,811 against 507,036 trips
  — a 94% gap that was almost entirely units; corrected, 551,232 against
  507,036, a difference of 8.7%.

  | | original | units fixed |
  |---|---:|---:|
  | trip-based error | 137.2% | **81.2%** |
  | activity-based error | 78.0% | **66.3%** |
  | trip-based lift | 0.98 | **0.69** |
  | activity-based lift | 1.11 | **0.58** |

  **Both models got much more accurate; agreement got LESS informative.** The
  answer is unchanged and stronger: agreement does not predict accuracy, and the
  most obvious alternative explanation for that has now been removed.

  **The holdout was deliberately not read a third time** — it has said no twice,
  the development half now says no again more strongly, and a third reading
  would be looking for a number rather than testing anything. **If you disagree
  with that call, it is a defensible thing to overrule — but say why first, in
  writing, before you look.**

### 6. The boundary through-share is bounded but unknown

Three free sources, all saying different things:
- **count profiles** (every through vehicle passes the route's lowest-volume
  point): ceiling 0.45–1.00, median 0.84
- **FHWA Traveler Analysis Framework**, county-to-county trip tables: 74–82% of
  *long-distance* travel passes through, which is a **floor of 1–18%** of all
  cordon crossings
- **a flat sweep**: both metrics improve monotonically to the 0.90 clamp without
  turning over — no optimum

Band: **1% to 100%.** The flat 0.35 sits inside it. Nothing adopted.

**How to break it:** the TAF path uses **straight lines between county
centroids**, not routes. Route them on a real network and the floor tightens
immediately — that is free and I did not do it. It is the single most
tractable open item in this document.

**2026-08-18 continuation:** the reusable routing seam now exists in
`scripts/modeling/faf5_routing.py`. It reads FHWA's free FAF5 national highway
geodatabase, respects AB-only, BA-only, and two-way links, minimizes published
free-flow time, fingerprints the exact network bytes, and writes a resumable
route cache. `through_trips_taf.py --route-cache` consumes that cache and
counts every missing or unreachable positive flow instead of falling back to a
centroid chord. A real-network smoke test loaded 346,374 nodes / 650,909
directed edges and routed an Alameda-to-Merced county path. The published file
also exposed two facts its data dictionary does not: 391 links use `DIR=-1`
(reverse-only), and free-flow time is numerically minutes. Both are now tested.

**The measurement itself has not been rerun yet.** The remaining job is to
route the relevant positive TAF OD pairs, feed the completed cache to the five
county calculation, and compare routed versus chord-based floors. Until that
happens, the 1–18% floor above is still the straight-line result.

---

## The state of the number, end to end

Same five counties, same networks, same stations, nothing fitted:

| stage | too much driving | error vs counts |
|---|---:|---:|
| start of 2026-08-18 | 2.29× | 97.4% |
| + boundary traffic can cross a county | 2.26× | 91.6% |
| + person trips divided by car occupancy | 1.68× | 80.6% |
| + walk and cycle trips removed | **1.67×** | **78.2%** |

**Check this table first.** If the arithmetic behind any row does not reproduce,
everything downstream of it is suspect. The runs are on disk as
`data/screening-runs/{study-*-base, pass-*, veh-*, units-*}` and the grading
recipe is in the commits.

## Things I know are still wrong and did not fix

0. **The model is still 1.67× too high and no single cause is left standing.**
   Every large lever has been measured: trip length (right), trip generation
   (right as person trips), units (fixed), boundary routing (fixed), boundary
   volume (bounded, not settled). What remains is either spread thinly across
   all of them or is something nobody has looked for. **That is the most
   valuable thing you could find and I have no candidate for it.**
1. **Tertiary roads carry 0.07× observed** — a 14× under-assignment on a whole
   road class, untouched by finer zoning, unexplained. Nobody has looked since.
2. **`main.py`'s inline external OD** (see 4 above).
3. ~~No mode split in the scripts lane~~ — done; see 5 above.
4. **`OPENPLAN_MAX_GATEWAYS = 8`** while counties have 25–47 crossings.
   CLAUDE.md says lift it; I showed lifting it *first* makes things worse
   because each crossing gets its flat figure independently. Order matters.
5. **Seeding real AADT into crossings is built and OFF** — it improves count
   agreement and worsens total VMT. Re-measure it now that both pass-through
   and the occupancy fix exist; it has only been tested against the old model.

---

## The pattern I most want you to check for

**Six times in one day I found a correction that was present, tested, and never
reached by the data it needed.** Each produced a plausible number:

| what was dropped | how it read |
|---|---|
| `is_one_way` in the validator's candidate dicts | "freeways are under-assigned" |
| `direction` in its project-database query | "only 9 of 239 freeway stations are divided" |
| `name` on the gateway record | "no county has a count near its crossings" |
| the whole of `gateway_counts.py` (no caller) | — |
| gateway names in every REUSED network | "pass-through barely matters (+0.3%)" |
| the pass-through env override reaching one lane | "the share does not matter" (identical output at 0.35/0.55/0.75/0.90) |
| a metres skim passed to a model wanting miles | "98.5% of trips are by car" — plausible for a rural county |

**None was caught by a test. All six were caught by measuring.** Every one had
the same shape: a dict rebuilt field by field instead of copied, or a constant
read in one place and hardcoded in another.

**Please look for an eighth.** A grep for dicts assembled key-by-key from
another dict, in the modelling lane, is where I would start.

---

## Ground rules (from Nathaniel, binding)

- **OpenPlan is free and open source. Never propose a paid data source** —
  not StreetLight, Replica, INRIX, nor "worth pricing later". If free data
  cannot settle something, say what it does and does not establish. That IS the
  answer. I broke this rule twice and was corrected.
- **Accuracy beats runtime.** Runs may take hours or days. Never present "it
  would be slow" as a reason not to try something.
- **Never average the two demand models.** The disagreement is the signal.
- **Do not fit a scalar to make a number look better.** The gamma experiment
  exists as the worked example of why.

## How to run any of it

```bash
cd /home/nathaniel/code/openplan
export CENSUS_API_KEY=$(grep "^CENSUS_API_KEY=" openplan/.env.local | cut -d= -f2-)
# a county in ~2 minutes by reusing an existing network:
workers/aequilibrae_worker/.venv311/bin/python scripts/modeling/run_screening_model.py \
  --name yourname-06047 --county-fips 06047 --keep-project --counts auto --force \
  --reuse-network-from-run data/screening-runs/study-06047-base
```

Both Python suites, and both must stay green:

```bash
cd scripts/modeling/tests && for f in test_*.py; do python "$f" || echo "FAIL $f"; done
cd workers/aequilibrae_worker && for f in test_*.py; do .venv311/bin/python "$f" || echo "FAIL $f"; done
```

**Every test written or changed gets its mutation check**: revert the code it
guards, run it, confirm it fails for the right reason, restore. Four of my
mutations survived on this day and each one meant a test proving nothing.
