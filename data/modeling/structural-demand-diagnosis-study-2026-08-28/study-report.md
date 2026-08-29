# Structural demand and loading diagnosis

Date: 2026-08-28
OpenPlan: `0.43.0`
Release SHA: `6b1915582212ebe79608a2ac28f7fff0e25c1b9a`

## Result

All fourteen development diagnoses are inconclusive. They size structural coverage and recorded limitations. They do not show improved accuracy, change a default, calibrate either method, rank methods, select a candidate, define acceptance criteria, or open a holdout.

The frozen packages do not retain a LODES provenance manifest, so the LODES vintage, seed coverage, commute-share use, and fallback use remain unknown. LODES is home-to-work job-location evidence, not all-purpose travel or vehicle trips. Non-work through travel remains unsupported. The recorded 0.35 through share is an assumption.

## Separate method records

| Geography | Method | Loaded | Unloaded | Unreachable | Excluded | Ambiguous | Unsupported | Missing output | Diagnosis SHA-256 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 06007 | aequilibrae | 3 | 0 | 0 | 5050 | 4997 | 0 | 0 | `f654174e1b11dc377a4e85c46893aee2bba087120c0f7311a707821b5892f2cc` |
| 06007 | activitysim | 1 | 2 | 0 | 5050 | 4997 | 0 | 0 | `3c35f30711ff4f44475696bbe64cd7be6e605d5033c36a9010676b0adb790dcf` |
| 06039 | aequilibrae | 7 | 10 | 1 | 17982 | 11245 | 0 | 0 | `ffb1f08423e99b7e920621c112cde9600208ec2b18291f3da5df966260257fce` |
| 06039 | activitysim | 7 | 10 | 1 | 17982 | 11245 | 0 | 0 | `7d8f50ca23110cd41433c4ee6e4d49aa160606fc467d7571f38e4a36c5d2d3f2` |
| 06047 | aequilibrae | 11 | 31 | 0 | 12193 | 12018 | 0 | 0 | `12c2d33943811c395a12a528927441989005f05372947d9482f8fbdae962a0c1` |
| 06047 | activitysim | 11 | 31 | 0 | 12193 | 12018 | 0 | 0 | `e4b9d0537069c7000417b1a914ab40c9fda2765cb3e0b9dd491a660c269dd049` |
| 06053 | aequilibrae | 8 | 49 | 0 | 8127 | 11351 | 0 | 0 | `57504922f569f66bff2eaee2cf08a42804680428bfd8f8759d6f1d12fe94703c` |
| 06053 | activitysim | 2 | 55 | 0 | 8127 | 11351 | 0 | 0 | `013ed93a7724d4c9051ed351b742dffe105924c057819a68fcbb0971dc280bd4` |
| 06057 | aequilibrae | 11 | 5 | 0 | 5743 | 4504 | 0 | 0 | `b253b125a04f899ec603616b60e5a5f01b9831160d93ee74866629a82305f3d5` |
| 06057 | activitysim | 4 | 12 | 0 | 5743 | 4504 | 0 | 0 | `fc1ad2a204b9c3c09d1cc45c6103722a8f77f92eb48aa5fa47dbe4140dfa2dff` |
| 06069 | aequilibrae | 7 | 22 | 0 | 3749 | 4511 | 0 | 0 | `9827de4babca2b848eeb58828a6bef81da443cc49ec0886546822663761c5578` |
| 06069 | activitysim | 7 | 22 | 0 | 3749 | 4511 | 0 | 0 | `3e2e340e3b1023c5cb40f352c1ecc8c28d6c4c345679402a3c88e7c3fe3bb48d` |
| 06107 | aequilibrae | 27 | 38 | 0 | 13984 | 10007 | 0 | 0 | `0968bd3f7e88dd17edea5c59fc71680727d4f9f6ad217fc177d4f56fa1995f42` |
| 06107 | activitysim | 25 | 40 | 0 | 13984 | 10007 | 0 | 0 | `f86aba996de6bd0452419066e0c8a2e33883e25dc27726cc766a33d4a95f59e5` |

## Evidence boundary

Every method record binds the release, v4 registry, unchanged v0.41 custody, exact demand matrix, shared network and external layer, pre-output audit, model output, comparison basis, and predecessor diagnosis. AequilibraE and ActivitySim values, differences, and ratios remain separate.
