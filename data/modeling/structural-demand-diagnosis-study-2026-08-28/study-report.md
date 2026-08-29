# Structural demand and loading diagnosis

Date: 2026-08-28
OpenPlan: `0.43.0`
Release SHA: `f52235f9d92922c25719797b5e9a36ec44bb09b5`

## Result

All fourteen development diagnoses are inconclusive. They size structural coverage and recorded limitations. They do not show improved accuracy, change a default, calibrate either method, rank methods, select a candidate, define acceptance criteria, or open a holdout.

The frozen packages do not retain a LODES provenance manifest, so the LODES vintage, seed coverage, commute-share use, and fallback use remain unknown. LODES is home-to-work job-location evidence, not all-purpose travel or vehicle trips. Non-work through travel remains unsupported. The recorded 0.35 through share is an assumption.

## Separate method records

| Geography | Method | Loaded | Unloaded | Unreachable | Excluded | Ambiguous | Unsupported | Missing output | Diagnosis SHA-256 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 06007 | aequilibrae | 3 | 0 | 0 | 5050 | 4997 | 0 | 0 | `fbb6897d3271493cc175e3f498011fdfb8207e67ce7ab138bf430017f15a36fe` |
| 06007 | activitysim | 1 | 2 | 0 | 5050 | 4997 | 0 | 0 | `6f33279109234b2405bec3b83189a96000a7ed507a593155a777b464b0e3ed7b` |
| 06039 | aequilibrae | 7 | 10 | 1 | 17982 | 11245 | 0 | 0 | `95625b5d6af2b5a0ed7bb3e6394a9f5876ee642b489d349b88cb506c8f3f2370` |
| 06039 | activitysim | 7 | 10 | 1 | 17982 | 11245 | 0 | 0 | `5594a890c34994935f424ef538927eb5018c6e8541a3d2ab714b195d942465f1` |
| 06047 | aequilibrae | 11 | 31 | 0 | 12193 | 12018 | 0 | 0 | `f8e81aad5b8d38c229ba354433997268d91f6786ef2066760e1ac3e7e5a333a4` |
| 06047 | activitysim | 11 | 31 | 0 | 12193 | 12018 | 0 | 0 | `3faaed0ecb30e2461f1bca5268f7a2014e87450e08b7f1469a49867cee414efc` |
| 06053 | aequilibrae | 8 | 49 | 0 | 8127 | 11351 | 0 | 0 | `8b71db1cb149b9b2bbc3d89bb779991ce117672690fde1dbe1728af208c2e447` |
| 06053 | activitysim | 2 | 55 | 0 | 8127 | 11351 | 0 | 0 | `f2c4f3ec513bfbc9a1f041b411c027376ae1f3aae71b7f84cc1b9708937b2cdd` |
| 06057 | aequilibrae | 11 | 5 | 0 | 5743 | 4504 | 0 | 0 | `4afee0920d673e1afcc41595e56a8ea4fe40eb8d49f6173f2646c8cb2cfbb69a` |
| 06057 | activitysim | 4 | 12 | 0 | 5743 | 4504 | 0 | 0 | `64cf7f44606864aa55132d2b88539eda4d57247e6ce8d346830b93126e718567` |
| 06069 | aequilibrae | 7 | 22 | 0 | 3749 | 4511 | 0 | 0 | `92eb6e16f94344abf41d5abed7898d4229b2bead88c0ec0b3e39330bdadbceaf` |
| 06069 | activitysim | 7 | 22 | 0 | 3749 | 4511 | 0 | 0 | `cee62f9420e07297ddc7268ccfd9003c5e2bcb2cb195e7f199ee9dc31bbeb053` |
| 06107 | aequilibrae | 27 | 38 | 0 | 13984 | 10007 | 0 | 0 | `69deb8b10f45e754390cace3579fd3e811826a2147ea419626279320b8bf3501` |
| 06107 | activitysim | 25 | 40 | 0 | 13984 | 10007 | 0 | 0 | `12bb44791d5120b2e61844cde0c9664b6fea68b0e48153f05294885845a9033a` |

## Evidence boundary

Every method record binds the release, v4 registry, unchanged v0.41 custody, exact demand matrix, shared network and external layer, pre-output audit, model output, comparison basis, and predecessor diagnosis. AequilibraE and ActivitySim values, differences, and ratios remain separate.
