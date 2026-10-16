# PR330 downloaded workbook artifact readback

The artifact matches the parent-provided two-project expectation and the inspected 19-column source contract. No mismatch was found in the bounded checks. This is stored-file evidence only.

## Artifact identity

- Download filename supplied by parent: `openplan-synthetic-retained-transit-preview-projects-2026-10-16.xlsx`.
- Artifact path: `/home/nathaniel/.t3/userdata/server-browser/downloads/ec798d46f451b87817d917b2b362db4fd5ac0e2a29c6998f952ce7f1cd5e76f2/f67b75d1-362f-45a9-8718-750b5d725017`.
- Bytes: 10968.
- SHA-256: `42d18a3e8e02906b826bd9afd38a19ea6c7c75ac417db669c13bffe113388b90`.
- Parent-supplied runtime commit: `f0cbeddff5ae3fc37e0dd8b91c02601429d977a6`.
- Parent-supplied app tree: `a13c491da3ad3ba5b237ca5fa8802b236c4ef27b`.
- Parent-supplied BUILD_ID: `Z9s8u410cuLfXdEF5aeoi`.
- Parent-supplied database: OID 6181197, actual migration count 420, latest suffix 17.

I did not independently attest those runtime or database identities. I streamed the file hash before and after inspection. Both hashes match.

## Stored cells

`Projects` spans A1:S3. It contains a header and exactly two data rows. Row 2 is imported project `f04b1fce-e36d-457f-9c96-15deff374966`. Row 3 is retained project `a5b3eaad-7aa4-4693-b56a-3c77cc606abc`. This order matches descending stored update timestamps. `Synthetic skipped row` appears in no Projects cell.

Every emitted cell in both worksheets has OOXML type `str`. Neither worksheet nor any other XML part contains a spreadsheet formula element. Empty values below are explicit empty string cells, not omitted cells or numeric zero. The cost is a decimal string by source contract. F2 stays empty and contains no inferred current year.

| Column | Header | Row 2 value | Row 3 value |
| --- | --- | --- | --- |
| A | Project name | 'Synthetic UI import =1+1' | 'Synthetic retained-transit geography check' |
| B | OpenPlan project ID | 'f04b1fce-e36d-457f-9c96-15deff374966' | 'a5b3eaad-7aa4-4693-b56a-3c77cc606abc' |
| C | Description | 'Engineering fixture only. Literal formula text remains data.' | 'Isolated engineering fixture for project geography and published transit schedule coverage. This is not an agency project or a measured-service finding.' |
| D | Estimated cost | '125000' | '' |
| E | Cost currency | 'EUR' | '' |
| F | Cost price year | '' | '' |
| G | Project type | 'capital_program' | 'corridor_plan' |
| H | Status | 'active' | 'active' |
| I | Delivery phase | 'programming' | 'scoping' |
| J | Source-location text | '' | 'Oakland' |
| K | Place source | '' | 'tigerweb' |
| L | Place kind | '' | 'city' |
| M | Place reference | '' | '0653000' |
| N | Country code | '' | 'US' |
| O | Subdivision code | '' | 'CA' |
| P | Cost source document ID | '2b1dd714-cebf-40c5-b87c-a1cb07c8b5e6' | '' |
| Q | Cost recorded at | '2026-10-16T03:09:36.811044+00:00' | '' |
| R | Created at | '2026-10-16T03:09:36.811044+00:00' | '2026-10-11T02:14:32.01205+00:00' |
| S | Updated at | '2026-10-16T03:09:36.811044+00:00' | '2026-10-11T02:47:42.595544+00:00' |

`Read me` spans A1:B24. B2 is `2026-10-16T03:10:03.491Z`. B3 is `Synthetic retained transit preview`. B4 is workspace `e9df9fa9-8c14-4800-8b85-2d5a074fb513`. B5 contains string `2`. The tab retains create-only review instructions, geography and reference-column limits, literal-value policy, blank row 13, and the ten import mappings at rows 15 through 24. The JSON report preserves every stored cell reference, value, type, style and formula field on both tabs.

## Geography and jurisdiction limits

J3:O3 retain `Oakland`, `tigerweb`, `city`, `0653000`, `US`, `CA`. J2:O2 are empty strings. The contract includes place references but no `jurisdiction_context`, authority, geometry, boundary or adopting-authority column. This workbook cannot prove those omitted fields or legal applicability. The Read me tab explicitly says source-location text creates no boundary or map point.

## Emitted OOXML layout

The ZIP contains 11 entries. All entry CRCs drain without error, XML parts parse, names are unique, and encryption flags are absent. No macro part or external relationship is present.

All emitted cells reference styles with `wrapText="1"`. Fonts declare 11-point Calibri. Header cells use style 1. Data cells use style 2. Projects has 19 width declarations, header height 40 points and data heights 38 and 68 points. Read me has widths 28.83203125 and 48.83203125, explicit row heights, and header styles at rows 1 and 14.

Projects emits autofilter A1:S3, a frozen pane at A2, landscape Letter page setup at scale 100, repeated print row 1 and print area A1:S3. Read me emits portrait Letter setup at scale 100, no frozen pane, and print area A1:B24. Both emit margins of 0.3 inches left/right and 0.4 inches top/bottom. Neither emits fitToWidth or fitToHeight. These are declarations, not native print or rendering evidence.

## Checks and boundaries

The JSON report records 45 passing comparisons and 0 mismatches. Each comparison records actual and expected values plus its blind category. A mismatch produces a `fail` record and a nonzero inspection exit. The comparisons cover exact UUID set, uniqueness, order, all header values, imported fields, empty price year, string types, formula absence, skipped-row absence, cell counts, readme count/mappings, wrap styles, page setup, print names, panes, filter range and input hash preservation.

No test or guard was authored or changed. No mutation campaign was needed or run for this unchanged read-only audit. The initial `python` invocation failed because that command is unavailable. The completed inspection uses `python3 -B` and standard-library modules.

No checkout, source, dependency, service, browser, database, network, provider or native app was changed or operated. I did not inspect credentials, .env files, private configuration, journals, process environments or histories. The only writes are this report and `report.json` in the assigned private directory. The directory has mode 0700 and files have mode 0600.

This review does not establish database parity, large-export pagination, concurrency, RLS, running-build identity, Excel/LibreOffice behavior, native printing, browser/mobile acceptance or practitioner acceptance. The parent owns the separate database and artifact-byte comparison.
