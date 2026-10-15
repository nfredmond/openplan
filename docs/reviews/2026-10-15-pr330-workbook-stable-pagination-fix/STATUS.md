# PR 330 workbook pagination correction

The old reader reproduces the P1 omission and duplication when an unread project changes `updated_at` between pages. It returns four rows, satisfying the expected count, but repeats `project-00001` and omits `project-00002`. The corrected reader passes all 24 focused route and workbook cases. All 24 targeted controls fail at their intended assertions, and exact source restoration succeeds. This is synthetic in-process handler and workbook evidence, with mocked database access.

## Ownership and direction

This worktree is `/home/nathaniel/.t3/worktrees/openplan/t3-2eb62187`, branch `t3/pr330-workbook-stable-pagination-fix-20261015`. It starts clean at `05dd3e8da4a4572437f06e771b0a2477873e681f` and fast-forwards only its own branch to exact local parent `401c44a0f7bfe4b54740e2c3d07e30f8ed36f169`. No fetch or reset runs. The integration owner is `/home/nathaniel/.t3/worktrees/openplan/t3-e33fc359`. The finding is [PR 330 discussion r4285653394](https://github.com/nfredmond/openplan/pull/330#discussion_r4285653394).

Ownership covers the workbook export route, its pagination and legacy route tests, and this directory. Planner-writing and prove-it guide this correction. No geography field, interpretation or serializer changes. Existing source-location fields retain their exact projection and meaning.

The current repository AGENTS, external coordination record, V1 contract, roadmap, capability matrix, October 6 direction review, known issues, architecture and earlier workbook pagination, integration, layout and native reports inform this bounded work. `npm run product:direction:check` runs from nested `openplan/` before source implementation and exits zero. Its registry expiry, package/review version and intervening-change reminders remain unchanged. This correction does not change product direction or lift the integration owner's promotion hold.

## Reader and preserved contract

The reader orders queries by `id ASC`, adding `id > lastId` after each received page. It limits each read to the smaller of 1,000 and the remaining allowance through row 2,001. It advances using the final received ID and continues until an empty response. A short server cap is not exhaustion. Exactly 2,000 projects still require an empty sentinel read; a received 2,001st project triggers the existing HTTP 409 `row_limit` response.

Every page retains the same selected columns and membership workspace predicate. The existing user-bound client remains in use. Query errors and unavailable data return HTTP 500 without a partial workbook. Authentication, viewer access, serializer, literal cell values, unknown price year, decimal strings, attachment headers and private/no-store behavior remain on their existing paths. No migration is necessary.

After collection, the reader sorts received rows by the `updated_at` instant descending and ID ascending. It preserves PostgreSQL microseconds beyond JavaScript's millisecond precision. This preserves the prior presentation order for the values actually read, including equivalent instants expressed with different UTC offsets.

The ID cursor prevents normal mutable field edits from shifting an unread project behind an offset. It does not create an atomic content snapshot. An already-read project can change later, and row values come from separate requests. Concurrent insertions behind the cursor can be absent, later insertions can appear, and deleted or newly inaccessible rows can disappear. Project-ID changes and changes in workspace visibility are outside this correction's guarantee. No all-concurrency or snapshot claim follows from the synthetic test.

## Focused checks

The new adversarial case edits an unread row's `updated_at` immediately before the second database read. It separately checks that the edit runs, that the expected count survives, that the exact ID multiset contains each original project once, and that final presentation uses the received values. On the original route, the ID assertion fails despite the correct count. The unchanged old report's stable-data caveat therefore remains material.

The corrected focused cohort passes 24 cases: 11 pagination cases, six legacy route cases and seven serializer cases. Query assertions require the exact projection, workspace filter, ascending ID order, strict cursor and bounded limit on every page. Other cases cover caps of 1,000, 137 and two; 2,000 and 2,001 projects; later read errors and null data; empty portfolios; anonymous users; missing membership; literal workbook values; unknown price year; asynchronous serializer failure; timestamp offsets, microseconds and ties.

The first private configuration uses a Node environment and records 23 passing cases plus a serializer layout failure, `ReferenceError: DOMParser is not defined`. Both route files pass in that run. The corrected private configuration supplies jsdom, and all 24 cases pass. The failed run remains retained and does not count as a product failure or successful mutation kill.

## Controls and restoration

`evidence.json` records 26 accepted trials: one harmless cohort with 17 active route cases, 24 single-case targeted assertion failures, and the final restored cohort with all 24 focused cases passing. Every inherited route case remains covered. The final controller reclassifies retained accepted trials before continuing, checks their report hashes and verifies that restored candidate source matches the original run. It does not rerun accepted faults during continuation.

The faults cover lost pages, selected-field projection, workspace predicate, cursor column, ID order, plus-one allowance, short caps, over-limit refusal, later read errors, unavailable pages, empty results, authentication, membership, restored old offset behavior, timestamp direction, microsecond precision, asynchronous serializer failure, unknown price year and both fakes' cursor behavior. The old offset fault fails the named exact-ID assertion after the count assertion passes. The harmless comment survives every one of the 17 route cases, demonstrating that the harness can report survival.

The strict classifier requires exact test identity and active count, the expected process exit, exactly one failed assertion and its intended diagnostic. Eight altered reports are refused: runtime error, suite error, empty selection, wrong test, wrong file, wrong assertion, wrong exit and extra failure. Each mutation restores its file bytes in `finally`; the outer `finally` restores all three source/test files too. The final restoration receipts and source hashes match.

One rejected cursor-fake trial remains retained. Replacing strict `>` with `>=` repeats the last ID until the bounded reader refuses with HTTP 409. The initial diagnostic expected the later ID assertion, so the classifier refuses that trial rather than misclassifying it. The continuation names the earlier 409-versus-200 assertion and records a new targeted failure. It also confirms that removing the legacy fake's cursor fails its viewer-success assertion. The rejected attempt does not inflate the 24 accepted failures.

The initial control run and continuation retain their separate resource receipts. Both report the enforced memory and swap limits and zero OOM events. The continuation's final sampled cgroup peak is recorded in `evidence.json`. These samples are check-process observations, not application or database capacity evidence. Scoped ESLint passes for the three changed TypeScript files with zero warnings. The final controller parses successfully. The final staged source hygiene and ownership checks run before the local commit.

## Resource and evidence boundary

Checks run serially under `/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock`, each in an owned transient systemd check service. Limits are 1,536 MiB service memory, zero swap, a 1,024 MiB Node heap, one Vitest worker and no file parallelism. The services use a 50 percent CPU quota. Dependency reuse is an ignored symlink to the authorized donor and a read-only bind mount during Vitest. Each private config directs Vite caches into the new private proof directory. No dependency install, download or donor cleanup occurs.

`source-bindings.json` pins the changed route/tests and six unchanged serializer, contract, workbook, place, layout and cap files against the exact parent. Private reports, logs and configs are retained under `/home/nathaniel/.local/state/openplan/privatepr330-workbook-stable-pagination-fix-20261015`. Public evidence contains synthetic outcomes and source hashes, not credentials, user records or raw histories.

Confirmed: the original mutable-sort defect in the synthetic handler test, corrected focused behavior, unchanged selected-field contract, and final sorting within the tested timestamp forms. Not confirmed: actual PostgREST cursor encoding and UUID comparison, RLS or current membership freshness, native spreadsheet use, browser navigation and download, accessibility, capacity, atomic contents or every concurrent insert/delete case. Mock query assertions inspect the request contract, but cannot establish database enforcement or transport behavior. Workbook parser checks inspect emitted bytes, but cannot establish native application use.

The prior [native pagination report](../2026-10-15-workbook-live-pagination/REPORT.md) proves the old offset behavior on its pinned route. It does not accept this changed reader. The frozen V6 APP49 runtime, database 6150036 and prior browser/native artifacts remain owned by the parent and unchanged by this work. They do not accept the changed source head.

No browser, database transport, app service, build, full suite, hosted operation, provider configuration, push, merge, release or nested delegation runs here. The only started services are the authorized bounded check services. The local commit is for parent integration and review.

## Bounded native follow-up for the integration owner

Use a separately authorized disposable fixture target, not V6 database 6150036 or retained proof databases. Exercise the integrated exact route through the actual Supabase/PostgREST client at caps 1,000 and 137 with 0, 2,000 and 2,001 scoped projects. Record each actual selected projection, workspace predicate, `order=id.asc`, `id=gt.<last received ID>` and bounded limit. Compare exact exported IDs and values with independently retained fixture rows. Verify the empty sentinel and over-limit refusal without truncating data.

For the concurrency case, use a cap of two and four projects. After the first response, update the unread third project's `updated_at` so it precedes the first page under the old sort, then continue the handler. Require four distinct original IDs and the received-values presentation order. Retain the same targeted old-reader control and exact restoration. Keep later-page native errors, foreign workspace exclusion and RLS verification separate from cookie authentication and browser acceptance. This is a probe plan only. No transport, fixture write or native result runs here.

The proof runner takes its private output directory as its first argument. It refuses to overwrite trial files. `--resume` reuses only previously classified reports whose hashes match, and requires restored candidate source to match the saved initial restoration receipt. The retained private configs use this worktree's source alias, a private cache and one worker. The resumed run replays the completed 22 source-fault classifications, runs the two remaining fake controls and executes the final restored cohort.
