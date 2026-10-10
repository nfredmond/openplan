# Retained matcher verification

The default comparable-observation verifier fails on the current checkout:
`06007 matcher hash changed`. This is a real version difference, not evidence
that the retained study bytes changed. Commit `a08f0b00` replaces the old
directional comparison with the refusal described in
[the October science corrections](../2026-10-01-independent-fixes/SCIENCE_FIXES.md).

The retained audit names matcher v2 with SHA-256
`67256b4a54d5157fcc9b24172bb58f877e4b465b3adc3c4b9736d29e20e18fb4`.
The matcher bytes at release-source commit
`3ef6eff43d0f9dcf70afd8c308b63e819cdb7750` have that exact hash.
The current v2.1 directional-refusal source hashes to
`869a4f105b3dcabb611e6726a3d674b641faee82146d2d9a9621702b22449aab`.
The historical study must not silently acquire the corrected method.

The verifier now accepts an explicit `--matcher-source` file. It hashes that
file without importing or executing it and checks it against every retained
county audit. Omitting the option still checks the current source and refuses
the mismatch. There is no fallback, hash substitution or modified study file.

An operator with the retained Git history can run:

```bash
matcher_copy=$(mktemp)
git show 3ef6eff43d0f9dcf70afd8c308b63e819cdb7750:scripts/modeling/validation_instrument_v2.py > "$matcher_copy"
python3 scripts/modeling/verify_comparable_observation_study.py \
  3ef6eff43d0f9dcf70afd8c308b63e819cdb7750 --matcher-source "$matcher_copy"
rm "$matcher_copy"
```

A source archive without Git history needs the original source file from the
same retained release. Missing or different bytes remain a refusal.

The full retained-study verification passes with that source file. The default
current-source command still fails on the matcher mismatch. All four focused
standard-library tests pass. A harmless verifier comment passes; removing the
hash-refusal function's checks fails the adverse cases; restoring the source
passes again. The initial pytest commands fail because neither system Python
nor the existing worker environment has pytest. The focused tests use unittest
and require no new package installation.

These checks establish exact retained custody under the historical method.
They do not validate the old directional comparisons, rerun either demand
model, prove observation quality, change an acceptance tolerance or establish
current-method accuracy. No acceptance holdout is opened. Both model outputs
remain separate and scientifically inconclusive. The frozen nationwide
preregistration remains unchanged and blocking.

Private logs, mutation results and the extracted source are retained under
`historical-matcher-20261007-proof`. No frozen model artifact, matcher source,
study registry, metric or production default changes in this increment.
