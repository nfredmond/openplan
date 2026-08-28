# Frozen structural diagnosis result

Date: 2026-08-28
Git SHA: `25f024ce1065c88ff0352eebb0ff49e52675e869`
OpenPlan: `0.40.0`

## Decision

The fourteen frozen v0.39 assessments remain inconclusive. This study explains structural limits without changing matches, calibrating either method, selecting a candidate, creating an acceptance rule, or opening a holdout.

AequilibraE and ActivitySim remain separate. Raw differences and ratios use identical frozen links; no values are averaged and no method wins.

## County and method findings

| Geography | Method | Missing usable coordinates | Centroid-only exclusions | Nearby network without match evidence | Genuine network absence | Zero-volume unloaded matches | Missing output rows | Unknown basis facts | Diagnosis SHA-256 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 06007 | aequilibrae | 56 | 53 | 4215 | 0 | 4 | 0 | 4 | `09507e2396bffc32339279844703e9f578bb9d47579032c0dbb22c2636d9060e` |
| 06007 | activitysim | 56 | 53 | 4215 | 0 | 4 | 0 | 4 | `b70812a826ebc1c21351240467e298043e8c2e5627252556e6c74b01dcaa3931` |
| 06039 | aequilibrae | 0 | 21 | 2818 | 0 | 0 | 0 | 4 | `25e71317cc414a751f814d5915289cdab20f16e0a4ae0c29e79d4623abd9ce81` |
| 06039 | activitysim | 0 | 21 | 2818 | 0 | 2 | 0 | 4 | `239a3ff070198b0358cff8d1c1752717d29eccdbfebd8e9fed12f9564a125877` |
| 06047 | aequilibrae | 50 | 52 | 6254 | 0 | 0 | 0 | 4 | `69dc489046730d7580f6160b2ca89972ae060e65851a07cd1b95ad0d59b3e5d7` |
| 06047 | activitysim | 50 | 52 | 6254 | 0 | 0 | 0 | 4 | `f0732955fa6d0e19dcf743b39fa6844c2a814296ba315374c1c246a7edb87ce2` |
| 06053 | aequilibrae | 0 | 331 | 6802 | 0 | 6 | 0 | 4 | `1cceba6e3c314e24dc570495e11bc8da22ad8ac8ffd7e5c9c2d48b15f45536fe` |
| 06053 | activitysim | 0 | 331 | 6802 | 0 | 6 | 0 | 4 | `b3ff4060704b78f048cc419334229937add0e856961b81731481ff5f649844f1` |
| 06057 | aequilibrae | 4 | 34 | 2859 | 0 | 0 | 0 | 4 | `43fa13376edc92d2621c031b8e7be971da28a0e08438f451b750f9a2321934d1` |
| 06057 | activitysim | 4 | 34 | 2859 | 0 | 0 | 0 | 4 | `dc41b0a0798dd754d013710785b3435e831a3fff91a142a0f938f01a609045f2` |
| 06069 | aequilibrae | 0 | 138 | 1733 | 0 | 0 | 0 | 4 | `a6810c947a19c0ea414b641f6d45866bb83fa06cd4fdcfcce518568f68447a22` |
| 06069 | activitysim | 0 | 138 | 1733 | 0 | 0 | 0 | 4 | `a4c4a45dafc891709ceca1e7546f3f3e9e4fcb68ff5c51db84385b8f897b4d92` |
| 06107 | aequilibrae | 82 | 113 | 7618 | 0 | 0 | 0 | 4 | `59d5f34671d481a224722b22985c20b454a8194d850d240a5a1c78dc06c9510d` |
| 06107 | activitysim | 82 | 113 | 7618 | 0 | 0 | 0 | 4 | `d0dc0de3d54b815640c0fb4415b939a022fc1d5389bee0e60f3731c864d76006` |

## Exact artifacts

`study-result.json` binds every diagnosis to the v0.39 preregistration, readiness gate, network, observation package, pre-volume audit, model output, comparison basis, existing assessment, diagnosis registry, source study result, release version, and source Git SHA.
