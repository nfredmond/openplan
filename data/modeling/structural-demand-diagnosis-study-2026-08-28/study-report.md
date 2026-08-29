# Structural demand and loading diagnosis

Date: 2026-08-28
OpenPlan: `0.43.0`
Release SHA: `e25ae7c928f437394fabfe71bc0208b947ae437e`

## Result

All fourteen development diagnoses are inconclusive. They size structural coverage and recorded limitations. They do not show improved accuracy, change a default, calibrate either method, rank methods, select a candidate, define acceptance criteria, or open a holdout.

The frozen packages do not retain a LODES provenance manifest, so the LODES vintage, seed coverage, commute-share use, and fallback use remain unknown. LODES is home-to-work job-location evidence, not all-purpose travel or vehicle trips. Non-work through travel remains unsupported. The recorded 0.35 through share is an assumption.

## Separate method records

| Geography | Method | Loaded | Unloaded | Unreachable | Excluded | Ambiguous | Unsupported | Missing output | Diagnosis SHA-256 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 06007 | aequilibrae | 3 | 0 | 0 | 5050 | 4997 | 0 | 0 | `f4e1c0daefa011eb634d953d880ecaa55640745b193246a607a998ed4957c277` |
| 06007 | activitysim | 1 | 2 | 0 | 5050 | 4997 | 0 | 0 | `f61fafadfedbe076e6b4cceaee9ce9234ac703b52b2f52a58ddc153e7bd9b73f` |
| 06039 | aequilibrae | 7 | 10 | 1 | 17982 | 11245 | 0 | 0 | `bd3c52530c5cb4d34e0f661603904193982cce66a4294aeb7b8cd3a1d04e4057` |
| 06039 | activitysim | 7 | 10 | 1 | 17982 | 11245 | 0 | 0 | `6979fce04cf73caccaf45814ab27b14beb3beaf6249e6094c4603a19a30b4269` |
| 06047 | aequilibrae | 11 | 31 | 0 | 12193 | 12018 | 0 | 0 | `dfd7a5c7108ee5780735e62b5adb797d8e687f2dcf755ac3d477f1985183c79b` |
| 06047 | activitysim | 11 | 31 | 0 | 12193 | 12018 | 0 | 0 | `937753072f942e874d41d728a515e1944dc8c7ff86511f709a0bd4a55759a4c6` |
| 06053 | aequilibrae | 8 | 49 | 0 | 8127 | 11351 | 0 | 0 | `30fb518fe9776543474bb5f7bf1936751bbbc59f534a2529e34dba54ee49ad47` |
| 06053 | activitysim | 2 | 55 | 0 | 8127 | 11351 | 0 | 0 | `40fb190111b17bf20d5bcaefa9d259f77e511c617d5d8785ab834638674f4b4b` |
| 06057 | aequilibrae | 11 | 5 | 0 | 5743 | 4504 | 0 | 0 | `098c19a3badfe07ae565144dbc6c817f77bd107cb1bf1c33cb1badf3d86e56d2` |
| 06057 | activitysim | 4 | 12 | 0 | 5743 | 4504 | 0 | 0 | `df1db9b94e27befa3a9c5e32e244b3eb05dfccf6463b441bfdc33adb563803fd` |
| 06069 | aequilibrae | 7 | 22 | 0 | 3749 | 4511 | 0 | 0 | `298cbce6fd12463f119b65dff1725b3c4952f1e0aa1a50ec3570d2c52b34f7d0` |
| 06069 | activitysim | 7 | 22 | 0 | 3749 | 4511 | 0 | 0 | `9a802449e31ab40d30c2e88a2324dfd139cb9199bc9760c2fc48f8adeb8bcfae` |
| 06107 | aequilibrae | 27 | 38 | 0 | 13984 | 10007 | 0 | 0 | `dff8db47908a8dd2c0247b110e062dbf206c8abcb911dfd69f10fe7ca290a353` |
| 06107 | activitysim | 25 | 40 | 0 | 13984 | 10007 | 0 | 0 | `5191c9b8ceb083c5d559fd659350c6738922a5ba070a6166bfd4f17ae74328b8` |

## Evidence boundary

Every method record binds the release, v4 registry, unchanged v0.41 custody, exact demand matrix, shared network and external layer, pre-output audit, model output, comparison basis, and predecessor diagnosis. AequilibraE and ActivitySim values, differences, and ratios remain separate.
