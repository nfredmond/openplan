# Independent workbook export review

Bounded source acceptance. I find no functional P1 or P2 in the reviewed pagination correction or legacy test integration. This conclusion applies to a stable readable dataset and the existing workbook contract. It does not establish a transaction snapshot, live PostgREST behavior or release acceptance.

## Exact scope and custody

The reviewed candidate is `54537205a4f7c47f1f68f0827209bbf55de505d9`. Its direct parent is `702ee1270de23cb9e469711398c580d9a977878b`, which contains the production correction. That parent's direct parent is `b259d73e56d22d4935ef2789874cf69901786b33`. The latest commit changes one inherited application file, `openplan/src/test/project-portfolio-export-route.test.ts`. It changes no production source.

The assigned checkout starts clean at `05dd3e8da4a4572437f06e771b0a2477873e681f`, branch `t3/review-workbook-export-pagination`. After reading AGENTS and the current external coordination entries, I fetch `origin/main` and fast-forward only this tree to exact `b259d73e56d22d4935ef2789874cf69901786b33`. The recorded merge hold remains in force. Candidate inspection and private extraction use Git objects, without checking out either candidate. Both candidate owner trees remain clean at their respective exact commits.

Ownership covers this directory and disposable private copies. The [source identity record](evidence/source-identities.json) binds 18 source and evidence objects by Git blob and SHA-256. Important source hashes are:

| Source | SHA-256 at candidate |
| --- | --- |
| Production export route | `efd81d2e4a2bc9b181dca617d60c5ce6b21f9db65b596f306f4fa1d11257bbd9` |
| Adapted legacy route test | `4cfa8720b9382ebbd83a49e459e4db175bc8c6c7d87612774960e80f27e223c9` |
| New pagination route test | `be5f01ad6b195f5726d041b281ce028cb1a43eccb5c0e261263dee4f922eb1a6` |
| Unchanged workbook serializer | `24f201a4eed2fa91dabecca90352c6620a7f5d4d8ead442d4b1d7457bfa54e5d` |
| Final integration controller | `a8cb09314e5d956cf09979bfeacfb9c6e2dffdab9b6024e68031ced2358ec0e8` |

I read both complete candidate STATUS records, controllers, source bindings, controls, retained failures and restoration evidence. I also read the binding direction records and relevant architecture and contributor guidance. Planner-writing and prove-it apply. The nested direction check exits zero, with the existing expired registry/matrix and intervening-change reminders retained in [direction.log](evidence/direction.log). No product grade, review date or scope changes.

## Pagination meets the stated row boundary

The original `.limit(2001)` remains subject to the configured 1,000-row API cap. The new route requests inclusive ranges, repeats the same projection and membership workspace filter, and orders by descending `updated_at` then ascending `id`. UUID identity breaks timestamp ties. This establishes deterministic ordering for stable data; tie ordering was previously unspecified.

For each nonempty response, the accumulated row count strictly increases. An empty response terminates the loop, and an error, unavailable response or thrown exception returns HTTP 500. Each request ends at or before index 2000. A conforming server returns at most the requested rows, so the route retains at most 2,001 projects before refusing an oversized portfolio. This bounds row storage and request count, not response bytes or production latency.

The independent probes observe these boundaries:

| Portfolio rows | Server cap | Requests | Outcome |
| ---: | ---: | ---: | --- |
| 0 | 1,000 | 1 | Header-only workbook |
| 1,000 | 1,000 | 2 | Complete workbook |
| 2,000 | 1,000 | 3 | Complete workbook |
| 2,001 or 3,500 | 1,000 | 3 | HTTP 409, `row_limit` |
| 2,000 | 137 | 16 | Complete workbook |
| 2,001 | 137 | 15 | HTTP 409, `row_limit` |
| 2,000 | 1 | 2,001 | Complete workbook |
| 2,001 | 1 | 2,001 | HTTP 409, `row_limit` |

Additional cases cover 1, 999 and 1,001 rows and a server cap above the request size. Every request's projection, scope, ordering and exact range is checked. Later errors, null data, thrown transport failures and responses containing both data and an error produce JSON failures without download headers.

For successful cases, the response bytes equal the unchanged serializer's bytes for independently ordered original rows, the same workspace and a fixed generation time. This checks complete rows, all columns and metadata, original IDs, large decimal strings, blank unknown price years and literal operator-prefixed names. It also checks workbook sheets and response cache policy. It is serializer-input parity, not a claim that an old response with unspecified tie ordering has identical bytes. Source-place fields remain source references. No geography, jurisdiction or adopting authority is inferred.

## The legacy fake protects the current query shape

The revised fake creates a query per read and applies equality, ordering, projection, inclusive ranges and a 1,000-row cap. The five legacy outcomes remain: viewer export, missing workspace refusal, over-limit refusal, unknown-price-year round trip and denied-read refusal. The old single-limit expectation becomes an exact per-page query assertion.

I independently disable projection in a private fake copy. The original-metadata assertion fails. I also exclude each range's last row. The small viewer case survives, because subsequent reads recover its omitted row. The 2,001-row case then fails its named refusal assertion, reproducing the retained survivor and corrected binding. The final fake is therefore sensitive to the required distinction.

Its fidelity remains bounded. String comparisons do not emulate PostgreSQL timestamps, null ordering or arbitrary collation. The production schema has nonnull timestamps and UUID IDs; the fixtures use comparable timestamp forms. The terminal Promise fake also does not model every possible fluent combination of `.limit()` and `.range()`. The current route uses range alone. The installed client source confirms that range writes `offset=from` and `limit=to-from+1`, while limit alone writes a requested limit. No live server result is claimed.

## Evidence counts and failure classifications hold

The independent [evidence audit](evidence/final/evidence-audit.json) reclassifies all 52 original pagination trials and 118 accepted integration trials using the final strict classifier with the correct recorded file roots. The latter include two superseded positive/harmless trials. Selecting the complete groups gives exactly 116 trials: 29 positives, 29 harmless survivors, 29 named assertion failures and 29 restored positives. These cover 13 original faults and 16 integration faults. The one retained refused trial is the genuine inclusive-row survivor, not a successful kill.

All recorded source bindings match the requested Git objects. All five inspected restoration records match exact candidate source bytes. The final classifier requires the selected file/test, process exit, active assertion count, summary status and named `AssertionError`. Its 14 synthetic refusals and vacuous-classifier diagnostic control rerun successfully. The cohort guard accepts a harmless report change and rejects a removed case. The retained 75-case report also fails the old incorrect 67-case expectation.

The independent focused rerun executes these exact counts, with every case passing and none skipped:

| File group | Cases |
| --- | ---: |
| CSV review / workbook review / import route / importer / action refusal | 12 / 16 / 11 / 3 / 3 |
| Legacy export / pagination export / serializer export | 5 / 9 / 5 |
| Price-year evidence, including eight parameterized cases | 11 |
| Total across nine files | 75 |

The import subtotal is 45. Commit `536d4ccbd6` is absent from the candidate ancestry. Its 49-case import correction is not integrated here.

The 17 new private probes have a harmless source survivor. Success-status, refusal-status and failure-status mutations fail their intended assertions across all 17 cases. An early pagination break fails the exact termination check. The two fake faults described above fail their named assertions. Restoration runs all 17 probes and five legacy cases successfully. [run-summary.json](evidence/final/run-summary.json) records these failures, restoration hashes and resource limits. Additional direct range and row-content faults challenge the query and byte-parity assertions; [extra-controls.json](evidence/final/extra-controls.json) records those outcomes and a final 17-case restoration.

## Retained harness failures and limits

My first replay changes the classifier's application root to the recorded owner root but initially leaves that root active for its synthetic self-check. Its path-relative operation refuses execution. I restore the private root before that self-check. [The initial traceback](evidence/review-run.log) remains visible.

My first boundary run uses the private runner's default five-second test timeout. Its 2,000-row and 2,001-row one-row-cap cases take about seven seconds each and time out; the other 15 pass. The corrected private config uses the repository's 20-second test timeout, without changing assertions. The original reports remain under `evidence/`; final successful evidence is separate under `evidence/final/`. Neither harness failure counts as a candidate defect or a killed functional fault.

All test runs use one worker, no file concurrency, a 640 MiB Node heap and an owned systemd scope with `MemoryMax=1G` and `MemorySwapMax=0`. Bubblewrap mounts reused dependencies read-only. Source copies and caches live in private temporary directories. The main probe run records a 414,097,408-byte cgroup peak and zero OOM events. The additional-control scope has its own resource record. These describe this synthetic workload, not application capacity.

Offset paging does not provide a database snapshot. Concurrent inserts, deletes, timestamp updates or visibility changes can omit or repeat rows between successful requests. A successful empty page cannot distinguish exhaustion from concurrent loss of visibility. The candidate already discloses this limitation and makes no snapshot claim. A very small positive cap also causes many serial requests; production request deadlines and capacity remain untested.

Mocks and parser round trips do not establish live authentication, membership freshness, RLS, actual PostgREST caps and empty-page responses, downloaded file custody, native spreadsheet usability, browser navigation, desktop/390px behavior, accessibility or planner acceptance. Evidence classification cannot establish that a fixture represents every installation. The parent retains these integrated checks and release acceptance.

No production source, original test or candidate controller changes. No full suite, build, browser, native database, migration, worker service, hosted operation, GitHub action, PR, push, merge or nested agent runs. This commit records review and synthetic probes only.

To rerun in a fresh evidence directory from this repository root:

```bash
systemd-run --user --scope --quiet -p MemoryMax=1G -p MemorySwapMax=0 \
  bwrap --bind / / --dev-bind /dev /dev \
  --ro-bind /home/nathaniel/code/openplan/openplan/node_modules /home/nathaniel/code/openplan/openplan/node_modules \
  python3 -B docs/reviews/2026-10-15-project-workbook-export-independent/run_review.py \
  --output /absolute/path/to/new-evidence
```
