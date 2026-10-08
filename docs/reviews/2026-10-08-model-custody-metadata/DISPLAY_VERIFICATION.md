# Published comparable-observation display custody

October 8, 2026. Development correction, not a release or scientific acceptance.

## Reproduced failure and change

The published comparable-observation loader returned coverage and artifact
bindings directly from the study manifest. It did not read the diagnosis bytes
before displaying those values. The download path checked hashes separately.
Synthetic files demonstrate that the original loader accepts changed diagnosis
bytes, inconsistent manifest summaries, swapped methods and duplicate records.
This reproduces a software defect; it does not establish that the committed
historical study is corrupted.

The loader now reads and hashes all fourteen diagnosis files, including gzip
storage, before returning their counts. It checks schema, inconclusive outcome,
method/geography identity and exact coverage/binding agreement. It refuses
missing required counts and hashes, invalid counts, duplicate records, missing
method partners and paths outside the study directory. The Models card shows an
explicit unavailable message when loading fails, with retry guidance and no
result or download links. It previously disappeared on failure.

No historical study bytes, model defaults, scientific thresholds or holdouts
change. The seven-county, two-method count belongs to this frozen study and is
not a new geography assumption in the general modeling architecture.

## Verification

- Fifteen synthetic loader cases exercise compressed bytes, a genuine zero,
  corruption, summary disagreement, method swaps, duplicate records, invalid or
  omitted evidence, unsupported promotion and out-of-study paths.
- Existing tests load the actual fourteen-record published study and download
  selected exact artifacts. Three component cases retain its disclosures and
  downloads and test the explicit unavailable state.
- The corrected fixture fails fifteen cases against the original loader.
  Ten targeted loader mutations fail their relevant assertions. A harmless
  loader comment passes. Removing the unavailable card fails its new test;
  a harmless card comment passes.
- Targeted ESLint and a focused TypeScript project covering the changed loader,
  card, tests and the new native metadata suite pass. The full TypeScript
  project exceeded a 3 GB V8 heap cap with exit 134. It remains unverified here.

The initial filesystem mock omitted its default export. A subsequent fixture
returned the mock function from `beforeEach`, which Vitest treated as cleanup.
Both setup failures are retained and excluded from the regression proof. The
corrected fixture was rerun against the original loader. The first focused
TypeScript configuration omitted Node types; adding the installed Node types
corrected that temporary configuration. No dependency change was needed.

Private logs, restored source, controls and focused TypeScript configuration
are under `~/.local/state/openplan/s1-metadata-20261008-proof/` with the
`display-` prefix. The original study remains under its existing dated path.

## Remaining evidence

Identified-build desktop and 390px journeys, console review, complete local QA
and GitHub integration checks remain pending for this correction. The connected
T3 preview still fails snapshot capture. No alternate browser or earlier build
is counted as visual acceptance.

These checks verify published diagnosis-to-manifest agreement. They do not
independently recompute every underlying input, assessment or observation,
establish production custody ingestion, authenticate an edited manifest against
an external signature, or validate either demand model. S1 and the V1 contract
remain incomplete.
