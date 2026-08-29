# Structural demand and loading diagnosis

Date: 2026-08-28
OpenPlan: `0.43.0`
Release SHA: `65bdb8a5591c8af72440a862b8d2e2d618bbe9c3`

## Result

All fourteen development diagnoses are inconclusive. They size structural coverage and recorded limitations. They do not show improved accuracy, change a default, calibrate either method, rank methods, select a candidate, define acceptance criteria, or open a holdout.

The frozen packages do not retain a LODES provenance manifest, so the LODES vintage, seed coverage, commute-share use, and fallback use remain unknown. LODES is home-to-work job-location evidence, not all-purpose travel or vehicle trips. Non-work through travel remains unsupported. The recorded 0.35 through share is an assumption.

## Separate method records

| Geography | Method | Loaded | Unloaded | Unreachable | Excluded | Ambiguous | Unsupported | Missing output | Diagnosis SHA-256 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 06007 | aequilibrae | 3 | 0 | 0 | 5050 | 4997 | 0 | 0 | `8d636d2ac350a37a2af12f6065728b63ec840370ab25afef96e7e9e4e2f73dc0` |
| 06007 | activitysim | 1 | 2 | 0 | 5050 | 4997 | 0 | 0 | `e1f654b7a0f9c55dabbb04c59536e5edecda17d95bb71bb8b1b864a010cf4374` |
| 06039 | aequilibrae | 7 | 10 | 1 | 17982 | 11245 | 0 | 0 | `3814d988ad8820e837969ae926bbc9c35a6144878f2e833ce75fa5e2394d6bcc` |
| 06039 | activitysim | 7 | 10 | 1 | 17982 | 11245 | 0 | 0 | `291fc2fdbeb662df2ab2f8a28cff949e7bbc78db7b35afb07bdab6e11fde5e30` |
| 06047 | aequilibrae | 11 | 31 | 0 | 12193 | 12018 | 0 | 0 | `6712c23dc941bac74bb4346ef5e0b7935300a623b89e281304651b9b037e8f28` |
| 06047 | activitysim | 11 | 31 | 0 | 12193 | 12018 | 0 | 0 | `90d944a33fdd836fe84a9a77dd5dd3bb04d7c5e7a1b0b6d5235f09314ec013bb` |
| 06053 | aequilibrae | 8 | 49 | 0 | 8127 | 11351 | 0 | 0 | `3b6b4816a785bffdd31d8b8431f5408e9bd553c72cd44a3818aa44595632975e` |
| 06053 | activitysim | 2 | 55 | 0 | 8127 | 11351 | 0 | 0 | `a59ed1a3d93e6c5614b2a76d07c24bb3d2d0e865e39bae2e90fa6148cfdfb63b` |
| 06057 | aequilibrae | 11 | 5 | 0 | 5743 | 4504 | 0 | 0 | `a9409a93316ae78a8d4f39c368eca09249d07d646746fe2faec85943f64d357e` |
| 06057 | activitysim | 4 | 12 | 0 | 5743 | 4504 | 0 | 0 | `44d39a827a4f2d007fcd85b52f0e739fb13953ff0b3478bc75cbad58f132f533` |
| 06069 | aequilibrae | 7 | 22 | 0 | 3749 | 4511 | 0 | 0 | `24e10d47a5a1be4acddec1a77d4173a14ebe1769c24a60d72c0ada320cd725c7` |
| 06069 | activitysim | 7 | 22 | 0 | 3749 | 4511 | 0 | 0 | `3e199a203929f2c5418b9468ebd2c2207b5f1fd8fd94b1747f2c96d0dae7c867` |
| 06107 | aequilibrae | 27 | 38 | 0 | 13984 | 10007 | 0 | 0 | `36922fe52836fa3350c80e15ad83c1fcb64249a6a9dd15cb0a30be94f7af4cae` |
| 06107 | activitysim | 25 | 40 | 0 | 13984 | 10007 | 0 | 0 | `02f7e40bc8dd34a784737554b736e42ca20b9fad764cd04950ba0ba3a83e8c2a` |

## Evidence boundary

Every method record binds the release, v4 registry, unchanged v0.41 custody, exact demand matrix, shared network and external layer, pre-output audit, model output, comparison basis, and predecessor diagnosis. AequilibraE and ActivitySim values, differences, and ratios remain separate.
