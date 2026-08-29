# Structural demand and loading diagnosis

Date: 2026-08-28
OpenPlan: `0.43.0`
Release SHA: `8ce56cd134df92db4ed81b70399b1e06c3de4fb7`

## Result

All fourteen development diagnoses are inconclusive. They size structural coverage and recorded limitations. They do not show improved accuracy, change a default, calibrate either method, rank methods, select a candidate, define acceptance criteria, or open a holdout.

The frozen packages do not retain a LODES provenance manifest, so the LODES vintage, seed coverage, commute-share use, and fallback use remain unknown. LODES is home-to-work job-location evidence, not all-purpose travel or vehicle trips. Non-work through travel remains unsupported. The recorded 0.35 through share is an assumption.

## Separate method records

| Geography | Method | Loaded | Unloaded | Unreachable | Excluded | Ambiguous | Unsupported | Missing output | Diagnosis SHA-256 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 06007 | aequilibrae | 3 | 0 | 0 | 5050 | 4997 | 0 | 0 | `031928e00acdc7ef25db88a117d95e4a31fc11dcac10f35547f5e23031d9df9c` |
| 06007 | activitysim | 1 | 2 | 0 | 5050 | 4997 | 0 | 0 | `b4bdd87a8d15628b626b780348ec1c0c32020508f288efee9c6d4bd447867ee8` |
| 06039 | aequilibrae | 7 | 10 | 1 | 17982 | 11245 | 0 | 0 | `5fdb9cab1a517ff7220d690f86eb34d3967a768e0a1a3230e7f2e790dbf43c07` |
| 06039 | activitysim | 7 | 10 | 1 | 17982 | 11245 | 0 | 0 | `5c168b2b5c678fa56017f2762081ad3df56d91d7ea77867eeee37e9225082f75` |
| 06047 | aequilibrae | 11 | 31 | 0 | 12193 | 12018 | 0 | 0 | `4ac7f185db1b1028f01d52dd741ff526fe4d7a06f127b8200a03a84b29719ccb` |
| 06047 | activitysim | 11 | 31 | 0 | 12193 | 12018 | 0 | 0 | `c387e3c5f942294f6f2a7af9cace7d40f87ca439126aec030c63fdee5f9e1e18` |
| 06053 | aequilibrae | 8 | 49 | 0 | 8127 | 11351 | 0 | 0 | `2a53f7d2b2e7c1cea2719cd43424b553cb6531940b1d4f77bb8ecb749d0e1ab8` |
| 06053 | activitysim | 2 | 55 | 0 | 8127 | 11351 | 0 | 0 | `6a5f1fafa4e1db29cb11251dd2b557a9d25a9c00644365a389fb9abac0d51a55` |
| 06057 | aequilibrae | 11 | 5 | 0 | 5743 | 4504 | 0 | 0 | `ce2fd935362a99b19c160b7aba85d2dc7a385095273cad224c1f546d8df6a2b3` |
| 06057 | activitysim | 4 | 12 | 0 | 5743 | 4504 | 0 | 0 | `6b0c73abe71215dc59c3c8a1edc59a3d7ab64e28e5e9a0c02fd4522793b90e72` |
| 06069 | aequilibrae | 7 | 22 | 0 | 3749 | 4511 | 0 | 0 | `2e945f78ade2d4c8ff113f503d44d4090538d50266fbd256bc0142c44527be19` |
| 06069 | activitysim | 7 | 22 | 0 | 3749 | 4511 | 0 | 0 | `36dc52015e746dc3768f94f6dcdea0ccacd7b52f32c896b53b77512b208a16af` |
| 06107 | aequilibrae | 27 | 38 | 0 | 13984 | 10007 | 0 | 0 | `6df5dca554713ca09cec56d683d2445dee3b349166199a43acf2505cad5a543a` |
| 06107 | activitysim | 25 | 40 | 0 | 13984 | 10007 | 0 | 0 | `acd57b1c4e7e34903fd054dd8cefa8f50d05d471120ab1d5961649f0e94544e0` |

## Evidence boundary

Every method record binds the release, v4 registry, unchanged v0.41 custody, exact demand matrix, shared network and external layer, pre-output audit, model output, comparison basis, and predecessor diagnosis. AequilibraE and ActivitySim values, differences, and ratios remain separate.
