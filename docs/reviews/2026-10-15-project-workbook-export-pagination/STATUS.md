# Project workbook export pagination checkpoint

The capped query mock reproduces workbook truncation on main `b259d73e56d22d4935ef2789874cf69901786b33`. The corrected route exports all 2,000 supported projects and refuses the 2,001st with HTTP 409 and `code: row_limit`. This is handler and workbook evidence with mocked database access, not a live installation finding or acceptance result.

## Ownership and source

The assigned checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-9142741a`, branch `t3/project-workbook-export-pagination`. It began clean at `05dd3e8da4a4572437f06e771b0a2477873e681f` and fast-forwarded after `git fetch origin` to the current fetched main, `b259d73e56d22d4935ef2789874cf69901786b33`, which includes PR 327. No reset ran. The external coordination file's first entries reserve the parent's production, integration, browser and jurisdiction work. This child takes no production slot and changes no shared checkout.

Owned files are the workbook export route, the new `project-workbook-export-pagination.test.ts`, and this review directory. No workbook helper change is necessary. Importer code, import API/tests, jurisdiction/export-evidence code and GeoPackage files remain untouched. The separate import correction `536d4ccbd6` is not integrated or reviewed here.

`npm run product:direction:check` ran from nested `openplan/` and exited zero. It identifies the October 6 direction review, November 6 deadline, two independent contexts and package v0.68.0. It also reports older jurisdiction/capability reviews and intervening commits. Those reminders remain visible; no review date, capability grade, contract or roadmap changes. The V1 contract, roadmap, capability matrix, current direction review, known issues, architecture and contributor guidance informed this bounded repair. Planner-writing, prove-it and any-place guidance apply. No new geographic inference or provider is introduced.

`evidence/source-bindings.json` records baseline and candidate SHA-256 hashes and the supplied portfolio-intake finding's source hash. The route changes from `110a5bb8181b18ebd1d13307c6d38427d4f0b07fab6f7f47438f161891659cb7` to `efd81d2e4a2bc9b181dca617d60c5ce6b21f9db65b596f306f4fa1d11257bbd9`. The workbook serializer, round-trip contract, project-place helper, API cap configuration and legacy route test retain their baseline bytes.

## Reproduction and correction

The original route requests `.limit(PORTFOLIO_IMPORT_MAX_ROWS + 1)` once. `openplan/supabase/config.toml` sets `max_rows = 1000`; the importer row limit is 2,000. The new fake executes the real handler and serializer. It applies the selected projection, workspace equality filters, ordered columns, inclusive ranges and API response cap. It implements the original terminal limit request too. Synthetic fixtures retain null price years, literal operator-prefixed names, large decimal cost strings, original project/document IDs, source labels, place references and timestamps.

`evidence/original-reproduction.json` retains three passing and six failing cases against the original source. The 2,000-row case produces 1,000 rows. The 2,001-row case returns HTTP 200 instead of the named 409 refusal. A 137-row cap also truncates the original export. These are controlled reproductions under faithful configured-cap semantics. Actual PostgREST/database behavior remains the parent's boundary.

The corrected route:

- Repeats the unchanged projection and membership workspace filter on every page.
- Orders by `updated_at` descending, then `id` ascending to resolve timestamp ties.
- Requests inclusive pages of at most 1,000 rows, bounded at row index 2,000.
- Advances by the actual number of received rows and reads until an empty page. A smaller configured response cap cannot turn a short page into a false end.
- Retains at most 2,001 rows before the existing explicit over-limit refusal. Exactly 2,000 rows require an empty sentinel read; they still export.
- Returns HTTP 500 for a failed or unavailable page, without returning a partial workbook. Empty successful reads still produce the original header-only workbook.

Authentication, current membership, viewer access, serializer, filename, MIME type, private/no-store response, IDs, original data values and workbook format stay on their existing paths. Null metadata stays null until the unchanged serializer emits blank cells. Source-location labels and place identity remain reference fields. This change does not turn them into project geometry, jurisdiction or adopting authority. It does not add a jurisdiction column to the existing format.

## Checks and controls

`evidence/candidate-focused.json` records all nine new focused cases passing. The real workbook is parsed with SheetJS and compared against every expected row and original value, with worksheet names, literal-cell behavior, workspace ID, row-count metadata and response headers checked. Other cases cover every page's projection/filter/order/range, a smaller cap, explicit over-limit refusal, later errors/unavailable pages, empty results, anonymous users and missing active membership.

`verify_controls.py` runs selected tests serially and restores the candidate route bytes in `finally`. Its classifier requires the exact active test name, exit code 1, exactly one failed assertion and that assertion's named diagnostic. It rejects runtime errors, import/suite failures, empty selection, the wrong test, the wrong assertion, an unexpected exit code and extra failures. `evidence/controls.json` records 52 classified trials: 13 positive, 13 harmless survivors, 13 intended assertion failures and 13 restored positives. Each new test has its own harmless trial and intended fault. Additional faults protect the query guards. Named fault bindings are:

| Fault | Named assertion |
| --- | --- |
| Stop after 1,000 received rows | `complete workbook must preserve all original rows and literal metadata` |
| Omit summary projection | `every page must retain scope projection stable order and bounded ranges` |
| Filter by user ID instead of membership workspace | Same page-query assertion |
| Omit ID tie-breaker | Same page-query assertion |
| Reverse timestamp order | Same page-query assertion |
| Remove the last-range bound | Same page-query assertion |
| Treat a short capped page as exhaustion | `short server pages must not truncate the workbook` |
| Discard the over-limit row before checking | `over-limit portfolio must refuse before creating a workbook` |
| Export prior rows after a later read error | `later page read failure must not export a partial workbook` |
| Treat an unavailable later page as exhaustion | `unavailable data must not become a successful empty page` |
| Refuse a successful empty portfolio | `empty successful read must still export the workbook` |
| Return success to an anonymous caller | `anonymous caller must stop before portfolio access` |
| Return success without active membership | `missing membership must stop before portfolio access` |

`evidence/restoration.json` confirms exact source restoration. Individual reports/logs preserve the intended failures and original reproduction. `evidence/lint.json` records scoped ESLint exit zero for the route and new test. The controller's later resource-recording addition is checked for syntax and replayed classification without rerunning the completed fault cohort.

All test and lint processes use an owned transient systemd scope with `MemoryMax=1G`, `MemorySwapMax=0`, one Vitest worker, no file concurrency and a 640 MiB Node heap. Bubblewrap mounts the reused canonical dependencies read-only. Vite uses a private worktree cache. `evidence/resources.json` samples the running controller's cgroup: the limit is 1,073,741,824 bytes, swap is zero, and the peak observed at that sample is 237,772,800 bytes with no OOM event. This is a sample during the run, not a final whole-run peak or a capacity benchmark.

To rerun controls, first preserve existing evidence under another name, since the controller refuses to overwrite trials. Install dependencies or provide the same read-only dependency link, then run from the repository root:

```bash
systemd-run --user --scope --quiet \
  -p MemoryMax=1G -p MemorySwapMax=0 \
  bwrap --bind / / \
  --ro-bind /home/nathaniel/code/openplan/openplan/node_modules /home/nathaniel/code/openplan/openplan/node_modules \
  python3 -B docs/reviews/2026-10-15-project-workbook-export-pagination/verify_controls.py
```

## Integration boundary and limits

The scoped three-file cohort has **16 passing cases and three failing legacy cases**, retained in `evidence/scoped-cohort.json`. The old `project-portfolio-export-route.test.ts` fake exposes only an asynchronous terminal `.limit()` and no `.range()`. Its successful export, over-limit and unknown-price-year cases therefore receive the handler's caught HTTP 500. Its success case also explicitly expects one `.limit(2001)` call. The parent must adapt that legacy fake and expectation to paginated reads before treating the route suite as green. Those existing tests remain unchanged because this child's ownership permits new focused tests only. No production fallback for an incomplete test fake is added.

The new null-data refusal is defensive behavior for an unavailable page. It is not a separately established live defect. The original route never attempts a second page in those controlled later-page cases.

The tests cannot establish live authentication, membership freshness, RLS, actual PostgREST cap/projection/order behavior, native spreadsheet use, browser downloads, accessibility or real planner acceptance. Offset paging has deterministic order for a stable dataset but does not provide a transactionally consistent snapshot during concurrent inserts, deletes or updates. This repair makes no concurrency snapshot, large-portfolio latency or capacity claim. The unchanged serializer and contract hashes support format preservation; the focused test does not independently validate a coordinated future serializer/contract rewrite.

The parent owns the identified integrated build, real Projects navigation at desktop and 390px, console review, actual download bytes, native file permissions, actual database/cap behavior and capacity. Full suite, build, browser, database, migrations, services, hosted operations, PRs, merge, push and nested agents do not run here. This is a local commit checkpoint for review, with the legacy test adaptation explicitly open.
