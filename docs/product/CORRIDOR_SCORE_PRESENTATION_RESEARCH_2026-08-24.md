# Corridor score presentation research

Date: 2026-08-24

## Decision

Do not add low, medium, or high bands to OpenPlan's Accessibility, Safety,
Equity, or overall corridor scores. I found no published authority or validation
record that gives those scores defensible cut points. The federal methods that
look superficially similar use different measures, different denominators, and
different reference populations. Their thresholds cannot be copied onto
OpenPlan's 0 to 100 arithmetic.

Keep the stored numbers for reproducibility. On planner-facing surfaces:

- show an eligible score only as an **OpenPlan screening score**, without a
  qualitative band or a claim that a given value is good, bad, safe, unsafe,
  equitable, or accessible;
- show the independently supported component evidence and its measurement
  method;
- withhold Accessibility when Census or transit input is unavailable;
- withhold Safety when crash evidence is unavailable;
- withhold Equity when its required demographic input is unavailable; and
- withhold the composite when any component is withheld. Do not present the
  reweighted two-component result as an exact overall score.

This is a negative finding, not a recommendation to choose more conservative
cut points. There are no cut points to choose from the evidence reviewed.

## What the live scores mean

The code, not an external scoring specification, defines all four scales.

### Accessibility

[`scoring.ts`](../../openplan/src/lib/data-sources/scoring.ts#L190) adds these
terms and rounds the result to an integer:

| Term | Live arithmetic | Maximum points |
|---|---:|---:|
| Transit, walk, and bike commute share | `min(20, share * 0.7)` | 20 |
| Jobs per resident | `min(20, ratio * 32)` | 20 |
| Transit commute share | `min(20, share * 1.2)` | 20 |
| Vehicle independence | 4, 10, or 16 points at internal joint thresholds | 16 |
| Transit service | stop density alone, or half density and half frequent-service share | 20 |

The transit density term reaches its ceiling at about 9.1 stops per square mile.
For a frequency-capable GTFS source, half of the term is the share of counted
stops meeting OpenPlan's 15-minute peak-headway rule. An OpenStreetMap inventory
cannot measure frequency, so it uses the whole transit term for stop density.
The live code already refuses to subtract scores produced by those different
methods.

Two details rule out a simple interpretation of the number. With measured
transit, the mathematical maximum is 96, not 100. When transit is unobserved,
the existing arithmetic drops that term and rescales the other 76 possible
points to a 100-point scale. The v0.32 presentation rule should hide that
unobserved-input result, not label it low, medium, or high.

There is a separate `low` / `medium` / `high` label for raw stop density at 3
and 8 stops per square mile in
[`transit/types.ts`](../../openplan/src/lib/data-sources/transit/types.ts#L208).
The repository contains no cited validation for those two values. More
importantly, a stop-density label does not validate the full Accessibility
score, which also includes commute behavior, jobs per resident, zero-vehicle
households, and source-dependent transit arithmetic.

### Safety

[`scoring.ts`](../../openplan/src/lib/data-sources/scoring.ts#L223) starts at 85,
then:

- deducts 8, 15, 25, or 40 points when crash density crosses 0.5, 1, 2, or 5
  crashes per square mile;
- deducts 5 points per pedestrian-involved fatal crash, capped at 20;
- deducts 5 points per bicyclist-involved fatal crash, capped at 15; and
- adds 10 when the source reports no fatal crashes or fatalities.

The score is null when no crash source answered. When a source did answer, its
density basis can still be injury-and-fatal crashes or fatal crashes only.
Those are not interchangeable populations. Area also acts as the exposure
denominator even though roadway length, vehicle travel, and walking or cycling
exposure differ between corridors.

### Equity

[`equity.ts`](../../openplan/src/lib/data-sources/equity.ts#L82) first calls a
tract disadvantaged when median household income is below $50,000 and at least
one of four internal burden tests is met: poverty at least 30 percent, minority
population at least 50 percent, zero-vehicle households at least 10 percent, or
transit commute share at least 15 percent.

The score in
[`equity.ts`](../../openplan/src/lib/data-sources/equity.ts#L231) is the rounded
sum of:

- 40 percent of the share of tracts called disadvantaged;
- 20 percent of the share of tracts meeting the poverty test;
- 20 percent of the share meeting the zero-vehicle test; and
- 20 percent of the share meeting the transit-dependency test.

Each tract has equal weight in these shares. The score is explicitly an ACS
income-and-burden proxy, not a CEJST, Justice40, or state disadvantaged-community
designation. A study area with no tracts currently yields arithmetic zeros, so
the presentation layer must withhold the score when the Census input is absent.

### Overall

[`scoring.ts`](../../openplan/src/lib/data-sources/scoring.ts#L267) weights
Accessibility at 35 percent, Safety at 35 percent, and Equity at 30 percent.
When Safety is null, the live arithmetic divides the Accessibility and Equity
sum by their remaining 65 percent. That preserves a historical number, but it
changes what the composite contains. It cannot support the same interpretation
as the three-component result. The presentation layer should withhold it.

## What authoritative methods support

### Accessibility is normally tied to reachable opportunities

The Federal Transit Administration's 2020 mobility-metrics report identifies
accessibility measures such as the number of jobs and other destinations
reachable in 15, 30, and 45 minutes, effective service area or coverage, and
change in access to essential amenities. It does not define a 0 to 100 score
made from commute mode share, jobs per resident, zero-vehicle households, and
stop density. It supplies no low, medium, or high thresholds transferable to
OpenPlan. See FTA, [*Mobility Performance Metrics for Integrated Mobility and
Beyond*, pages 87 to 88](https://www.transit.dot.gov/sites/fta.dot.gov/files/docs/research-innovation/147791/mobility-performance-metrics-integrated-mobility-and-beyond-fta-report-no-0152.pdf).

This does not make OpenPlan's ingredients useless. It means the score is an
internal screening index. A published accessibility threshold would need to be
validated against a stated planning outcome, reference geography, travel mode,
time threshold, and population. None of that calibration exists for the live
formula.

### Safety practice uses exposure, comparable sites, and expected crashes

FHWA's national safety performance measures are counts of fatalities, fatality
rates per 100 million vehicle miles traveled, counts of serious injuries,
serious-injury rates per 100 million vehicle miles traveled, and counts of
non-motorized fatalities and serious injuries. They are not a 0 to 100 safety
index. See FHWA, [*Safety Performance Measures*](https://safety.fhwa.dot.gov/hsip/spm/docs/safety_pm_fs.pdf).

FHWA's guide to high-pedestrian-crash locations says a crash rate needs an
exposure denominator. It also says rate comparisons should be limited to
locations with similar traffic volumes because simple rates are biased and
assume a linear crash-volume relationship. The guide uses ranking, reference
populations, and more rigorous expected-crash methods rather than universal
crashes-per-square-mile bands. See FHWA,
[*Guidebook on Identification of High Pedestrian Crash Locations*, plan
assessment](https://www.fhwa.dot.gov/publications/research/safety/17106/005.cfm).

OpenPlan's area-density deductions at 0.5, 1, 2, and 5 therefore have no FHWA
interpretation as safe, unsafe, low, medium, or high. The vulnerable-road-user
deductions and no-fatality bonus also have no validation record in the
repository. Copying a federal safety target onto this score would mix different
units and denominators.

### Federal equity thresholds belong to their own distributions

The 2024 USDOT Transportation Community Explorer methodology normalizes tract
indicators using the first and ninety-ninth percentiles, calculates raw
subcomponent scores, then percentile-ranks tracts nationally or within a state.
Its overall disadvantage score is built from those ranked components. See
USDOT, [*Transportation Community Explorer Technical Methodology*, sections 3.2
and 3.3](https://www.transportation.gov/sites/dot.gov/files/docs/justice40/TC_Explorer_Technical_Methodology_2024_11_22.pdf).

That method makes its score relative to a named tract distribution. OpenPlan's
Equity score instead counts tracts crossing fixed internal thresholds and then
weights four shares. A percentile or disadvantage threshold from the USDOT tool
does not describe the OpenPlan value.

EPA makes the same interpretive boundary explicit in its own tool. EJScreen's
map colors use percentile bins, but EPA assigns no official policy significance
to the colors and warns that a high percentile does not by itself establish a
health or legal concern. Its 80th-percentile filter is a starting point for
further review, not an EJ-community designation. See EPA,
[*EJScreen Technical Documentation, version 2.3*, sections 4 and
5](https://www.epa.gov/system/files/documents/2024-07/ejscreen-tech-doc-version-2-3.pdf).

If an authority cautions against treating bands on its own nationally ranked
index as findings, those bands cannot validate an unrelated local formula.

### A composite threshold needs its own evidence

FHWA describes target setting as an evidence-based process using baseline data,
trends, forecasts, resource constraints, and an agency's goals. It does not
endorse generic cut points detached from a measure and a reference period. See
FHWA, [*Approaches to Target Setting for PM3 Measures*, chapter
2](https://ops.fhwa.dot.gov/publications/fhwahop19056/chap2.htm) and its
[Transportation Performance Management FAQ](https://www.fhwa.dot.gov/tpm/faq.cfm).

No authority reviewed publishes an interpretation for OpenPlan's 35/35/30
weighted sum. Since none of its three components has validated bands, their
weighted average cannot acquire valid bands through arithmetic.

## Per-score conclusion

| Score | Defensible low/medium/high thresholds found? | Presentation decision |
|---|---|---|
| Accessibility | No | No band. Show the internal screening number only when Census and transit evidence are present, with its component and transit-method disclosures. Otherwise suppress it. |
| Safety | No | No band. Show the internal screening number only when crash evidence is present, with source, years, completeness, and density basis. Otherwise suppress it. |
| Equity | No | No band. Call it an ACS income-and-burden proxy and show it only when required tract demographics are present. Otherwise suppress it. |
| Overall | No | No band. Show it only when all three components are presentation-eligible. Never show the reweighted two-component value as the overall score. |

The supported facts underneath a withheld score should remain visible. Missing
transit does not erase observed commute shares. Missing crash evidence does not
erase Census demographics. A withheld composite should not hide an eligible
component.

## What would change this conclusion

A future banding proposal would need a sealed validation exercise, not a new set
of round numbers. At minimum it would have to:

1. freeze the formula and each input method;
2. state the real-world construct and decision each band is supposed to support;
3. choose a representative reference population before looking at outcomes;
4. keep incompatible source methods separate, including OSM versus GTFS transit
   measurement and fatal-only versus injury-and-fatal crash evidence;
5. preregister candidate cut points and failure rules;
6. validate them out of sample against an independent outcome or adopted policy
   standard; and
7. test stability across urban, suburban, rural, tribal, territorial, and
   multi-state settings.

Distribution-only quantiles could later support labels such as "top fifth among
comparable runs in this defined reference set." They still would not mean high
accessibility, safe, equitable, or good overall. Without that validation, the
honest behavior is eligibility-based suppression and no qualitative bands.

## Scope of this review

I reviewed the live formula paths, repository documentation, and the primary
USDOT, FHWA, FTA, and EPA methods linked above. I found no repository calibration
artifact or authoritative source for the exact OpenPlan coefficients, weights,
or proposed qualitative cut points. This is a bounded negative finding as of
2026-08-24, not a claim that no future validation study could support a revised
scale.

No NHTS successor outcome rows were read for this research.
