# Structural demand and loading diagnosis

Date: 2026-08-28
OpenPlan: `0.43.0`
Release SHA: `48fec76789b755f24cde7846dc2ae786eeee0de5`

## Result

All fourteen development diagnoses are inconclusive. They size structural coverage and recorded limitations. They do not show improved accuracy, change a default, calibrate either method, rank methods, select a candidate, define acceptance criteria, or open a holdout.

The frozen packages do not retain a LODES provenance manifest, so the LODES vintage, seed coverage, commute-share use, and fallback use remain unknown. LODES is home-to-work job-location evidence, not all-purpose travel or vehicle trips. Non-work through travel remains unsupported. The recorded 0.35 through share is an assumption.

## Separate method records

| Geography | Method | Loaded | Unloaded | Unreachable | Excluded | Ambiguous | Unsupported | Missing output | Diagnosis SHA-256 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 06007 | aequilibrae | 3 | 0 | 0 | 5050 | 4997 | 0 | 0 | `1bda0219fe574503538764c0a2ddd37bd5f3e65c456f3ecc2f24040e0db19c48` |
| 06007 | activitysim | 1 | 2 | 0 | 5050 | 4997 | 0 | 0 | `a10095fdf9b26278fe7dfab77570619d4bfae91de2483122df715ac04b41b571` |
| 06039 | aequilibrae | 7 | 10 | 1 | 17982 | 11245 | 0 | 0 | `1e907269c09f87f5387bd6bed0f329c539549bd351a37b2371876807cacfe52a` |
| 06039 | activitysim | 7 | 10 | 1 | 17982 | 11245 | 0 | 0 | `0b82f4543831ba604ec585dc2e1a5f40e5dea0b1a9747d2234ed3a5b044101ce` |
| 06047 | aequilibrae | 11 | 31 | 0 | 12193 | 12018 | 0 | 0 | `4f1f3c50d59dabc2fcb1ee0c41939c6b4fd80cbd53888d8111c0c763f12d7b22` |
| 06047 | activitysim | 11 | 31 | 0 | 12193 | 12018 | 0 | 0 | `948d8a5893c0c75135bcc8f6186f8fb563dcb57b5dabb1934bc6d1fa95353d1a` |
| 06053 | aequilibrae | 8 | 49 | 0 | 8127 | 11351 | 0 | 0 | `58e30414231eb62f12e61d6ec2a4f2b3e688cea2d736632a35d46cc9c880d074` |
| 06053 | activitysim | 2 | 55 | 0 | 8127 | 11351 | 0 | 0 | `2af710a9f88f885a14d032c3081d250cd6c1e0e56110fff68362537a8c8d6aa9` |
| 06057 | aequilibrae | 11 | 5 | 0 | 5743 | 4504 | 0 | 0 | `ce4d57af06c4fae214fc2cc1d88b0d67d69e0f1d724b338953831af4d15b934c` |
| 06057 | activitysim | 4 | 12 | 0 | 5743 | 4504 | 0 | 0 | `f55ae8d33e76e6cad9dad0e34ec9ee6dacba251453f42449621afb6aa1d88bf0` |
| 06069 | aequilibrae | 7 | 22 | 0 | 3749 | 4511 | 0 | 0 | `63cf22a992cdd8f3dcf4b3ca0219cc6097e393471c431b1b8502d040c18c4bff` |
| 06069 | activitysim | 7 | 22 | 0 | 3749 | 4511 | 0 | 0 | `e0cc85224b2c6da9a3cd48fb768876b5873ac304d7e9327684615e3172e9d628` |
| 06107 | aequilibrae | 27 | 38 | 0 | 13984 | 10007 | 0 | 0 | `15294b970860504d1d4c1f6286ad69256d16e871f351e53b9acfdc6f4db04227` |
| 06107 | activitysim | 25 | 40 | 0 | 13984 | 10007 | 0 | 0 | `08c241578e9d6422a7adbd71c014c5761f4026902d82b59bb116b2948c1b1122` |

## Evidence boundary

Every method record binds the release, v4 registry, unchanged v0.41 custody, exact demand matrix, shared network and external layer, pre-output audit, model output, comparison basis, and predecessor diagnosis. AequilibraE and ActivitySim values, differences, and ratios remain separate.
