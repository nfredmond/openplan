# V6 workbook and receipts agree within the reviewed boundary

Independent review, October 15, 2026. No confirmed P1 or P2 artifact defect
appears in the five frozen inputs. The workbook contains the retained project
and one newly created project. It contains no project for the invalid skipped
source row. The receipts preserve that row as an invalid outcome. The repeated
preview identifies the created project and prevents another create selection.

This finding covers emitted workbook bytes and frozen JSON receipts. It does
not establish database audit persistence, native Excel use, or another successful
import of the downloaded workbook.

## Review identity and custody

The reviewer starts from clean branch `t3/v6-import-workbook-review` at
`05dd3e8da4a4572437f06e771b0a2477873e681f`. The assigned checkout fast-forwards
to the specified parent integration commit
`864974054d187e92e2cd3ab5525c0ae545215d62`. Local setup remains in place.
The parent checkout is separate. The reviewer owns only this report directory
and the new private directory named below.

The application source commit is
`49e3fa2004c1336ffa36c134a8f21bcc2d72d327`. The `openplan/` tree at the review
base equals that source tree, Git object
`bdd3096b04212d944844c063fd33ad1fb4a2c957`. Six inspected source files also
match the app commit byte for byte. Their hashes appear in
[evidence.json](evidence.json).

The collection brief identifies build `7X3x8RgohlUwVf_lPZa5r` and strict host
attestation SHA-256
`1700d98c21249705d1eb6c355a2151799c9e05a4db8598144beff5abc49f1fb7`.
It reports a real login-to-Projects journey and HTTP 201, following two earlier
HTTP 409 failures on the old runtime. These are attributed collection facts.
The five inputs contain neither a host attestation nor an HTTP status envelope.
This reviewer does not independently reattest the runtime or reproduce that
navigation. Migration 17's earlier native proof remains separate evidence.

Frozen inputs reside in
`~/.local/state/openplan/portfolio-skip-preview-v6-import-artifacts-20261015/`.
The inventory itself has SHA-256
`b4f2b1cf7c3184fe8a97197db3c1ae4cde967ba4963381ebcee394b68e9c768d`.
Every file matches its listed size and hash before and after inspection.

| Frozen input | Bytes | SHA-256 |
| --- | ---: | --- |
| `imported-project-workbook.xlsx` | 10970 | `0b1b75fadfe597c545a00a0d558ee16b890be6bbc86f22bcb537c3832d035225` |
| `confirm-request.json` | 722 | `e773ecb376414166ca46c5051e9d48ae0e834f2c990308fe9ccc6dcc0e355e01` |
| `confirm-response.json` | 4900 | `5d74dbfcad56e464731556d1f7cbc0b753f8598327b30281368fbcfd6f7dcb25` |
| `repeat-preview-response.json` | 4908 | `b82c35ead16bdfaf90cd55ab18da0592eaeba7ed74509abf0e009883a293644c` |
| `approved-review-response.json` | 4710 | `d7e53501108e935ddb4a20039bd5a5561204c7ddbf0ba40b0db5171acbb54dcc` |

## Approval, commit receipt and repeat preview agree

All three response records name the same source document, CSV format, 256-byte
length and source SHA-256
`b6c01c67c37506a56301c37301f0eb84d9d21dcacb415a4988c21f0e00e7e0a7`.
The actual CSV bytes are outside this five-file input set. This review confirms
their recorded hash agrees across receipts; it does not recompute that hash
from the CSV.

The commit request approves preview hash
`b8d13529a3267b9b733a3ec80181494615d44c4940e833866bf691da006d0508`.
The approved review equals the review returned with the commit response.
An independent Python implementation of the exact source `previewShape`
recomputes this hash from each review. It also recomputes the repeat preview
hash, `42bdae1e13a4097303267ea5d82694217ac7595fd2294bc763a7e91a8587ec33`.
The implementation uses the property order in
`openplan/src/lib/projects/portfolio-import.ts`, starting at line 987.
It does not call the application serializer or importer.

Row 2 requests Create. Its name is `Synthetic UI import =1+1`. Its cost is
`125000 EUR`, with null price year and an `unknown_price_year` warning.
Its resolved fields are `active`, `capital_program` and `programming`.
Row 3 requests Skip. Its `invented-status` value remains visible with
`invalid_status`, state `blocked`, and `canCreate=false`.

The commit receipt reports created=1, invalid=1, skipped=0, conflicted=0 and
previouslyCreated=0. These are outcome categories. They do not erase the Skip
decision. The preview's skipped=1 overlaps its invalid=1, while the commit
classifies the row's outcome as invalid. Migration 17's outcome selection
preserves that distinction before inserting the audit row.

The commit receipt contains one batch ID and one created project ID. The repeat
preview carries that same project ID as both the previous creation and the name
match. It retains row 2's fingerprint, sets `created_before`, `decision=skip`
and `canCreate=false`, and reports selectedForCreate=0 and previouslyCreated=1.
The invalid row remains unchanged. No second commit response appears in this
input set. The frozen preview does not prove that no other request or database
write occurred. Parent database readback owns that separate claim.

## The actual workbook preserves literal values and two project rows

The ZIP contains 11 unique members. CRC checks and XML parsing succeed. Sheet
relationships resolve to `Projects` and `Read me`. Their stored dimensions are
`A1:S3` and `A1:B24`. All 103 stored cells use literal string type `str`.
The workbook contains no formula element, external relationship, external-link
part, VBA part or effective macro-enabled content type.

`[Content_Types].xml` includes an unused default for `.bin` files whose MIME
type contains `macroEnabled`. No `.bin` member exists. That unused declaration
does not establish a macro payload. The corrected checker evaluates content
types against actual members and detects a macro-enabled workbook override.

The exact 19 headers match
`openplan/src/lib/projects/portfolio-round-trip-contract.ts`, lines 6 through 26.
The export route's projection and serializer mapping explain the actual cells.

| Export columns | Actual finding and source mapping |
| --- | --- |
| A, B, C | New name and description equal the reviewed row. Project ID equals the sole committed project ID. `=1+1` remains part of the literal name, without a formula element. |
| D, E, F | New cost is text `125000`, currency is `EUR`, and year is blank. The retained project's three cost cells are blank. No zero or current-year substitution appears. |
| G, H, I | New project is `capital_program`, `active`, `programming`. Retained project is `corridor_plan`, `active`, `scoping`. |
| J through O | Serializer exports `place_label`, source, kind, reference, country and subdivision. All six cells are blank for the imported project. The retained row has Oakland, tigerweb, city, text `0653000`, US and CA. |
| P, Q | New cost source document ID equals the receipt's source document ID. Cost recorded time is `2026-10-15T16:11:05.873845+00:00`. Both retained-row cells are blank. |
| R, S | New creation and revision times equal its cost recorded time. Retained times are `2026-10-11T02:14:32.01205+00:00` and `2026-10-11T02:47:42.595544+00:00`. |

The retained row is named `Synthetic retained-transit geography check` and has
a different project ID. Its summary identifies an isolated engineering fixture.
The two IDs are distinct. Neither row is the skipped source project.
No pre-import workbook or database snapshot belongs to these five inputs, so
this review does not independently prove preservation of every retained field
against a pre-import state.

The source-location column needs a precise reading. The receipt retains
`Unverified text only` as `sourceLocationText`. Migration 17 writes that text
to the import audit row, not the project place fields. The workbook's column J
exports project `place_label`; it does not export audit `source_location_text`.
Its blank imported-project cell therefore agrees with the current source.
The Read me statement about retention for review is not a promise that the
imported text appears in this exported project column. No jurisdiction,
geometry or legal authority follows from either source text or Oakland's label.

## The workbook carries limited provenance

The Read me workspace ID matches the commit request. It reports two projects,
generation time `2026-10-15T16:11:57.912Z`, create-only import, explicit review,
literal values and the geography limit. Its reference-column warning states
that place identity, cost provenance and timestamps are not imported as project
fields. The first 10 column mappings agree with the source contract.

The workbook carries project IDs, workspace ID, the new project's cost source
document ID, cost recorded time and project timestamps. It has no dedicated
source-hash, approved-review-hash, batch-ID, row-fingerprint, row-decision,
row-outcome, reviewer or actor columns. The exact source hash, approved hash and
batch ID do not occur in any decompressed member. There is no audit sheet.
The 19-column export source does not select or promise these audit fields.
Their absence limits this workbook as an import-audit receipt; it is not a
failure to serialize columns that the current export never defines.

The JSON receipts supply source hash, approval hash, row fingerprints, decisions,
validation details and batch/project linkage. They do not supply actor identity.
Source code writes `imported_by`, `actor_id`, project `created_by`, and cost
recorder fields in the database. This reviewer does not read those persisted
rows. The parent's separate actual audit query must establish that linkage.

## Controls fail for their stated categories and restore every copy

The bounded standard-library probe runs with:

```bash
python3 -B docs/reviews/2026-10-15-v6-actual-import-workbook-review/inspect_frozen.py
```

The new private directory contains pinned copies and private expected lineage.
One harmless combined JSON-whitespace and ZIP-comment mutation survives the
semantic inspection. Twenty-one selected faults fail for their expected
categories. They cover custody mismatch, review hash, source linkage, approval,
invalid-row semantics, commit count, repeat preview, malformed XML, external
relationship, effective macro type, worksheet target, formula injection, numeric
cell substitution, header, project membership, literal name, unknown year, cost
source document, geography promotion, import warning and actor field.
[evidence.json](evidence.json) records each exact diagnostic.

Semantic mutation controls intentionally bypass original-byte pins so their
failures come from the relevant content check. The separate custody control
rejects a changed copied byte against the frozen inventory. Every mutation
writes private copies only. A `finally` block restores all five copied files
after each trial, including failures. The restored baseline equals the original
inspection, and all five frozen originals remain unchanged.

Two review-harness failures remain retained. The initial script has a syntax
error in its sheet-target expression. The first parsed baseline then rejects
the unused `.bin` macro content-type default. The final parser corrects both
issues; the actual macro-override fault fails. Neither failed attempt is counted
as product acceptance. Private historical scripts and failure logs remain
available, and sanitized history appears in the evidence file.

## Limits by check boundary

| Check group | What it cannot establish |
| --- | --- |
| Byte custody and restoration | Trustworthy collection, host preservation, or authorship. Restoration covers these five copies and original files. |
| Receipt links and preview hashing | CSV byte validity, HTTP status, actual database persistence, actor identity, concurrent requests, or absence of another commit outside the packet. The Python hash implementation covers these supplied ASCII payloads, not every JavaScript number or Unicode serialization case. |
| ZIP, XML, relationships and active content | Full OOXML schema conformance, every possible embedded object or adversarial encoding, or native application safety certification. |
| Project cells and source contract | Completeness of a live database query, large-portfolio pagination, arbitrary financial precision, or retained-row preservation against an absent pre-import snapshot. The name contains `=1+1` within text; this is not an adversarial leading-equals formula round trip. |
| Geography and import declarations | Stored geometry, jurisdiction authority, legal applicability, or importer enforcement beyond the supplied receipts. |
| Privacy patterns | Universal anonymization or unknown account identities. Named actor/credential fields, email patterns, JWT shapes and private-key markers are absent from the inspected content. Initial screening also checks provider-key patterns. |
| Fault controls | Exhaustive mutation coverage. Each guard category has a selected targeted fault; not every field, branch or package feature is mutated. |

The reviewer opens no browser, application, database connection or spreadsheet
application. No source edit, product-direction check, build, suite, service,
hosted operation, cloud call, push, PR, release or nested delegation occurs.
Spreadsheet read-only guidance applies; the user's explicit independent ZIP/XML
method governs inspection. The planner-writing and prove-it skills govern this
report and the bounded controls.

No Excel, LibreOffice, QGIS, practitioner, public-participant, hosted, scientific
or whole-product acceptance follows. Existing layout work remains outside this
review. Parent owns browser desktop/390px, console, actual audit database and
final preservation evidence.

Private evidence remains at
`~/.local/state/openplan/v6-actual-import-workbook-review-20261015/`.
This report, probe and sanitized evidence form a local review checkpoint.
