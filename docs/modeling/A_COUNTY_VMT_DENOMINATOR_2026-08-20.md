# Is there a free county-level VMT denominator? — looked up 2026-08-20

`THE_VMT_RATIO_IS_A_BRACKET_2026-08-20.md` ended on a question it refused to
answer from memory: the over-assignment ratio needs the county's own published
VMT instead of a state per-capita rate times county population, and whether such
a series exists for free had **not been checked**. This is that check. Looked up,
not recalled, because data availability changes.

## The answer

**No agency publishes a ready-made national county VMT table for free.** The two
that sell one are out on policy grounds before their quality is even considered:
CLAUDE.md names StreetLight explicitly, and OpenPlan is free and open source, so
a planner must be able to reach every number without a purchase order.

**But the raw material is free, national, and county-coded.** FHWA's HPMS Public
Release publishes section-level geospatial data for all 50 states, DC and Puerto
Rico, with AADT and a **Census county FIPS code** on every section. County VMT is
derivable as Σ(AADT × section length) grouped by that code.

| source | county VMT | free | national | verdict |
|---|---|---|---|---|
| FHWA Highway Statistics (VM-2) | no — state only | yes | yes | what the lane uses today, and the reason the ratio is a bracket |
| **FHWA HPMS Public Release** | **derivable** | **yes** | **yes** | **the candidate** |
| Caltrans California Public Road Data | yes, published | yes | CA only | a per-state check on the derivation |
| StreetLight | yes | **no** | yes | refused on policy |
| S&P Global Mobility | yes | **no** | yes | refused on policy |

## What HPMS actually contains, and why the scope suits this

The **Full Extent** network is the National Highway System plus all other roads
**except those functionally classified as local or rural minor collector**.
Travel on those excluded classes is reported only in aggregate summary form, by
urbanized area rather than by county.

That sounds like a gap and is close to the opposite. **OpenPlan's model puts
almost nothing on local roads anyway** — measured 2026-08-20, local streets carry
2.4% of its network vehicle-miles and 96–100% of local links carry none at all
(`VMT_BY_CLASS_2026-08-20.md`). So a denominator that excludes local roads can be
matched by a numerator that excludes them too, and **the comparison becomes
scope-matched on both sides for the first time**:

- numerator — model network VMT, **clipped to the county**, excluding the OSM
  classes that map to local and rural minor collector;
- denominator — HPMS county VMT over the same functional scope.

Both county-scoped. Both including through traffic, which is the point: a county's
roads carry what its geography brings, and scoring that against its residents is
what made the current ratio a bracket.

## Three things that must be stated before anyone uses it

1. **FHWA warns its own aggregates will not reconcile.** The Public Release page
   says national summaries built by aggregating these data "may render different
   results from the information presented in FHWA's Highway Statistics tables."
   A derived county VMT is therefore a **derivation, not a published figure**,
   and must be labelled as one wherever it appears.
2. **Vintage.** The shapefile page documents the 2018 release; a 2023 release
   exists in **BETA** on the BTS geospatial hub. Neither is current-year, and
   the model's counts are 2022–2023, so the denominator's year has to be
   recorded next to any ratio built from it.
3. **It has not been downloaded or verified.** Everything above is from
   published documentation. Nobody has confirmed the field names, that AADT is
   populated for every section, or that the county codes are complete — and this
   lane has been caught before by a feed whose advertised shape was not its real
   one (the 2022 NHTS archive at `/assets/` versus `/media/`).

## What this changes now

Nothing about any published figure. It answers a question that was open, and it
says the fix is **buildable with free national data** rather than blocked.

The architecture is already in this repository: `scripts/modeling/count_sources.py`
is a per-region registry of published feeds where a region that declares nothing
degrades honestly rather than inventing a default. A VMT-denominator registry
would take the same shape, with HPMS as the national fallback and a state's own
published series — California publishes one in its Public Road Data — as a check
on the derivation rather than a replacement for it.

## Sources

- [FHWA — HPMS Public Release of Geospatial Data in Shapefile Format](https://www.fhwa.dot.gov/policyinformation/hpms/shapefiles.cfm)
- [FHWA — Highway Performance Monitoring System](https://www.fhwa.dot.gov/policyinformation/hpms.cfm)
- [BTS geospatial hub — BETA HPMS 2023](https://geodata.bts.gov/datasets/483bd180fe814872b82a66dbf65e25f0)
- [FHWA — HPMS Field Manual](https://www.fhwa.dot.gov/policyinformation/HPMS/fieldmanual/HPMS_field_manual_dec2016.pdf)
- [Caltrans — California VMT Data](https://dot.ca.gov/programs/sustainability/sb-743/california-vmt-data)
- [Caltrans — California Public Road Data](https://dot.ca.gov/-/media/dot-media/programs/research-innovation-system-information/documents/california-public-road-data/prd2009-a11y.pdf)

---

## VERIFIED, same day — and the "has not been downloaded or verified" caveat above is now spent

The section above said nobody had confirmed the field names or that AADT was
populated. That has now been done, and the answer is better than the
documentation promised.

**There is no bulk download to do.** FHWA publishes a per-state **ArcGIS
FeatureServer** for each HPMS Public Release — the same shape as the count feeds
`count_sources.py` already queries:

```
https://geo.dot.gov/server/rest/services/Hosted/Colorado_2018_PR/FeatureServer/0/query
```

Thirty-one fields, including `aadt`, `county_code`, `begin_point`, `end_point`
and `f_system`, with server-side statistics supported. County VMT is
Σ `aadt` × (`end_point` − `begin_point`), filtered by `county_code`.

| county | sections | centreline miles | sections with no AADT | derived daily VMT | implied per capita |
|---|---:|---:|---:|---:|---:|
| Broomfield CO | 604 | 82.1 | **0** | 1,852,606 | 25.1 |
| Pueblo CO | 3,724 | 565.8 | **0** | 3,743,002 | 22.3 |

Both carry only functional systems 1–5, confirming the Full Extent scope with no
local or rural-minor-collector sections. Colorado's published state rate is 25.3
per capita, so both derivations land in a plausible place rather than an
implausible one.

### What it does to the ratio, decomposed

The two corrections are separable, and they do not point the same way:

| county | as graded today | + numerator clipped to the county | + county's own VMT as denominator |
|---|---:|---:|---:|
| Broomfield | 1.049 | 0.861 | **0.869** |
| Pueblo | 1.666 | 1.584 | **1.800** |

**Broomfield's correction is almost entirely the numerator** — its roads carry
25.1 vehicle-miles per resident against the state's 25.3, so the old denominator
was nearly right for it and clipping did the work.

**Pueblo's is the denominator.** Its roads carry 22.3 per resident, 13% below the
state rate, so scoring it against the state average understated its ratio; the
two corrections partly cancel and it ends up **worse** than the instrument said.

**Size this honestly.** For these two counties the denominator error is 1–13%
and the numerator error 5–18%. This is a 10–20% instrument correction, not a
factor — the larger finding remains the bracket, that the same model reads 0.9×
or 2.2× depending on which construction of "the same comparison" is built.

### Still true, and still required before use

- **HPMS 2018 against 2022–23 counts.** The vintages do not match and the year
  must travel with any ratio built this way. A 2023 release exists in BETA as a
  4.35 GB national file geodatabase, with no per-state service found for it.
- **The numerator is not yet scope-matched.** It still contains the 2.4% of
  model vehicle-miles on local streets, which HPMS excludes by design. Dropping
  those would move the ratio down about two points.
- **Two counties in one state.** Nothing here is a national validation of the
  derivation, and FHWA's warning that its own aggregates will not reconcile with
  Highway Statistics stands.
