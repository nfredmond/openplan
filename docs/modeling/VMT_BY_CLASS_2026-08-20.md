# The model under-uses the bottom of the road hierarchy — and the top half of the table cannot be read at all

**Measured 2026-08-20** across the twelve `u2-*-base` runs (California,
Colorado, Oregon, Washington), 113,029,728 daily vehicle-miles. A dated
measurement, not a claim about what a future run will do.

## Why this was asked

`ZONE_COVERAGE_REREAD_2026-08-20.md` established that zone size is not what
makes the assignment load only a fifth of the network, and said the search moves
to the network itself. The first question there is whether the empty roads
matter: a residential street with no through movement genuinely carries little,
and if that is all the model is missing, the skeleton is cosmetic.

FHWA publishes the answer for free. Highway Statistics table VM-2 gives the
share of all vehicle-miles by functional system, and OpenPlan already carries it
(`src/lib/models/charts/published-vmt-shares.ts`, read 2026-08-17). Comparing a
run's own vehicle-miles by road class against those shares says whether the
model puts travel where the country's travel actually is.

Method: for every link in each run, `PCE_tot × distance`, summed by OSM class
and folded into FHWA's categories with the mapping that file already declares.

## The result, and the half of it that must be thrown away

| category | model | FHWA published | ratio |
|---|---:|---:|---:|
| Freeway | 33.2% | 44.8% | 0.74 |
| Principal arterial | 42.2% | 21.0% | **2.01** |
| Minor arterial | 14.1% | 15.8% | 0.89 |
| Collector | 8.2% | 11.3% | **0.72** |
| Local | 2.4% | 7.1% | **0.33** |

**The arterial rows are an artifact of one judgement and cannot be reported.**
The mapping places OSM `trunk` with principal arterials, a call that file makes
explicitly and defends with count evidence (trunk grades 2.38 against motorway's
0.78). Moving `trunk` to the freeway row, the same 113 million vehicle-miles
read:

| category | model | FHWA | ratio |
|---|---:|---:|---:|
| Freeway (with trunk) | 52.7% | 44.8% | 1.18 |
| Principal arterial (primary only) | 22.7% | 21.0% | 1.08 |

**A headline of "the model puts twice as much travel on principal arterials as
it should" becomes "both arterial rows are within 20% of published" on a
classification judgement alone.** Neither reading is evidence about the model.
Any future claim resting on those two rows is a claim about the OSM-to-FHWA
mapping, and should say so.

## What survives, because it does not involve `trunk`

| category | ratio | unchanged under either mapping |
|---|---:|---|
| Minor arterial (`secondary`) | **0.89** | yes |
| Collector (`tertiary`) | **0.72** | yes |
| Local (`residential`, `unclassified`, `service`, `living_street`) | **0.33** | yes |

**The model puts a third of the published share of travel on local streets and
about three quarters of it on collectors.** That is robust to the one judgement
in the mapping, and it agrees independently with the coverage measurement: 96–100%
of local links and roughly a third of collector links carry no assigned traffic
at all. Two different measurements of the same network, from different files,
pointing the same way.

## Reading it in absolute terms, with the assumption named

These are SHARES, so they say where travel is put, not how much. The lane's
measured overall over-assignment is 2.11× from counts and 2.16× from published
VMT per capita (`WHY_THE_MODEL_OVER_ASSIGNS_2026-08-17.md`). Multiplying the
share ratios by 2.11 — which assumes the over-assignment is spread evenly across
classes, and it is not — gives an indicative absolute reading:

- Local streets ≈ **0.7× — under-assigned even before the correction**
- Collectors ≈ **1.5× — over-assigned in total**

That second figure is the reconciliation worth keeping. Count stations on
collector roads read a median of **0.07× observed**, which reads as a
catastrophic under-assignment; total collector vehicle-miles are, if anything,
above the published share. **Both are true, and together they say the problem is
distributional, not volumetric: roughly the right amount of collector travel,
put on the wrong collector roads.** A third of collector links get nothing while
the ones that do get loaded carry more than their share.

That reframes the "tertiary at 0.07×" finding this lane has carried since
2026-08-17. It is not missing travel. It is misplaced travel, and the fix is
therefore in route choice and connector placement rather than in trip
generation.

## What this does not settle

- **Where the displaced local travel goes.** The arterial rows cannot answer it,
  for the reason above.
- **Whether FHWA's four-state VM-2 shares are the right reference** for any
  particular county. They are summed over the four states whose DOT count feeds
  OpenPlan can read; a study area elsewhere is being compared against those
  four. Lincoln County OR reads 0.0% freeway, which is correct — it has none —
  and is a reminder that a single county's shares are not expected to match a
  national figure.
- **Whether `service` belongs in Local.** OSM `service` covers parking aisles
  and driveways. It carries essentially no assigned volume either way, so it
  cannot move the Local ratio, but the category boundary is a judgement like the
  `trunk` one.
