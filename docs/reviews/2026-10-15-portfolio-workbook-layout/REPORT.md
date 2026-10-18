# Portfolio workbook formatting scope limit

No production formatting correction is implemented. The installed free writer does not serialize wrapping or page setup from worksheet style objects. The existing free formatting paths use asynchronous JSZip processing, while this portfolio serializer and its route exchange bytes synchronously. A working correction needs a small ownership extension to the route and a reusable formatting extraction. This report returns the concrete limit before changing files outside the assigned lane.

The original data remains intact. The clipping, split instructions and missing repeated print headers identified by the native review remain open. This report does not close Stage A artifact usability or CORE-INCLUSIVE-01.

## Checkout and direction

The assigned checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-b095a2fc`, branch `t3/portfolio-xlsx-print-layout-fix`. It starts clean at `05dd3e8da4a4572437f06e771b0a2477873e681f` and fast-forwards locally to `06a108010ab39aa42eed4c2bcda3e1371b8aa813`. The only tracked changes are this report and [sanitized evidence](evidence.json). No application, helper or test file changes.

The nested `openplan/` direction check exits zero with its existing expired-registry, capability-review, version and intervening-change reminders. The V1 contract, roadmap, capability matrix, October 6 direction review, known issues, architecture and CORE-INCLUSIVE-01 guide the lane. The roadmap and ledger at current-main documentation commit `ced6aced9` are also read without changing the assigned source base. This remains an existing project handoff and shared-print correction. It adds no module, format, entitlement or narrowed V1 requirement.

The full source native review at `/home/nathaniel/.t3/worktrees/openplan/t3-75138d89/docs/reviews/2026-10-15-workbook-native-artifact-review/REPORT.md` is read from the sibling checkout at supplied commit `8e664f31b60b674c68b79d5ea3248e09a1640e58`, together with its evidence, `review.py` and `supplement.py`. That review remains separate evidence. The parent owns independent review, integration and any new final-HEAD binding. The old `06a` preview packet does not include a formatting fix from this lane.

## Installed writer and existing free paths

`openplan/src/lib/engagement/review-export.ts` already applies a free JSZip OOXML pass after SheetJS CE emits values. It supplies actual wrap alignment, header styles and a frozen header row. It is embedded in an asynchronous engagement exporter and is not an independently callable formatting helper.

`openplan/src/lib/programs/work-program/workbook-layout.ts` exports asynchronous `formatWorkProgramWorkbook`. It wraps cells, freezes headers, applies work-program-specific protection and fits every sheet to one landscape page horizontally. Direct reuse would introduce protection and microscopic scaling across the 19-column Projects grid. It also requires asynchronous bytes at the portfolio call site. This helper cannot meet the portfolio acceptance conditions unchanged.

The installed SheetJS version is `0.20.3`, matching the vendored package. Its actual `xlsx.js` style writer uses number formats and fixed font/fill definitions. Its worksheet writer leaves page setup unimplemented. The private probe attempts `cell.s.alignment.wrapText`, vertical alignment, font size/name/bold, `cellStyles: true` and worksheet page setup. It then inspects emitted ZIP entries with Python's XML parser, without changing them:

- Baseline and style-only `xl/styles.xml`, `sheet1.xml` and `sheet2.xml` have identical SHA-256 hashes. Both emit zero alignment elements and zero page-setup elements. Setting unsupported in-memory style objects does not implement wrapping.
- A separate metadata trial emits custom row heights for one Projects row and 24 Read me rows, changed column widths and `_xlnm.Print_Titles` for the first Projects row. It still emits no wrap alignment or page setup. These supported properties cannot make all instructions legible together without wrapping.
- No ZIP/XML regex formatter, library replacement, dependency addition or paid style API is introduced. These are private capability trials, not candidate exports or a replacement workbook engine.

The portfolio route at `openplan/src/app/api/projects/export/workbook/route.ts` calls `buildPortfolioRoundTripWorkbook` synchronously, reads `bytes.byteLength` and passes the result to `new Uint8Array(bytes)`. Changing the serializer to a Promise without awaiting the route would break export. The route is outside this task's explicit ownership. No asynchronous API change is left half-applied.

## Data, controls and native inspection

The six pinned source files still match the original proof. The serializer remains SHA-256 `24f201a4eed2fa91dabecca90352c6620a7f5d4d8ead442d4b1d7457bfa54e5d`, and the route remains `efd81d2e4a2bc9b181dca617d60c5ce6b21f9db65b596f306f4fa1d11257bbd9`. Evidence records each full comparison.

The immutable source directory is:

```text
/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/workbook-live-pagination-20261015/cap-1000/restored-final
```

The original `portfolio-0.xlsx`, `portfolio-1000.xlsx` and `portfolio-2000.xlsx` retain their hashes, lengths, modes, modification times, inode and device across the completed native probe. Their SHA-256 values remain respectively `40ae4e85dd62644adc529332d49918ff92e7438a44c9bfbae54104f32168fa6c`, `13cf9d52d34ae21e794f2f841994c65d61c56072ef7ae2d49cbc36e11cd0ab34` and `5178026f4834555fc151efc934f2a162b9dfe17cc527dd3bd76561398d9e880c`.

The prior unmodified OOXML and ODS parsers compare all typed cells in the retained 0, 1,000 and 2,000-row native outputs against the original source exports again. Both worksheets, 19 headers, every ID, order, literal text, costs, unknown blanks, formula absence and all Read me values still agree. This reuses retained native output read-only; it does not replay a database or establish new candidate parity. The private writer trials also preserve all typed cells in the zero-row source workbook.

The existing `portfolio-workbook-export.test.ts` runs against read-only mounted source and dependencies, a private Vite cache and native config loader. All five existing tests pass. They cover exact row fields, operator-prefixed literal text, unknown price year, importer mapping, the 2,000-row construction limit and filenames. No production test or guard changes, so there are no new implementation mutation results to claim. These tests do not prove layout.

The prior oracle's controls run unchanged. One harmless metadata change survives, 11 targeted data faults fail their exact named assertions, and two unrelated-error classifications are refused. The private native runner's resource predicate also receives a harmless metadata survivor and four refused unsafe metadata changes: memory beyond 1 GiB, swap enabled, full CPU quota and two CPUs. No actual resource limit is relaxed.

LibreOffice `26.2.6.3` opens the private style-only trial and saves ODS. The prior oracle confirms complete typed-cell equality with the original zero-row export. Calc also exports a bounded PDF range of pages 1 through 12, producing eight pages. Pages seven and eight are rasterized at 100 DPI and visually inspected. The Read me title still clips on page seven. Labels remain on page seven, values remain on page eight, and long instructions run beyond page eight's right edge. This native result confirms that the attempted style objects do not correct the defect. The original review's page-seven PNG is also inspected read-only.

The completed native scope records `memory.max=1073741824`, `memory.swap.max=0`, `cpu.max=50000 100000` and one-CPU affinity `[23]`. Peak memory is 87,400,448 bytes, about 83 MiB. It records no OOM or memory-limit events. Commands run serially with unique headless profiles and 90-second native timeouts. The scoped Vitest invocation uses one worker, the same memory/swap/CPU limits and a 640 MiB Node heap. Root and dependencies are mounted read-only; only the private proof root is writable, with a private temporary filesystem for native pipes.

## Retained failures and limits

The first native attempt exits with `ERROR: no valid pipe path found.` because the read-only root includes the normal temporary pipe directory. A fresh attempt mounts private tmpfs at `/tmp`; no shared path is made writable.

The supported-metadata trial converts successfully to ODS, but the prior data oracle reports `exact nineteen headers`. Inspection finds that Calc stores the repeated header inside `table:table-header-rows`. The old parser only reads direct `table:table-row` children and therefore sees no Projects rows in this header-only workbook. The wrapper and its cells exist. This is a parser scope limit, not established workbook data loss. The failed trial remains private. It does not count as native repeated-header acceptance. A future formatting implementation must extend and mutation-test that parser before using it to verify repeated print headers.

The completed style-only trial avoids that new wrapper and uses the unchanged oracle. No attempted metadata trial becomes a shipped fix. Source originals and prior proof outputs remain untouched. There is no fresh populated candidate, populated candidate print sample, interactive Calc worksheet observation, Excel test, browser download or 390px journey. Human native-app and whole-product acceptance remain unproved. No new jurisdiction, scientific or numeric-accuracy claim is made.

## Smallest proposed continuation

The parent can assign a narrowly expanded lane with the following concrete scope:

1. Extract the existing engagement wrap/header OOXML pass into a reusable helper, preserving engagement behavior and its focused tests. Keep the installed SheetJS and JSZip dependencies. Give portfolio explicit wrapping and print settings without work-program protection or global fit-to-one-page scaling.
2. Make the portfolio serializer asynchronous and add `await` at its existing route call. Update only focused serializer and route tests that consume the returned bytes. Preserve every Projects and Read me cell, sheet name, header, mapping, unknown blank and create-only import rule. Replace the existing title-property punctuation when that serializer changes.
3. Set sensible ID/header widths and wrapped row heights. Keep the wide Projects grid at readable scale, repeat its header on vertical print pages, and keep the two-column Read me together within a bounded print area. Test emitted OOXML and native behavior rather than style objects.
4. Extend the private ODS oracle for header-row wrappers, with a harmless survivor and targeted missing/altered-header controls. Generate exact 0, 1,000 and 2,000-row candidates from retained fixtures, compare all typed cells, and inspect the Read me and representative first/last populated print pages. Keep the same private custody and resource limits.

That continuation needs route and engagement-helper extraction ownership in addition to the original assignment. This report proposes it; it does not authorize or perform those extra edits. If extraction proves larger than this bounded correction, return that concrete finding before broadening the workbook architecture.

## Private evidence and handoff

All trials, scripts, failed runs, original observations, native profiles, ODS/PDF files, PNGs, test output and caches remain under:

```text
/home/nathaniel/.local/state/openplan/portfolio-workbook-layout-20261015
```

`capability.cjs` creates the private writer trials. `run-03/native-probe.py` performs the completed native run. `finish-evidence.py` records source parity, reuses retained native data comparisons and emits the sanitized report. `run-02` retains the failed repeated-header oracle trial; the initial failed native directory and log also remain. Script hashes and artifact hashes are in the public evidence file. Do not overwrite these runs.

No nested delegation, full suite, build, dependency write/install/upgrade, database, service, browser, hosted operation, provider change, PR, push or main merge occurs. This lane does not edit the parent's frozen QA/preview packet or the sibling final integration tree. The local commit contains only this dated report and evidence; it is not an implementation completion or release claim.
