# Native worksheet artifact review

LibreOffice retains the complete 0, 1,000 and 2,000-project exports from the existing proof. Both worksheets, all 19 project headers, every project ID, stable row order, literal text, decimal strings and unknown blanks match the retained fixtures and original Office Open XML (OOXML) cells. The native reader does not impose a 1,000-row cap. This closes the bounded headless native-reader data evidence gap. Default print layout remains limited: sampled project cells and instructions clip, and the worksheets split across horizontal pages.

This is automated LibreOffice Calc interoperability evidence. It is not human native-app acceptance, a browser journey, a downloaded-file custody test or release acceptance. No application implementation changes occur. The parent retains integration, preview and release decisions.

## Source and custody

The assigned checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-75138d89`, branch `t3/workbook-native-artifact-review`. It starts clean at `05dd3e8da4a4572437f06e771b0a2477873e681f` and fast-forwards locally to `06a108010ab39aa42eed4c2bcda3e1371b8aa813`. Ownership covers this review directory and the new private root:

```text
/home/nathaniel/.local/state/openplan/workbook-native-artifact-review-20261015
```

The review reads AGENTS, planner-writing, prove-it and the spreadsheet/PDF skills, the V1 contract, roadmap, capability matrix, October 6 direction review, known issues and architecture. The nested `npm run product:direction:check` exits zero. Its expired-registry, capability-review, release-version and intervening-change reminders remain visible. No direction date, product requirement or capability grade changes.

The prior [live pagination report](../2026-10-15-workbook-live-pagination/REPORT.md), including the supplied report in `t3-cc1f2875`, and commit `7044c60ac5bbed81ce70628f72969ec2ec29b371` establish the prior test boundary. This review reads the current route and serializer. SHA-256 values for all six reviewed source files equal the proof's pinned `54537205a4f7c47f1f68f0827209bbf55de505d9` source bindings:

- `openplan/src/app/api/projects/export/workbook/route.ts`
- `openplan/src/lib/projects/portfolio-export.ts`
- `openplan/src/lib/projects/portfolio-round-trip-contract.ts`
- `openplan/src/lib/projects/portfolio-workbook.ts`
- `openplan/src/lib/projects/project-place.ts`
- `openplan/supabase/config.toml`

The route hash remains `efd81d2e4a2bc9b181dca617d60c5ce6b21f9db65b596f306f4fa1d11257bbd9`. The serializer hash remains `24f201a4eed2fa91dabecca90352c6620a7f5d4d8ead442d4b1d7457bfa54e5d`. [Sanitized evidence](evidence.json) records the six exact comparisons, artifact hashes, controls and resource receipts. Source hashes also match after the native work.

The original XLSX files reside at this read-only source directory:

```text
/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/workbook-live-pagination-20261015/cap-1000/restored-final
```

| Original file | Bytes | SHA-256 |
| --- | ---: | --- |
| `portfolio-0.xlsx` | 11,659 | `40ae4e85dd62644adc529332d49918ff92e7438a44c9bfbae54104f32168fa6c` |
| `portfolio-1000.xlsx` | 257,240 | `13cf9d52d34ae21e794f2f841994c65d61c56072ef7ae2d49cbc36e11cd0ab34` |
| `portfolio-2000.xlsx` | 501,381 | `5178026f4834555fc151efc934f2a162b9dfe17cc527dd3bd76561398d9e880c` |

Each original hash matches a retained successful GET observation. The three original files remain mode `0600`; their bytes, length, mode, modification time, inode and device match before and after. The retained fixture and observation JSON files also match these preservation checks. Access time is not part of this comparison because reading can update it.

The earlier proof executes the actual in-process GET handler, actual Supabase client and actual serializer against a separate retained database, using minimal auth/workspace adapters. This review does not replay that database work. It uses the retained original bytes, observations and fixture records. Those establish a narrower origin than a browser download or an authenticated Next HTTP session.

## Native data checks

The installed reader is LibreOffice `26.2.6.3 620(Build:3)`. Each conversion uses its own private headless profile, temporary directory and output directory. The reader opens an unchanged private XLSX copy and saves ODS. A Python standard-library parser reads the resulting native ODS cells. An independent OOXML parser reads the original XLSX cells. Neither comparison uses the production SheetJS reader.

The fixture comparison independently constructs the 19 exported fields from retained source rows, normalizes the same timestamp boundary and compares the exact decimal text. It verifies descending update timestamps and ascending ID ties. No new product records are seeded. All native ODS project cells equal this fixture-derived expectation. Both native worksheets also equal the original OOXML content, including the complete `Read me` metadata and instructions.

| Project records | Native project rows, including header | Unique IDs | Blank unknown price years | Blank document references | Formulas |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 1 | 0 | 0 | 0 | 0 |
| 1,000 | 1,001 | 1,000 | 500 | 1,000 | 0 |
| 2,000 | 2,001 | 2,000 | 1,000 | 2,000 | 0 |

Every native workbook retains `Projects` followed by `Read me`, with the exact 19 headers. The empty workbook has its expected header-only Projects sheet. Complete ID sequences, including first and last records, match exactly. Public evidence records sequence and endpoint hashes rather than identities.

The serializer deliberately writes values as text. LibreOffice retains the fixture amounts `42.01` and `123456789.12` as decimal text, known price years as text, unknown price years as blank, and absent document references as blank. Empty-string cells and absent cells compare as semantic blanks; zero and nonempty text remain distinct. Operator-prefixed project names remain literal text without formulas. Timestamps remain text. This checks the current literal-value contract; it does not establish arbitrary numeric precision, arithmetic behavior or every spreadsheet cell type. Source-location labels do not establish scientific validity, legal jurisdiction or adopting authority.

## Controls detect data loss and preserve harmless changes

The controls distinguish harmless changes from named faults:

- A private XLSX copy changes only its ZIP archive comment. LibreOffice converts it successfully, and the complete data check survives.
- A separate private XLSX copy removes the last project row. LibreOffice still converts it successfully. The checker detects the fault with exactly `complete project record count`. A conversion exit code alone would miss this loss.
- A fresh private copy restores the exact original 2,000-row XLSX bytes. A new native conversion again matches every typed cell. The restored input hash equals the original hash.

The comparator has one harmless metadata survivor, 11 named faults and two classifier refusals. Faults cover sheet names, headers, dropped rows, duplicate IDs, endpoint order, formula markers, missing cells, decimal type drift, unknown-to-zero substitution, changed text and changed instructions. Runtime errors and wrong assertion diagnostics cannot count as detections.

Additional file-level controls modify copies of native ODS `content.xml` and run the actual ODS parser plus comparator. Two harmless controls survive. Eleven faults fail with their exact named diagnostics, including formula/type/blank changes, missing rows or columns, ID duplication/order and changed `Read me` data. The original native ODS hash remains unchanged, and the restored baseline passes. A vacuous oracle is explicitly refused. These file controls check extraction as well as comparison; they do not simulate every Calc import defect.

The actual resource preflight predicate also receives safe metadata controls. Its baseline and harmless extra field survive. A 2 GiB memory allowance, permitted swap, full CPU quota or two-CPU affinity are each refused. These are in-memory metadata changes, not changes to live process limits.

## Bounded native resources

Preflight finds about 38 GiB of available disk and 15 GiB of available host memory. Host swap is effectively full. No package installation or download occurs. Native children run serially within a systemd scope with `MemoryMax=1G`, `MemorySwapMax=0`, `CPUQuota=50%`, `TasksMax=96` and `taskset -c 23`. Affinity uses one CPU; it does not reserve that CPU from other sessions.

The main scope records a memory peak of 241,217,536 bytes, about 230 MiB. The supplemental scope records 95,068,160 bytes, about 91 MiB. Both record `memory.max=1073741824`, `memory.swap.max=0`, `cpu.max=50000 100000` and affinity `[23]`, with no OOM or memory-limit events. Every native child has a 90-second timeout. No timeout or process termination occurs. These small retained workbooks do not establish load or large-workbook performance.

All raw XLSX/ODS/PDF files, cell data, logs, native profiles and PNGs remain private. The private root and all directories finish at `0700`; regular files finish at `0600`. LibreOffice explicitly creates some profile directories as `0755` under the protected `0700` ancestor. The final normalization changes only this owned private root. It does not change original proof permissions. Retained private material is approximately eight MB.

## PDF samples expose layout limits

LibreOffice exports bounded page ranges. Poppler `26.01.0` rasterizes six representative pages at 110 DPI, and the reviewer inspects those PNGs. Ten PDF pages are produced in total: the first two pages of the empty workbook, the first two of the populated workbook, and the remaining six pages of the small empty workbook. No full populated-workbook PDF is produced.

The inspected original-layout samples show:

- The first empty Projects page has readable headers for its visible columns. All 19 headers occupy six horizontal pages.
- Populated Projects pages clip project IDs and long descriptions at cell boundaries. The sampled amount and literal name cells remain readable. The second sampled page does not repeat headers.
- The final worksheet, `Read me`, occupies source pages seven and eight in the empty workbook. Labels and values split across horizontal pages. The title clips, and long instructions run beyond the printable page width.

These are current print-layout limitations. No widths, row heights, print areas or source artifacts are changed to conceal them. The last project record is checked through native cell extraction; its populated PDF page is not rendered. No interactive scrolling, cell selection, filtering, editing, save/reopen round trip, Excel interoperability or practicing-planner observation is claimed. A usable data grid and a complete print-ready handoff require different evidence.

## Refused attempts and remaining boundaries

The first preflight tries to read `cpuset.cpus.effective`, which this scope does not expose. It fails before any LibreOffice child starts. The runner instead records the actual process affinity and retains the real memory/swap/CPU quota receipts. It does not relax the limits.

The first native ODS missing-column control addresses physical XML cell index 18. ODF repeats adjacent cells, so that index is trailing blank space, not logical column S. The checker correctly survives this harmless edit, and the classifier refuses the intended fault classification with `Fault survived: nineteen project cells`. The corrected mutator resolves logical columns, preserves repeated-cell spans and removes the actual final data cell. That trial fails the intended `nineteen project cells` assertion. The refused attempt and its inputs remain private.

A final direction-check invocation mistakenly runs at the repository root and fails because the package command belongs in `openplan/`. The corrected nested invocation exits zero and preserves the same review reminders. Both logs remain private. This runner-path error does not establish a product defect.

The checks have explicit blind categories. The fixture oracle inherits the retained proof's synthetic source boundary and does not validate the database's original truth. Original OOXML is the full `Read me` format oracle, so a coordinated future contract/serializer rewrite needs new independent expectations. The parsers cover this literal-value, two-sheet format rather than arbitrary OOXML/ODF features. The visual samples do not establish full print coverage or human native-app use. Preservation hashes do not prove forensic immutability or transaction isolation.

No canonical, parent checkout, shared dependency, immutable preview, database, service, browser, hosted installation, provider or source export is changed. There is no full suite, build, live database replay, new product fixture, PR, push, merge, release or nested delegation. The bounded local report commit does not lift the parent's integration or acceptance boundaries.

## Retained runners and rerun

[review.py](review.py) performs source/original binding, serial native conversions, complete typed-cell checks, controls and first-page PDF samples. [supplement.py](supplement.py) adds native ODS parser controls, resource-predicate controls and the small last-sheet sample. Executed runner copies, original manifests, result JSON, failures and raw artifacts remain under the private root. Public `evidence.json` contains sanitized counts, hashes, diagnostics and limits only.

The completed main run is under `run-02`; the completed supplemental run is under `run-02/supplement-02`. The first refused supplemental control remains under `run-02/supplement`. The scripts refuse existing output directories. Do not overwrite this evidence for a rerun. Use a new child directory under the authorized private root, and update the supplemental run paths together before running it.

The native command pattern is:

```bash
systemd-run --user --scope --quiet \
  -p MemoryMax=1G -p MemorySwapMax=0 -p CPUQuota=50% -p TasksMax=96 \
  taskset -c 23 /usr/bin/python3 -B \
  docs/reviews/2026-10-15-workbook-native-artifact-review/review.py \
  --private-root /home/nathaniel/.local/state/openplan/workbook-native-artifact-review-20261015/NEW-RUN
```

Read the retained report and receipts before rerunning. The parent can integrate this evidence without starting a database or reopening another session's preview.
