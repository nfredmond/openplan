# Portfolio workbook layout implementation candidate

The local candidate implements actual OOXML wrapping, row heights, frozen Projects headers and repeated vertical print headers. Read me labels and values print together on one portrait page in the retained 0, 1,000 and 2,000-project cases. Every typed cell matches the original exports in both OOXML and LibreOffice Calc ODS. The wide Projects grid prints at 100 percent across horizontal pages.

**This candidate is not ready for integration.** The 52-line shared formatting helper uses `@xmldom/xmldom` 0.8.15, already installed and locked through Mammoth, to edit XML without regex transformations of workbook cells. It is not a declared direct dependency. `openplan/knip.json` treats unlisted imports as errors. This is a source-established integration issue; this lane does not run full deadcode or claim a passing full QA result. Declaring the already-locked parser in the package manifest and lockfile root requires ownership beyond the assigned files and the explicit no-new-dependencies boundary. No package, lockfile, dependency directory or suppression changes occur. The parent must resolve this concrete scope finding before integrating the candidate. It is not an accepted completion of the layout correction.

## Ownership and baseline

The assigned checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-904ee274`, branch `t3/portfolio-xlsx-ooxml-layout-fix`. It starts clean at `05dd3e8da4a4572437f06e771b0a2477873e681f` and fast-forwards locally to the requested `783fd24c230a1e640543e51fcef6cd5d70db0bb0`, above `06a108010ab39aa42eed4c2bcda3e1371b8aa813`. Other checkouts remain immutable. The parent owns `t3-e33fc359` at `ba7f10c8031bd29b2481a48934d7151dc07a64eb` and retains independent review, integration and new-HEAD acceptance.

The announced implementation ownership covers:

- `openplan/src/lib/projects/portfolio-export.ts` and its existing export route.
- `openplan/src/lib/export/review-workbook-layout.ts`, extracted from the engagement formatting pass, and the bounded engagement call-site change.
- The portfolio serializer, portfolio route and engagement review focused test files.
- One awaited consumer in each of the historical independent export and live-pagination probes.
- This new report directory and a new private proof root.

The review reads AGENTS, planner-writing, prove-it and spreadsheet/PDF guidance, the V1 contract, roadmap, capability matrix, October 6 direction review, known issues, architecture and CORE-INCLUSIVE-01. The nested direction check exits zero with its existing review-age, registry, version and intervening-change reminders. No capability grade or product requirement changes. This candidate does not close CORE-INCLUSIVE-01 or Stage A.

The preceding [scope report](../2026-10-15-portfolio-workbook-layout/REPORT.md) and the complete native review at `t3-75138d89/docs/reviews/2026-10-15-workbook-native-artifact-review/REPORT.md` remain separate historical evidence. Their failed style/metadata trials do not become accepted fixes.

## Implementation

SheetJS 0.20.3 still emits the workbook values and schema. JSZip still handles the archive. The shared helper retains the engagement export's exact style definitions and applies them to XML DOM nodes. No replacement workbook engine, XML regex formatter, protection, entitlement, paid service or module is introduced. The helper accepts only trusted SheetJS-generated review workbooks. Its fixed styles are not a general-purpose formatter for arbitrary uploaded spreadsheets or number formats.

Portfolio serialization now returns `Promise<Uint8Array>`. The existing route awaits it before auditing the byte count and constructing the response. Rejected formatting promises reach the existing error response. A repository-wide search identifies the production route, the focused serializer test callers and two historical probe callers that need awaiting. The live-pagination probe is adapted but not rerun against a database.

Projects retain all 19 columns, original order, literal strings, decimal text, unknown blanks, IDs, source references, timestamps, schema and importer mapping. Header rows have 40-point height. Project rows receive wrapped heights calculated from text and column widths. IDs use a 40-character width. The complete Projects print area remains A1 through the last row in column S. Landscape printing uses 100 percent scale, with row 1 repeated vertically and frozen at A2. It does not fit all 19 columns to one page.

Read me retains every original value and its 24-row structure. Its two columns use widths 28 and 48. Wrapped heights and the A1:B24 print area keep the retained instructions and mapping together on a portrait page at 100 percent. Rows 1 and 14 receive header styling. The workbook title property uses a colon in place of its previous em dash. This property change does not alter a cell.

Formatting preserves existing ZIP entry dates and avoids creating timestamped directory entries. Identical serializer inputs remain byte-stable across different formatting times. Engagement retains its original cells, formulas, style bytes, worksheet XML semantics, recalculation flags and frozen headers in the extraction parity fixture.

## Checks and controls

[Sanitized evidence](evidence.json) records final checks, source hashes, candidate artifact hashes, controls and resource limits. Raw records, workbook files, native files, PDFs, PNGs, private source backups and failed attempts remain under:

```text
/home/nathaniel/.local/state/openplan/portfolio-workbook-layout-implementation-20261015
```

The restored focused suite passes all 27 cases covering portfolio serialization and reimport, the route and engagement export. Scoped ESLint and TypeScript checks pass. The independent in-memory route probe passes all 17 cases separately. These checks use the parent's fresh installed dependencies read-only through bubblewrap, one Vitest worker, a 640 MiB Node heap and private caches. They do not establish a production build, deployed route, live RLS or browser download custody. The parent's earlier 06a full QA result does not cover this patch.

The mutation harness first runs a harmless helper comment edit through the focused suite and records a survivor. Thirteen targeted source faults then fail their named assertions:

- Substitute a default price year, alter a description or remove the row-limit refusal.
- Remove actual wrap styles, move the frozen pane or remove header styling.
- Remove engagement's forced recalculation.
- Restore the overly wide Read me columns, remove print titles or remove wrapped row heights.
- Remove the route's `await`, return success for asynchronous serialization failure or lose deterministic ZIP metadata.

The missing-await fault runs the response-byte assertion with a resolved Promise, so an import token alone cannot satisfy the guard. All modified production sources restore byte-for-byte from private backups in `finally`. The restored suite runs again. A rejected formatting promise separately verifies the route's handled 500 response and absence of a success audit.

The private ODS oracle extends the prior parser to include `table:table-header-rows` in document order. A real zero-row Calc ODS contains that wrapper. Flattening it into ordinary rows survives. Removing its header or changing the wrapped header fails exactly `exact nineteen headers`. The unchanged prior comparator also retains its harmless metadata survivor, 11 targeted data faults and two refused unrelated-error classifications. These controls cover this two-sheet literal format, not arbitrary OOXML/ODF.

## Native parity and print evidence

Fresh 0, 1,000 and 2,000-row candidate XLSX files come from the retained original private fixtures through the actual asynchronous serializer. Their generation times come from the original Read me cells. Independent XML extraction compares all OOXML cells and all Calc ODS cells with the old exports and fixture-derived project rows. Every sheet, header, ID, row order, literal value, decimal text, unknown blank and Read me value agrees. Formulas remain absent. The populated cases retain respectively 500 and 1,000 unknown price years.

The original XLSX files, fixture JSON and successful-GET observations retain their original SHA-256, size, mode, modification time, inode and device. Access time is excluded because reads can update it. The original XLSX hashes remain `40ae4e85dd62644adc529332d49918ff92e7438a44c9bfbae54104f32168fa6c`, `13cf9d52d34ae21e794f2f841994c65d61c56072ef7ae2d49cbc36e11cd0ab34` and `5178026f4834555fc151efc934f2a162b9dfe17cc527dd3bd76561398d9e880c`.

LibreOffice Calc 26.2.6.3 opens the candidates with private headless profiles and temporary directories. Native ODS parity includes all 19 project fields and all instructions. Complete private PDFs establish actual pagination: six pages for the empty workbook, 386 for 1,000 records and 771 for 2,000 records. Read me occupies exactly the last page in each. Projects use five horizontal print bands. This is readable printing of a wide grid, with substantial page counts, rather than a compact portfolio report.

PDF text checks require all Read me labels and values on one page. Layout extraction interleaves the two title cells, so the title's two wrapped fragments are checked separately. Harmless whitespace survives, the actual earlier split-label trial fails, and changing an instruction fails. Every vertical page in the ID band repeats its header: 77 pages for 1,000 records and 154 for 2,000. Removing a continuation header fails the named repeated-header assertion.

Poppler renders selected pages at 110 DPI. Visual inspection includes Read me, the first two populated pages, the final horizontal project page and the pages containing the exact last project IDs for both populated fixtures. The sampled IDs, descriptions and dates remain readable; Read me no longer clips or separates labels from values. The full page set is not visually inspected. PDF text checks do not prove visual usability by themselves.

All runs use bounded scopes with 1 GiB memory, zero swap allowance, 50 percent CPU quota and one-CPU affinity. The final test/type scope peaks at 508,534,784 bytes, about 485 MiB; the independent probe at 386,453,504 bytes, about 369 MiB; and the final artifact scope at 312,180,736 bytes, about 298 MiB. Their receipts record zero swap use and no OOM or memory-limit events. Native commands use 90-second timeouts and independent profiles. Bubblewrap mounts source and dependencies read-only, exposes only the new private root for output and supplies private `/tmp`. No shared service, preview database, port, browser, helper state or prior packet changes.

## Retained failed attempts and limits

The first bubblewrap invocation cannot create its mount point under a read-only root. Creating empty mount-point directories in this assigned tree and private root resolves it. No dependency files are copied or changed.

The first parser import mistakenly treats `fast-xml-parser` overrides as an installed dependency. The focused run rejects that import. The candidate instead uses the already-locked Mammoth parser, exposing the direct-dependency scope finding stated above. No install occurs.

The first rendered candidate preserves data but still splits Read me across horizontal pages. Its files and PNGs remain private. Narrower columns correct that output. The first complete-page text assertion then misses the title because layout extraction inserts `version 1` between its wrapped lines. The corrected predicate accounts for those fragments; its actual split-page and changed-instruction controls still fail.

The first harmless mutation finds nondeterministic ZIP directory dates. Existing-entry dates and `createFolders: false` resolve it. A subsequent mutation classifier initially looks only in Vitest's abbreviated JSON diagnostic and refuses an otherwise real price-year failure. The corrected harness requires actual failed assertions, no runtime suite errors and the expected diagnostic in the retained full log. It reruns the harmless survivor and all faults. An independent-probe launch also initially lacks dependency resolution outside `openplan/`; a byte-identical private probe copy runs beside the read-only dependency mount. A package-version probe also encounters SheetJS's unexported `package.json` subpath; reading that installed manifest file directly resolves the probe. All failed trials remain retained.

The parser declaration remains the material integration issue. Arbitrarily long cells can exceed Excel's 409-point maximum row height; this candidate does not claim all possible text lengths or languages print without clipping. Frozen panes are checked in emitted XML, not through interactive scrolling. The data oracle inherits synthetic retained fixture truth, and complete Read me parity uses original OOXML as its source contract. No scientific, legal, jurisdictional or human acceptance is inferred.

There is no full suite, build, live database replay, live RLS, browser or 390px journey, Excel test, human Calc observation, hosted change, provider operation, PR, push, main merge, release or nested delegation. The old 06a preview does not include this fix. Independent review, the dependency-ownership decision, final integration checks, new-HEAD build and relevant journeys remain with the parent. The main delivery hold remains active.
