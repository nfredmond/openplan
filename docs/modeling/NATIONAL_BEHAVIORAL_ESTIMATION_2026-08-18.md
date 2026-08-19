# National behavioral estimation: source boundary measured 2026-08-18

This is a dated measurement, not a promise that the upstream download will stay
the same. It records the first executable slice replacing ActivitySim's borrowed
Bay Area behavior with nationally estimated parameters.

## The method, and the trap it avoids

OpenPlan will not fit one scalar per region. The measured count-calibration
residual is distributional, and a scalar cannot repair which trips occur, which
mode people choose, where activities happen, or when tours run.

The defensible route is ActivitySim's own estimation workflow:

1. convert a household travel survey into observed household, person, tour and
   trip choices;
2. create estimation data bundles for the component choice models;
3. estimate parameters with survey weights;
4. validate on whole geographies excluded from estimation; and
5. publish a versioned coefficient package whose source, component coverage,
   diagnostics and holdouts determine its claim tier.

The US source adapter is `scripts/modeling/us_nhts_survey.py`. Country-specific
survey concepts stop there; the future coefficient-package contract above it
must not know what a Census division or FHWA is.

## What the federal download returned

Measured from the official CSV URL on 2026-08-18:

- URL: `https://nhts.ornl.gov/media/2022/download/csv.zip`
- SHA-256: `64530c396d5f164d2259a22f7042f27bee5147babcd367568ddbfafe6c8bf34c`
- compressed bytes: 4,533,528
- households: 7,893
- persons: 16,997
- trips: 31,074
- vehicles: 14,684

The downloads page advertises **2022 V2.1**, whose release notes add the
summarized `TRIPMODE` field. The archive above contains that field and satisfies
the adapter's measured source contract.

An important false start is retained because it explains the guard: the
plausible URL `/assets/2022/download/csv.zip` exists and returned a 3,916,688-byte
older archive (SHA-256
`210a4e7092a0135f15c95f001836669949cd6a1f515620bce496c84250527bf2`)
without `TRIPMODE`. Inspecting the site's shipped application bundle revealed
that its actual V2.1 link uses `/media/`, not `/assets/`. The adapter would have
refused the stale bytes rather than deriving `TRIPMODE` locally and silently
creating an OpenPlan-specific survey release.

The source boundary is therefore open for the next slice: map these weighted
observations into ActivitySim survey tables. Until that mapping and estimation
are complete, the existing executed ActivitySim lane remains truthfully labeled
as borrowed Bay Area behavior.

## Holdout rule now executable

The adapter assigns whole public-use Census divisions to deterministic,
source-scoped folds and preserves the survey weights in each fold. Records from
one division can never appear in both fit and validation. Fold assignment is
balanced after hashing, so a requested fold cannot silently be empty when
enough geographic groups exist.

Sources checked:

- [ActivitySim estimation mode](https://activitysim.github.io/activitysim/develop/users-guide/estimation-mode/index.html)
- [FHWA NHTS downloads](https://nhts.ornl.gov/downloads)
- [2022 NHTS V2.1 release notes](https://nhts.ornl.gov/media/2022/doc/2022%20NextGen%20NHTS%20V2.1%20Release%20Notes.pdf)
