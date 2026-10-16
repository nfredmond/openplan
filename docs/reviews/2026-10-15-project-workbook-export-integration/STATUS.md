# Workbook export legacy test integration

The five legacy export cases pass with candidate `702ee1270de23cb9e469711398c580d9a977878b`. The combined focused cohort passes 75 cases across nine files. This checkpoint changes the legacy test fake and adds this controller and evidence. Independent review remains pending. It establishes mocked handler, parser, serializer and component behavior within the stated boundaries.

## Checkout, direction and ownership

The assigned checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-32433c82`, branch `t3/workbook-export-pagination-legacy-tests`. It started clean at `05dd3e8da4a4572437f06e771b0a2477873e681f` and fast-forwarded with `git merge --ff-only` to exact `702ee1270de23cb9e469711398c580d9a977878b`. No reset ran. The original owner's `/home/nathaniel/.t3/worktrees/openplan/t3-9142741a` remains clean at `702ee1270`. No other checkout was changed.

The complete [pagination handoff](../2026-10-15-project-workbook-export-pagination/STATUS.md), its controls and source bindings inform this integration. Current external coordination reserves the parent's production, browser and other implementation lanes. This child reserves no production slot. Ownership covers `openplan/src/test/project-portfolio-export-route.test.ts` and this review directory. Temporary faults restore exact route and legacy test bytes in `finally`.

The nested `npm run product:direction:check` passes. Its October 6 review, November 6 deadline and two independent contexts remain unchanged, as do its older capability/jurisdiction and intervening-change reminders. The V1 contract, roadmap, capability matrix, direction review, known issues, architecture and contributor guidance inform this bounded repair. Planner-writing and prove-it apply. No product direction or geographic inference changes.

## Legacy fake and preserved behavior

The original fake exposes a terminal `.limit()` but no `.range()`. Its viewer export, over-limit refusal and unknown-price-year round trip fail against the paginated handler. `evidence/legacy-baseline.json` reproduces exactly those three assertion failures and two passing cases. It contains no suite/import failure.

The adapted fake creates a separate query for each `.from()` call. It applies equality filters, timestamp/ID ordering, inclusive ranges, the 1,000-row response cap and selected columns. It retains terminal limit semantics so restoring a single capped read still exposes the original refusal defect. It passes database errors and unavailable data through unchanged.

All five legacy cases and their original behavioral assertions remain. The former single `.limit(2001)` expectation becomes an exact per-page query assertion. A shuffled fixture includes a foreign workspace, an older timestamp, a timestamp tie, original literal text, a large decimal cost string, null price year and source/place references. The viewer case checks selected fields, workspace scope, order, ranges, one serializer call, workspace metadata and original projected rows. The cost case still runs the real serializer and reviewed importer, requiring a null price year and its warning.

No retained change touches the API route, new pagination test, serializer, workbook contract, project-place helper, API cap, import route or import tests. `evidence/source-bindings.json` compares their SHA-256 hashes with exact `702ee1270`; the legacy export test is the sole changed inherited file.

## Focused checks and fault controls

`evidence/cohort-count-corrected/combined-focused.json` records 75 passing cases, no skipped or failed cases, and no suite errors. The exact file counts are:

| Cohort | Cases |
| --- | ---: |
| CSV import review | 12 |
| Workbook import review | 16 |
| Import route | 11 |
| Importer component | 3 |
| Import action refusal | 3 |
| Legacy export route | 5 |
| Pagination export route | 9 |
| Workbook serializer/export | 5 |
| Price-year evidence, including eight parameterized cases | 11 |
| Total | 75 |

The first five rows total 45 import cases on this candidate. The separate import correction `536d4ccbd6` is a known commit but is not an ancestor of this branch. Its four additional route cases and 49-case import cohort are absent. This checkpoint does not claim that correction is integrated.

`evidence/cohort-count-corrected/lint.json` records scoped ESLint exit zero with `--max-warnings 0` for the changed TypeScript file. No full-suite or build result is claimed.

The source controls comprise 29 complete groups, each with a positive, harmless comment survivor, intended named assertion failure and restored positive. All 13 original pagination faults run again against this checkout. Sixteen integration faults protect the five legacy outcomes, projection, workspace filter, timestamp order, ID tie-breaker, range request, original source metadata, the fake's filter/order/projection/inclusive-range behavior and restoration of a single capped terminal read. `evidence/controls.json` and `evidence/continuation/controls.json` retain the trials; `evidence/audit-replay.json` reclassifies them with the final controller.

The integration fault bindings are:

| Fault | Named assertion |
| --- | --- |
| Change viewer success status | `viewer export must remain successful` |
| Return success without workspace | `missing workspace must stop before reads` |
| Discard the over-limit row | `legacy over-limit export must refuse without a workbook` |
| Substitute a price year in route output | `legacy round trip must preserve an unknown price year` |
| Return success after a denied read | `denied project read must fail without a workbook` |
| Omit projection/filter/order or alter the requested range | `every legacy read must preserve projection scope order and inclusive range` |
| Remove original source metadata | `legacy workbook must retain ordered scoped original metadata` |
| Disable the fake's filter | The per-read query assertion above |
| Disable the fake's ordering or projection | The original metadata assertion above |
| Exclude the fake's final inclusive row | The over-limit refusal assertion above |
| Restore a single capped limit query | The over-limit refusal assertion above |

The strict single-test classifier requires the exact file and active test name, expected process exit, matching summary counts and one `AssertionError` carrying the named diagnostic. It refuses runtime/import errors, empty selection, wrong file/test/assertion, extra failures, extra active cases and inconsistent status/summary. Fourteen synthetic refusals exercise those boundaries. A deliberately vacuous classifier fails its diagnostic audit. The final cohort guard also has a harmless report mutation and a removed-case fault that fails `combined cohort must execute every expected case`.

## Retained failed trials and recovery

Earlier failures remain visible and do not count as product defects or successful kills:

- `evidence/setup-trial.log` records an initial repository-relative path used from the app directory. The failed commands ran no tests. Owned empty misplaced directories were removed with `rmdir`.
- `evidence/direction-first-bwrap.log` retains a missing `/dev` mount that prevents Git opening `/dev/null`. Adding `--dev-bind /dev /dev` fixes the harness; the successful direction result is separate.
- `evidence/legacy-first-cwd.json` retains an alias/import startup failure from invoking the private config at repository root. The corrected baseline runs from the nested application directory.
- `evidence/legacy-fake-inclusive-range-fault.json` retains a real survivor. Excluding the range's final row does not affect the three-row viewer fixture. The classifier refuses to call that result a kill. The continuation binds this fault to the existing 2,001-row case, where losing that row changes refusal to success and fails the intended assertion.
- `evidence/continuation/combined-focused.json` retains the jsdom startup failure caused by omitting Vitest globals required by the existing setup file. The private config then restores the repository's `globals: true` setting.
- `evidence/cohort-final/combined-focused.json` records 75 passing cases, while its controller rejects an incorrect expected total of 67. Source inspection confirms eight parameterized price-year cases in addition to three ordinary cases. The final guard checks exact per-file counts and all 75 statuses. The corrected cohort runs separately.

Historical controller sources and logs retain these attempts. All mutation runs restore exact source bytes, including after refused classifications. Restoration records accompany each stage.

## Resources, rerun and limits

Every test/lint cohort runs serially in an owned transient systemd scope with `MemoryMax=1G`, `MemorySwapMax=0`, one Vitest worker, no file concurrency and a 640 MiB Node heap. Bubblewrap mounts the canonical dependencies read-only; private configs and Vite caches live under this checkout's ignored `openplan/.operator-private/workbook-integration/`. The final cohort scope records a 323,121,152-byte peak and zero OOM events in `evidence/cohort-count-corrected/resources.json`. No application service starts.

To run all final controls, use a fresh evidence destination and installed dependencies or the same read-only dependency link. From the repository root:

```bash
systemd-run --user --scope --quiet \
  -p MemoryMax=1G -p MemorySwapMax=0 \
  bwrap --bind / / --dev-bind /dev /dev \
  --ro-bind /home/nathaniel/code/openplan/openplan/node_modules /home/nathaniel/code/openplan/openplan/node_modules \
  python3 -B docs/reviews/2026-10-15-project-workbook-export-integration/verify_controls.py \
  --output /absolute/path/to/fresh-evidence
```

The controller refuses existing trial files. `--start-at` and `--cohort-only` support bounded continuation; they do not establish omitted controls. This checkpoint's complete control set spans the original and continuation records.

The fake and query assertions cannot establish live authentication, current membership, RLS, PostgREST caps/collation/order, transaction behavior or concurrent-edit consistency. The legacy viewer case mocks the serializer; the retained real-workbook cases protect a different boundary. Component checks cannot establish browser navigation, download bytes, native spreadsheet usability, responsive layout, accessibility or practicing-planner acceptance. The evidence classifier can verify identity and failure diagnostics but cannot decide whether a future fixture models an actual installation.

No full suite, build, browser, database, worker, service, hosted operation, PR, push, main merge or nested delegation runs. The parent retains independent review and identified integrated-build acceptance, including the separate import correction and its 49 cases if integrated later. This commit is a local candidate, not a release or deployment.
