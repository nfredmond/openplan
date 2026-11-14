# County appendix tier and retained metadata correction

October 23, 2026. Bounded S1 implementation and synthetic verification. S1 remains
partial. This record does not establish a release, native database acceptance,
browser acceptance or model accuracy.

## Finding and change

Base: `57be0eed1cbcf4e41dd6459a3bd6ed4df2517797`, fetched `origin/main`.
Branch: `work/s1-county-run-rules-v4-tiering`.

PR 244 merged October 12, 2026. Its shared county tier helper and stored-row
ceiling already exist on the base. KI-001 records the core fix, while the S1
roadmap still names that implementation as its next action. This correction
retains that work and closes an uncovered appendix path.

`county-run-provenance.ts` still authorized screening and funding-application
figures from the retired `bounded screening-ready` gate. It did not consult the
rules-v4 outcome. The provenance GET also called
`refreshCountyRunModelingEvidence`, which deletes and replaces evidence rows.
It swallowed exceptions and used the rebuilt bundle even when persistence
returned an error. A download could therefore change the records it described.

The appendix now calls `loadCountyRunModelingEvidence`, the reader used by county
detail and the assistant. Its assignment ceiling reuses
`countyRunDisplayableClaim` and `countyRunScientificClaimBasis`. A recorded pass
with confirmed custody supports at most screening grade. Fail, inconclusive,
unsupported rules and unconfirmed custody cannot raise the tier. An absent
claim stays explicitly untiered. The legacy gate remains a labeled diagnostic.
The appendix preserves its environmental-use refusal and explicitly refuses
sketch VMT for a CEQA determination.

County detail and appendix GET return 503 on evidence-read failure, instead of
saying that evidence or sources were never recorded. Both return 409 on a
malformed retained manifest, malformed typed validation metadata, or disagreement
between the manifest validation summary and the stored validation summary.
The shared metadata check accepts the writer's empty pre-manifest state and
preserves genuine zeros. It compares every retained summary field, including
unrecognized fields, without deriving counts or rewriting history.

No schema, database policies, worker calculations, frozen studies, consumed
partitions, preregistrations, acceptance thresholds or production defaults change.
The new summary check may refuse inconsistent historical rows. The operator
must inspect the retained records; this correction does not choose or repair one.

## Verification commands and outcomes

Run package commands from `openplan/` unless specified otherwise.

```bash
npm run product:direction:check
```

Pass. The check retains review reminders for the older capability/jurisdiction
records and the v0.66 review versus v0.72 package. No review date was refreshed.

```bash
npm ci --ignore-scripts --no-audit --no-fund
```

Pass, 969 packages installed in this worktree. No dependency files changed.
Lifecycle scripts were deliberately not run; no native addon is needed here.

```bash
npx vitest run src/test/county-run-custody.test.ts src/test/county-run-detail-route.test.ts src/test/county-run-provenance-document.test.ts src/test/modeling-evidence-backbone.test.ts src/test/validation-rules-version-matches-the-worker.test.ts src/test/county-onramp-persistence.test.ts src/test/published-comparable-observation-custody.test.ts src/test/published-comparable-observation-study.test.ts src/test/published-distributed-work-loading-custody.test.ts src/test/assistant-chat-evidence-tools.test.ts --pool=forks --maxWorkers=2
```

Final restored result: 10 files, 266 passed, 0 failed, 0 skipped. New direct
checks cover six outcome/custody combinations, an absent claim, malformed and
conflicting metadata, read failures, source citation agreement, and no download
writes. Builder checks also prevent raising a stored prototype tier and cap a
stored claim-grade tier. Existing published-study checks exercise verified
artifact bytes and summaries; they are not a new observation or holdout study.

```bash
npx eslint 'src/lib/models/county-run-custody.ts' 'src/lib/models/county-run-provenance.ts' 'src/app/api/county-runs/[countyRunId]/route.ts' 'src/app/api/county-runs/[countyRunId]/provenance/route.ts' src/test/county-run-custody.test.ts src/test/county-run-detail-route.test.ts src/test/county-run-provenance-document.test.ts
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 env NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/tsc --project /tmp/s1-county-proof/tsconfig.json --pretty false
```

Both pass with 0 diagnostics. The temporary TypeScript project extends this
worktree's package configuration, includes the seven named files and imported
dependencies, disables incremental output, and uses the package's Node type
root. This is not a whole-application type check.

## Mutation proof

The local controller command is `python3 /tmp/s1-county-proof/mutations.py`.
Each case runs:

```bash
npx vitest run src/test/county-run-custody.test.ts src/test/county-run-detail-route.test.ts src/test/county-run-provenance-document.test.ts --pool=forks --maxWorkers=2 --reporter=json --outputFile=/tmp/s1-county-proof/CASE.json
```

[Retained results](mutation-results.json) include failed test names and restored
SHA-256 values for all four changed production files. The controller restores
original bytes in `finally` and checks equality before finishing.

| Control | Passed | Failed | Skipped | Intended assertion |
| --- | ---: | ---: | ---: | --- |
| Harmless comments in four production files | 88 | 0 | 0 | Normal behavior survives |
| Bypass shared rules-v4 ceiling | 84 | 4 | 0 | Fail/inconclusive/unconfirmed stay prototype; pass stays capped |
| Relabel missing claim as screening | 85 | 3 | 0 | Missing decision stays untiered |
| Accept malformed manifest | 83 | 5 | 0 | Error text and HTTP 409 |
| Accept malformed validation metadata | 83 | 5 | 0 | Error text and HTTP 409 |
| Ignore summary mismatch | 85 | 3 | 0 | Missing accounting field refuses; HTTP 409 |
| Hide detail evidence-read failure | 86 | 2 | 0 | HTTP 503 |
| Hide appendix evidence-read failure | 87 | 1 | 0 | HTTP 503 |
| Skip detail custody check | 87 | 1 | 0 | HTTP 409 |
| Skip appendix custody check | 87 | 1 | 0 | HTTP 409 |
| Delete claim rows during appendix GET | 82 | 6 | 0 | Instrumented mutation method remains uncalled |
| Restored source | 88 | 0 | 0 | All normal checks pass |

Ten targeted controls fail as intended. They are synthetic unit and mocked-route
checks. They cannot establish actual database permissions, PostgREST projection
behavior, concurrent consistency, artifact storage or browser rendering.

## Failed attempts retained

- Initial three-file Vitest command ran from the repository root: three suite
  import failures, zero tests executed. Rerunning from the package then failed
  at configuration load because dependencies were absent, zero tests executed.
- After dependency installation: 81 passed and 1 failed. The new general
  `Claim tier` heading collided with an existing calibration-section assertion.
  The assignment heading now identifies its subject; the calibration assertion
  and historical calibration heading remain intact.
- Intermediate verification passed 211 tests before the additional ceiling and
  assistant regression cases. The final 266-test result supersedes that count.
- Temporary TypeScript setup first doubled the package path, then referenced an
  absent generated `next-env.d.ts`. Both attempts failed before checking the
  target files. The corrected project found the provenance route's concatenated
  query projection inferred as `GenericStringError`. A literal projection fixes
  the type boundary without changing selected columns. The final check passes.
- The first malformed-manifest mutation caused a downstream TypeError. That is
  not credited as refusal proof. The corrected mutation returns null directly;
  error-text assertions and both route status assertions then fail as intended.

## Remaining S1 work and decisions

This increment does not close S1's full integrity requirement. It does not verify
all observation records through UI, reports and assistant, production custody
ingestion, service-role malformed/omitted/NULL RPC probes, or source hashes for
all mutable county artifacts. Summary equality is consistency between retained
copies, not independent proof of their truth. Matching corruption of both copies
is outside this check. Separate GETs are not an atomic cross-request snapshot.

No live RLS/native suite was needed for a schema or permission change because
none occurred, and none was run. No database stack was created. No new model run,
new holdout, production or hosted service was accessed. `next build`, full Vitest
and `qa:gate` were not run under the task's machine constraints. Identified-build
desktop/390px navigation, console review and actual browser download remain
unverified. The draft must not be called complete workflow acceptance.

The lead can review this bounded correction and schedule the remaining native
and browser evidence. No product judgment or paid-data authorization is needed
for this patch. S1 stays partial and KI-001's appendix follow-up stays pending
merge and relevant acceptance.
