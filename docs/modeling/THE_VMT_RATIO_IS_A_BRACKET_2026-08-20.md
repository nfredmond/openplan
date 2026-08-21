# The over-assignment headline is one end of a bracket, not a measurement

**Measured 2026-08-20.** A dated measurement of the instrument, not of the model.

## The contradiction this set out to resolve

`WHERE_THE_NUMBER_STANDS_2026-08-20.md` named the most concrete open thread:
seeding boundary crossings from published counts **improves count agreement by
10.8 points** while **worsening total vehicle-miles**, and nothing explained how
both could be true.

The answer is that the two sides are not measured the same way, and one of them
is measured with an instrument that counts things the comparison does not
intend.

## What the headline ratio actually divides

`gamma_fit_analysis.grade_run` — the tool behind every "×too much driving"
figure in this lane, including the 1.67× the audit brief reports:

```
vmt_ratio = (network_vmt / county_population) / published_state_vmt_per_capita
```

`network_vmt` already excludes centroid connectors, which is right and was
measured. But it is **Σ over all loaded links**, and a screening network is built
with a buffer beyond the study area. **So the numerator includes vehicle-miles
driven outside the county**, divided by the county's residents.

### How much, measured

Clipping each link's mileage by the fraction of its length inside the analysis
boundary, on the runs behind the current headline:

| county | ratio as graded | clipped to the county | change | share of VMT outside |
|---|---:|---:|---:|---:|
| 06047 Merced | 2.139 | 1.929 | −0.210 | 9.8% |
| 06069 San Benito | 2.499 | 2.152 | −0.348 | 13.9% |
| 06107 Tulare | 1.633 | 1.590 | −0.043 | 2.6% |
| 08014 Broomfield | 1.049 | **0.861** | −0.188 | 17.9% |
| 08101 Pueblo | 1.666 | 1.584 | −0.082 | 4.9% |
| **median** | **1.666** | **1.590** | −0.076 | |

The median moves little because the median county happens to leak least. Per
county it moves up to **0.35**, the spread narrows from 1.05–2.50 to 0.86–2.15,
and **Broomfield crosses below 1.0** — the same run reads as over-assigning or
under-assigning depending on whether travel outside the county is counted
against its residents.

The leakage is strongly size-dependent: 2.6% for the largest county here, 17.9%
for the smallest. **It is a bias against small study areas**, and OpenPlan's own
product is aimed at small agencies.

## The deeper problem, which clipping does not fix

The numerator is **every vehicle on the county's roads**, through traffic
included. The denominator is **the county's residents** times a **state**
per-capita rate. Those are different quantities, and the same model answers very
differently depending on which end you build:

| county | resident-VMT construction | network-VMT construction (clipped) | resident travel that leaves the area |
|---|---:|---:|---:|
| Broomfield CO | 0.419 | 1.099 | 37% |
| San Benito CA | 0.720 | 2.473 | 26% |
| Pueblo CO | 0.912 | 1.906 | 11% |
| Merced CA | 1.520 | 2.460 | 12% |
| Tulare CA | 1.827 | 2.223 | 6% |
| **median** | **0.912** | **2.223** | |

Both rows compare the same model against the same published rate. One counts
only travel the county's residents make and **loses everything that leaves the
area** — 6% to 37% of their trips. The other counts every vehicle on the
county's roads and **gains traffic that never stops there** — external travel is
25–83% of network vehicle-miles.

**Both biases scale with how small and how open the study area is, and they run
in opposite directions.** So the truth is bracketed, not measured:

> the model's driving is somewhere between **0.9×** and **2.2×** the published
> rate, and this instrument cannot narrow that.

**The 1.67× that this lane has been trying to explain is the upper construction,
clipped or not.** A residual computed against it is a residual against one end
of a bracket.

## Which resolves the seeding contradiction

Seeding raises boundary crossings, so it raises exactly the two things the
numerator over-counts: through traffic, and travel near and beyond the boundary.
Counts, by contrast, are measured at fixed points inside the county, where more
realistic crossing volumes genuinely help.

**So "counts improve while vehicle-miles worsen" is not a paradox about the
model. It is what happens when an in-county measurement and a
not-in-county-only, not-resident-only ratio are read as the same axis.** It does
not make seeding right — its 85% increase in Broomfield's crossings is still
untested against anything — but the evidence against it was partly the
instrument.

## What would fix it, and what is missing

The denominator should be **the county's own published VMT**, not a state
per-capita rate times county population. A county's roads carry travel in
proportion to its geography, not its residents: a small county astride an
interstate legitimately carries many times the state's per-resident average, and
scoring that as model error is scoring geography.

**That source is not in this repository.** `PUBLISHED_DAILY_VMT_PER_CAPITA`
holds four state figures from FHWA table VM-2, and `count_sources.py` records
that FHWA HPMS is distributed as bulk downloads rather than a queryable national
county series. Whether a free county-level VMT series exists for all four states
— several state DOTs publish one — has **not been checked**, and this document
does not assume it.

## What is NOT claimed

- **Not** that the model is accurate. It fails the 30% count gate everywhere.
- **Not** that the over-assignment is imaginary. Both ends of the bracket exceed
  1.0 in three of five counties, and the count comparison is a separate
  instrument that also says the model assigns too much.
- **Not** a new headline figure. Replacing 1.67× with 1.59× would be swapping
  one end of a bracket for a slightly shorter one and calling it progress.
