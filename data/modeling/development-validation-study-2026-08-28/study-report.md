# Development validation instrument result

Date: 2026-08-28
Git SHA: `272f731dda38c8f5fee00cc075b5a5841fc223b1`
OpenPlan: `0.39.0`

## Decision

The frozen development study is scientifically inconclusive. No use-specific acceptance rule was frozen, so these diagnostics cannot pass or fail a model, change defaults, calibrate a candidate, or support a California or nationwide accuracy claim.

AequilibraE and ActivitySim remain separate. Their values are not averaged.

## County and method results

| Geography | Method | Outcome | Matched | Ambiguous | Excluded | Unloaded | Grade C diagnostics | Model output SHA-256 |
|---|---|---|---:|---:|---:|---:|---:|---|
| 06007 | aequilibrae | inconclusive | 0 | 151 | 4260 | 4 | 0 | `a0a7bebc2919853f6cfaf9d24279084dfa703bbe0f31316443cf9873e79cbcdd` |
| 06007 | activitysim | inconclusive | 0 | 151 | 4260 | 4 | 0 | `f0184714fe9b75dc75a5d657120d6bb4074c50d0ff5b20193ab4866557a6609c` |
| 06039 | aequilibrae | inconclusive | 6 | 84 | 3234 | 0 | 0 | `fff83842440f1011ce2adaf43ebbd5c3fc8e0388c25b3474b647351e6ad62085` |
| 06039 | activitysim | inconclusive | 4 | 84 | 3234 | 2 | 0 | `15cb9225fc9595d0b112a8b5516c8cfa1caf1726764095894cf98740fe74476d` |
| 06047 | aequilibrae | inconclusive | 0 | 174 | 5433 | 0 | 0 | `d73b3cfa85c47ab2f993f99aaf36309a33ce927086c1643b0dec19ff3613d3eb` |
| 06047 | activitysim | inconclusive | 0 | 174 | 5433 | 0 | 0 | `f77dfd9eaa9c6a981681d17a6ddaf3886df7f987db27ea20f87cc14db707e224` |
| 06053 | aequilibrae | inconclusive | 4 | 155 | 5756 | 6 | 0 | `9caf23528a76dc695fb835b6257bc9bd5105dc8d7b21e47c86d493d50819b058` |
| 06053 | activitysim | inconclusive | 4 | 155 | 5756 | 6 | 0 | `c9ac3a9fe56fb28ea9065dceae7d7e91bc65b355168fa34240b7b9aeb4d71764` |
| 06057 | aequilibrae | inconclusive | 4 | 98 | 3270 | 0 | 0 | `ee8e70cfe4424ae9626565dbdc2813dfff7610b3fceffd3ba42e61ffa2f9305e` |
| 06057 | activitysim | inconclusive | 4 | 98 | 3270 | 0 | 0 | `006f92659c080ee45f9e33c4fd5f0dbe78d6456ff8e3ea4db7db7d82a4e0f8f3` |
| 06069 | aequilibrae | inconclusive | 0 | 27 | 1217 | 0 | 0 | `a2a7e363b4465d1f297e6f57b19c6262e038c55f22827f79adc18b8bd268805f` |
| 06069 | activitysim | inconclusive | 0 | 27 | 1217 | 0 | 0 | `9430bcdec20bab27f976f8496aefd4178f3f77a33c02bc55e6884c04f92692ba` |
| 06107 | aequilibrae | inconclusive | 6 | 244 | 11552 | 0 | 0 | `cb2bf1ba8fa2d8085718e57ea8f7065844995848abdfbdfe5d00f8c95e7b6dfd` |
| 06107 | activitysim | inconclusive | 6 | 244 | 11552 | 0 | 0 | `cb90361c2cb143736b9deba57e3fc83487e44d9ce84dcfa7b149db106f0adaa9` |

## Source attempts

| Geography | Source | State |
|---|---|---|
| 06007 | us-fhwa-tmas-2024 | available |
| 06007 | us-state-ca | available |
| 06007 | us-fhwa-hpms-2024 | available |
| 06039 | us-fhwa-tmas-2024 | supported_but_empty |
| 06039 | us-state-ca | available |
| 06039 | us-fhwa-hpms-2024 | available |
| 06047 | us-fhwa-tmas-2024 | available |
| 06047 | us-state-ca | available |
| 06047 | us-fhwa-hpms-2024 | available |
| 06053 | us-fhwa-tmas-2024 | supported_but_empty |
| 06053 | us-state-ca | available |
| 06053 | us-fhwa-hpms-2024 | available |
| 06057 | us-fhwa-tmas-2024 | available |
| 06057 | us-state-ca | available |
| 06057 | us-fhwa-hpms-2024 | available |
| 06069 | us-fhwa-tmas-2024 | supported_but_empty |
| 06069 | us-state-ca | available |
| 06069 | us-fhwa-hpms-2024 | available |
| 06107 | us-fhwa-tmas-2024 | available |
| 06107 | us-state-ca | available |
| 06107 | us-fhwa-hpms-2024 | available |

## Bound artifacts

Every method result binds the release-source Git SHA and version plus the exact preregistration, network, observation package, match audit, validation input bundle, model output, comparison basis, and assessment hashes in `study-result.json`.
