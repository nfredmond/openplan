# Independent bounded workbook layout review

No new runtime defect is established in the reviewed candidate. The focused 27 cases and the separate 17-case route probe pass. Fresh candidate bytes, independent XML comparisons and retained native artifacts support this bounded layout correction. **This is a conditional review disposition, not unconditional candidate or integration acceptance.** The two supplied integration conditions remain open in this review.

## Exact scope and conditions

The candidate is `69d52fe4e31a9cd6bea030c2a06ea657435473ec`, compared with exact base `783fd24c230a1e640543e51fcef6cd5d70db0bb0`. The application ancestor is `06a108010ab39aa42eed4c2bcda3e1371b8aa813`. The clean assigned checkout, `/home/nathaniel/.t3/worktrees/openplan/t3-a52f2ab3`, fast-forwards locally from `05dd3e8da` to the candidate on branch `t3/review-portfolio-workbook-layout`. Only this report directory receives tracked edits. No implementation edit, push, PR or main merge occurs.

These are supplied conditions under correction by another child, not new findings or resolutions claimed here:

1. **C1:** Declare exactly the already-locked `@xmldom/xmldom` 0.8.15 as a direct runtime dependency in package metadata and lockfile root metadata. Preserve the dependency graph, installed tree and versions. The candidate's unlisted parser import remains an integration issue.
2. **C2:** Restore `docs/reviews/2026-10-15-project-workbook-export-independent/probe.test.ts` and `docs/reviews/2026-10-15-workbook-live-pagination/probe.test.ts` to their base bytes. Retain async adaptations in a new dated directory. Historical evidence must remain unchanged.

The parent must establish both conditions on the joined candidate and compare its runtime source hashes with this reviewed candidate before integration. This review neither duplicates that child nor verifies its future result. No new source fix or additional review round is requested from the bounded findings here. Parent integration checks and relevant new-build journeys remain necessary.

The review reads AGENTS, planner-writing, prove-it, spreadsheet/PDF guidance, the binding V1 contract, roadmap, capability matrix, October 6 direction review, known issues, architecture and relevant core requirements. It reads the full implementation report and evidence, the preceding capability report and the native review at `8e664f31`. The corrected nested direction check exits zero with the existing registry-age, capability-age, release-version and intervening-change reminders. No dates, grades, limits or acceptance gates change. This review does not close Stage A or CORE-INCLUSIVE-01.

## Runtime and test review

Repository-wide caller searches find one production portfolio serializer caller, its existing Node.js route. The route awaits the serializer before reading byte length, auditing success or constructing its response. The async conversion preserves existing authentication, workspace scope, exact projection, timestamp/ID ordering, offset pagination, 2,000-row refusal and error responses. A rejected serializer Promise reaches the existing handled 500 response without a success audit. The focused route test proves that behavior and verifies actual response bytes from a resolved Promise. A missing `await` is therefore observable, rather than merely checked as an import or source token.

All focused serializer consumers await the result or assert its rejection. The two dated probes require the separate historical-preservation condition above. The live probe's wrapper correctly returns the underlying Promise; no database replay occurs. Existing engagement workbook consumers already use async results. Extraction does not change their API.

The helper receives ZIPs created immediately by the two SheetJS serializers. It is not called by an uploaded-workbook intake path. SheetJS escapes participant/project text before DOM parsing. The independent special-character fixture includes XML-looking tags, ampersands, quotes, Unicode, LF/CR/CRLF/tab characters, escape-looking text and all four spreadsheet operator prefixes. Candidate cell XML preserves the baseline text, types, coordinates and formula absence. A long decimal remains literal text; null and zero price years remain distinct.

The helper's sequential `sheet1.xml` through `sheetN.xml` assumption matches these generated packages. It replaces their General-format review styles intentionally. It is not a formatter for arbitrary workbooks, existing custom number formats, prefixed worksheet structures or untrusted XML. The current call sites supply one layout per generated sheet. This bounded trusted-input use does not establish a general XML security audit.

Static import review finds the parser on the existing Node export/worker paths. Browser-facing references to the reviewed snapshot type are type-only imports; no new client component imports the formatter. Both the Node generation probe and focused test environment load the parser successfully. Production bundling remains unproved because this review does not run a build. C1 remains material to clean installation and dependency checks.

Portfolio layout preserves all 19 fields, schema, mapping and create-only importer behavior. The helper adds wrapping, header styling and the frozen A2 pane. Read me has its own header rows and no frozen pane. The new print properties precede `ignoredErrors`. The complete Projects dimension, filter and print area end at S1 for zero records and S2001 for 2,000 records. Row 1 repeats vertically. Both layouts use 100 percent scale; neither introduces protection or fit-to-one-page scaling. Row heights remain between 24 and 409 points in the generated cases. The 409-point cap is a limit, not proof that arbitrary long text fits.

## Independent reproduction and controls

All execution uses a new private source archive and the parent's existing installed dependencies mounted read-only through bubblewrap. The retained source, original artifacts, other checkouts and dependency directories remain read-only to the probes. Network access is unshared. Systemd limits each execution scope to 1 GiB memory, no swap, 50 percent CPU and one-CPU affinity. Node uses a 640 MiB heap and Vitest uses one worker. No install occurs.

- All 27 focused cases pass initially and again after exact private-source restoration.
- All 17 independent route cases pass, including zero/one/999/1,000/1,001/2,000/2,001 records, a larger refusal case, response caps of one and 137 rows, an oversized advertised cap and four later-read failures. Query projection, workspace filter, both order keys, inclusive ranges, exact termination, complete bytes and refusal behavior are asserted. This is an in-memory adapter, not live PostgREST or RLS proof.
- A harmless helper comment edit survives the actual focused suite before targeted mutations. Changing wrap alignment to zero fails both named layout tests. Removing the route's `await` fails the exact response-byte assertion and also exposes the async-failure and empty-reimport consequences. The helper and route restore from saved bytes in `finally`; hashes equal the reviewed candidate. The restored suite passes all 27 cases. These independent controls supplement, rather than repeat, the implementation report's 13 named faults.
- A new Python standard-library comparator parses actual ZIP/XML output independently of SheetJS and the implementation's DOM parser. Four portfolio cases cover 0, 1,000, 2,000 and eight special-character rows. Every cell's XML type, text, formula content, coordinate and namespace matches the exact-base serializer, ignoring only the intended style attribute. The three retained fixture cases also match every original source cell.
- Four engagement cases cover empty, populated, special-character and schema-2 empty-history workbooks. Every XML package part agrees semantically with the exact-base exporter, including relationships, names, namespaces, sheet order, cells, types, row heights, column widths, styles and recalculation settings. `styles.xml` is byte-identical. Four summary formulas remain in schema 1; five remain in schema 2. Each workbook retains one forced-recalculation element. These are actual old/new packages, not expectations copied from the new helper.
- XML attribute reordering survives the semantic comparator; changing a summary formula fails `complete engagement XML semantics`. Changing a cell fails `exact cell XML types text formulas coordinates`. An actual ODS copy with only a ZIP comment survives. Removing Calc's wrapped repeated-header row from another copy fails `all native literal values and blanks`.

The existing deterministic-output case passes with two distinct formatting times. The fresh 0, 1,000 and 2,000-row candidate SHA-256 values exactly match the implementation's retained final outputs. No current-time ZIP directory entry changes those bytes. Engagement parity concerns its XML/style/formula semantics, not identical whole-archive bytes across the old and new formatting implementations. Native engagement recalculation is not rerun in this review.

The separately retained independent-route scope peaks at 460,791,808 bytes, about 439 MiB. The final comparison scope peaks at 110,403,584 bytes, about 105 MiB. Their receipts show zero swap peak and no OOM or memory-limit events. Earlier test scopes enforce the same limits at startup; their aggregate peak receipt was subsequently replaced by a generation receipt, so no separate focused-suite peak is claimed.

## Native artifacts and visual limits

Fresh outputs reproduce the retained candidate hashes `2f7a8a13...`, `f1a1c03a...` and `211b0ea9...`. The independent parser reads the existing Calc ODS files in `native-04` again. All 19 columns, every record, row order, decimal string, unknown blank and Read me value equal the original OOXML data. Sparse OOXML rows and ODS header wrappers retain their logical positions. Formula absence and string types are checked. The original three XLSX hashes still equal the recorded immutable-source hashes.

The existing final native result records complete PDFs of six, 386 and 771 pages. It records five horizontal Projects bands and Read me on the final page. This review does not regenerate those PDFs. It inspects the retained 2,000-row first-page PNG, final ID-page PNG at page 154, and Read me PNG at page 771. The sampled IDs and descriptions fit their cells, the final ID page repeats its header, and Read me visibly keeps its labels, values and mapping together without the earlier clipping. Image hashes bind these observations to the retained final evidence. No claim covers every rendered page.

Readable printing across five horizontal bands still produces substantial page counts. It is not a compact portfolio report. Native scrolling, filtering, interactive frozen panes, human Calc use, Excel, actual browser download custody, desktop/390px journeys, arbitrary long text beyond 409 points and practitioner acceptance remain unproved. Fixture parity does not establish scientific, legal, jurisdictional or data-source truth.

## Evidence custody and remaining work

[Sanitized evidence](evidence.json) records exact source hashes, counts, artifact hashes, controls, resource receipts and limits. Raw files, private source copies, probes and caches remain under:

```text
/home/nathaniel/.local/state/openplan/workbook-layout-independent-20261015
```

`run.py` orchestrates bounded execution; `generate.ts` calls the real old/new serializers; `compare.py` supplies the independent OOXML/ODS comparison. The private route probe is copied byte-for-byte from the candidate's dated in-memory probe into the private test tree. Script hashes are published for custody. No raw fixture, project identity, cell data, workbook, ODS, PDF or PNG is committed.

Three probe setup issues are recorded privately. The first direction attempt lacks Git history in the source archive and is corrected to the assigned nested checkout. The first baseline engagement module cannot resolve relative imports from the private root and is relocated byte-for-byte beside its unchanged dependencies. The first independent OOXML reader omits absent Read me row 13; retaining row coordinates corrects that parser error. None establishes a candidate runtime defect or changes production source.

No nested delegation, full suite, full lint/type run, build, shared dependency change, database, browser, hosted operation, service operation, main merge, push or release occurs. No final-preview packet or helper state is read or changed. The parent's frozen `06a` full-QA result does not cover this patch. C1, C2, joined-runtime parity, parent integration checks and relevant new-build evidence remain with the parent. The supplied main delivery hold remains in effect.
