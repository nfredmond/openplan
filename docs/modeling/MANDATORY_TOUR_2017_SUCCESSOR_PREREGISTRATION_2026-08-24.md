# 2017 NHTS mandatory-tour successor: frozen checkpoint

**State:** frozen and unopened on 2026-08-24. The 2017 archive inventories and CSV headers have
been read, but no 2017 outcome row has been read. The one-opening receipt and aggregate result do
not yet exist.

This is a sealed transfer test for one ActivitySim component: mandatory-tour frequency,
conditional on an observed mandatory daily activity pattern. It does not test destination, mode,
or schedule choice; other ActivitySim components; or local corridor accuracy. No result changes an
OpenPlan default automatically.

## Frozen sources

The official current [NHTS downloads page](https://nhts.ornl.gov/downloads) supplied both archive
links. The [2017 User Guide](https://nhts.ornl.gov/assets/2017UsersGuide.pdf) and
[2017 Weighting Report](https://nhts.ornl.gov/assets/2017%20NHTS%20Weighting%20Report.pdf) supplied
the survey and replicate-design contracts.

| Role | Official archive | Bytes | SHA-256 |
|---|---|---:|---|
| 2017 core acceptance source | `https://nhts.ornl.gov/media/2016/download/csv.zip` | 83,726,358 | `4f1917d9470fbf351c325ee9fe7d4cdbf71715775d0e0c974ca57861b4d8704d` |
| 2017 person replicate weights | `https://nhts.ornl.gov/media/2016/download/ReplicatesCSV.zip` | 80,811,775 | `730c3634c0adc6945ab60436b19924e221df516970560e46585fc5613148cc46` |
| already-consumed 2022 development source | previously locked archive | — | `64530c396d5f164d2259a22f7042f27bee5147babcd367568ddbfafe6c8bf34c` |

The exact member inventory, uncompressed sizes, CRCs, required headers, join keys, and complete
column lists are frozen in
`data/modeling/mandatory-tour-frequency-2017-successor-preregistration-2026-08-24.json`.
The source URLs are unusual because the official site currently serves the 2017 files from a
`media/2016` path; the lock records the official link and exact bytes rather than correcting it.

## Contracts frozen before outcomes

- **Estimand:** Monday through Friday (`TRAVDAY` 02–06), holidays included, using `WTPERFIN` for
  the point estimate and `WTPERFIN1` through `WTPERFIN98` for replicate estimates. Absolute
  population totals are not used.
- **No student leakage:** student status and school-code predictors are excluded. School activity
  is used only to reconstruct the held-out outcome.
- **No incompatible vehicle terms:** vehicle ownership, driver status, income, state, division,
  sample source, and related geography fields are excluded from the candidate.
- **Inference:** every normalized estimate is recomputed under every replicate; variance uses the
  frozen 6/7 jackknife factor, 98 replicates, 84 design degrees of freedom, and t critical values.
  A missing, nonfinite, or nonpositive replicate denominator makes the exercise inconclusive.
- **National safety:** every preregistered national gate, transfer-cell gate, and each of the nine
  Census-division safety gates must pass for acceptance. A valid substantive failure rejects the
  candidate. A source, reconstruction, replicate, rare-cell, or effective-sample failure is
  inconclusive.

The candidate was fitted only to the already-consumed 2022 evidence across all nine divisions. It
uses age, age squared, sex, household size, and household workers, with fixed worker-by-age
reference cells. Leave-one-division-out selection favored the candidate in all nine divisions;
the selected regularization value is `0.0003`, not a search-grid boundary, and every fit converged.
The runtime-shaped CSV, YAML, coefficients, model, and manifest are frozen under
`data/modeling/activitysim-mandatory-tour-frequency-2017-successor/`.

## One-opening mechanism

The lock is
`data/modeling/mandatory-tour-frequency-2017-successor-opening-lock-2026-08-24.json`. Its
preregistration hash is
`da4d21abd5335f85c6f35bc5780fe95500d51c1e22dc80e3bb738e09af293af9`; its evaluator-closure hash
is `c233abfaf59e2226e599f69e727c2ac65990d144c275479a22e0c81573b7a600`.

Evaluation refuses if the sources, preregistration, evaluator, or candidate package differ from
the lock. It creates the receipt exclusively, flushes it, fsyncs the file and parent directory,
and only then calls the source loader. The only permitted result is aggregate JSON. An exception
after opening consumes the receipt and produces an aggregate `inconclusive` result rather than
allowing a second look.

## Mutation proof before opening

The successor test suite was run after each temporary mutation and the original text was restored
without `git checkout`:

| Mutation | Required failure |
|---|---|
| substantive decision changed from `all` to `any` | the every-substantive-gate test rejected the false acceptance |
| division safety conjunctions changed to disjunctions | the every-division-safety-gate test rejected the weakened gate |
| source loader moved before receipt creation | the receipt-order test failed because no receipt existed at loader entry |
| jackknife factor changed from 6/7 to 1 | the exact replicate-design test failed |
| student tokens removed from the forbidden set | the predictor-leakage test failed |

After restoration, all 69 mandatory-tour modeling tests passed. This proves the gates can fail in
the intended directions; it does not predict the held-out outcome.

## Freshness limit

A repository and known-session search found no prior 2017 mandatory-tour outcome artifact, and the
current work inspected only ZIP metadata and headers before the lock. That is a bounded attestation:
it cannot prove that an unrelated person or checkout never inspected the public-use source.
