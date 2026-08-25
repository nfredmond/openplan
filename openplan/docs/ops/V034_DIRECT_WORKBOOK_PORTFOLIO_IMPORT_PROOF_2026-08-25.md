# v0.34.0 direct workbook portfolio import proof

Date: 2026-08-25
Candidate commits: `80270dad`, `0fcc8051`, `22535359`
Release status: candidate; browser acceptance complete, final checks and tag pending

## Boundary proved

Projects now stores and directly inspects CSV, XLS, XLSX, and ODS sources. No
worksheet is selected automatically. A planner can select several sheets, give
each its own header row, column mapping, defaults, and cost units, copy setup
only between identical normalized headers, and review one ordered create-only
batch.

The commit path reloads the stored bytes, validates archive expansion before
SheetJS sees XLSX or ODS bytes, reruns current duplicate checks, verifies the
approved preview hash, and calls one versioned service-role-only database
transaction. The transaction rechecks the actor, workspace source, hash,
format, worksheet identity, formula confirmations, and every selected row.
The v0.33 CSV transaction remains available for rolling deploys.

Formula expressions are never evaluated. A mapped cached result is named and
requires confirmation on that row; missing and error results remain blocked.
Source location text is written only to immutable import provenance and is not
present in the project insert.

## Public agency files

The pinned files from
`docs/product/PORTFOLIO_SPREADSHEET_IMPORT_RESEARCH_2026-08-24.md` were read
directly through the new parser, not converted to fixtures:

| Source | SHA-256 | Result |
|---|---|---|
| Caltrans HSIP Cycle 12 XLSX | `5d658b83c4db753e7af5096de82143303b3fed209eefeb635382f867670e1f18` | `Cycle12ListFinal`, header row 3, 283 data rows, 16 columns |
| Caltrans CWA Cycle 23 XLSX | `b25409d8f1796f8cfaa4e5b0c63d21fe07a50a0d3485d763497db522e7ab2224` | 13-sheet manifest; all 12 district sheets read at header row 7, 240 data rows total, 28 columns each |
| NYSDOT Region 1 XLS | `309d9370c292e27228e575e807320819f6c0c7e2c60959a6ee813f5199048aa7` | Three-sheet manifest; Project List header row 1, 280 rows, 33 columns, 490 cached formula cells, no missing or error results |

These checks establish parser compatibility with the identified files. They do
not claim that either agency used OpenPlan or approved the import results.

## Mutation proof

A comment-only mutation survived the 15-test workbook parser suite, proving the
harness could report a survivor. The following behavior mutations then failed
for their intended reasons before the original text was restored:

| Guarded behavior | Mutation and observed failure |
|---|---|
| Archive limits | Raised the 2,000-entry ceiling; the crowded-archive fixture was accepted |
| Format identity | Bypassed byte, extension, and stored-type agreement; the mismatch fixture was accepted |
| Source and row ceilings | Raised 10 MiB and 2,000-row limits; their boundary tests stopped refusing |
| Cross-sheet source IDs | Required three occurrences instead of two in v2; both repeated-ID rows became clean |
| Formula approval | Removed row confirmation; a cached-formula row became creatable without approval |
| Preview custody | Omitted decisions from the hash and reversed the route comparison; stale approval was reusable |
| Current role and source scope | Bypassed route guards and mutated the live SQL viewer and `project_id IS NULL` checks; viewer or scoped-source calls succeeded |
| Sheet identity | Mutated the live SQL worksheet-name check; mismatched sheet metadata committed |
| Database duplicate check | Changed the live SQL group threshold; duplicate source IDs committed |
| Atomic rollback | Disabled live SQL text validation; the deliberately invalid second row no longer rolled the batch back |
| Created-row identity | Removed worksheet index and changed the unique predicate from `created`; the migration guard rejected both |
| Atomic project insertion | Renamed the transaction's project insert; the migration guard could no longer find the write inside the RPC |
| Location isolation | Added location to the project insert; the migration guard found the forbidden field |
| Deletion dependency | Removed the import-row relation; the project-delete dependency census failed |
| Assistant refusal | Registered a workbook import action; the refusal guard named the new write capability |
| Audit privacy | Added worksheet names to an audit call; the route guard found source content in logs |
| Exact-header copy | Weakened header equality; the mismatched-sheet component test copied setup |
| Formula UI confirmation | Forced the checkbox value false; the committed request lost confirmation |
| Cost metadata request | Removed the automatic USD/units/current-year defaults when a cost column was mapped; the importer component test lost the exact defaults and failed. Before the fix, the real API refused the same two-sheet preview because both visible cost setups were absent from the request. |
| Old-history compatibility | Removed the CSV fallback; the real Projects page crashed on v0.33-shaped history |
| Schema accountability | Removed the three write-only provenance explanations; the unread-column guard named all three |
| Migration review | Removed the guarded-backfill allowlist entry; the destructive-migration guard rejected the update |
| Place guard accuracy | Removed SQLSTATE `22023` from the named exemptions; the guard reported it as a county FIPS literal |
| Plain location warning | Replaced the refusal with copy saying location may be set; the real importer component failed |
| Row default disclosure | Changed the screen to say rows start as create; the real Projects page failed |
| Worklist visual depth | Restored a rounded tinted setup panel inside a sheet card; the nesting guard found the fourth box |

One early duplicate-ID mutation changed only the retained v0.33 reviewer and
survived. That was not evidence for v2. The mutation was corrected to the v2
reviewer and then failed as described above. A first live-database mutation
attempt also used a host `psql` binary that is not installed; it changed
nothing. The live mutations were rerun through the local Supabase database
container and the restored function definition was inspected afterward.

## Verification

- TypeScript and all focused workbook, route, component, migration, refusal,
  and release-ordering tests passed.
- Full Vitest: 1,101 files passed, 2 skipped; 12,515 tests passed, 77
  environment-gated tests skipped.
- Worker tests: all 47 discovered Python suites passed with each worker's own
  interpreter.
- Live database proof: all 9 files and 107 RLS/migration tests passed.
- `qa:gate`: lint, dead-code audit, the full Vitest suite, live RLS, production
  dependency audit (zero vulnerabilities), TypeScript, and webpack build passed.
- The populated GitHub upgrade rehearsal from v0.33 to `80270dad` passed.

The first complete suite exposed an old-history crash, three unexplained
provenance columns, an unreviewed migration backfill, a SQLSTATE mistaken for a
place code, a jargon regression, and a nested tinted panel. Those findings were
fixed in `0fcc8051`; the complete suite and gate above are from the restored
post-fix state.

## Browser acceptance

Chrome served the edited checkout on port 3200. The repository identity check
confirmed `/home/nathaniel/code/openplan/openplan`; the dev server correctly
reported no stamped commit because it compiles the working tree directly.

The first real preview found a defect that the mocked component test had missed.
Mapping a cost column displayed USD, units, and the current year, but did not put
those defaults in the request, so the API rejected the configuration. The
component now initializes and removes cost metadata with the cost mapping. The
focused test failed when that initialization was deleted and passed after it
was restored.

After reloading the fixed tree, the desktop journey:

- entered through sign-in and opened Projects from the workspace navigation;
- uploaded the independent `portfolio-multi.xlsx` fixture through the product;
- selected District alpha and District beta, using header rows 3 and 1;
- mapped cached-formula and raw-numeric costs plus source-location provenance;
- exercised the exact-header copy control and saw both nonmatching selected
  sheets named instead of receiving copied setup;
- reviewed four rows in physical sheet order, with the formula-error and
  cross-sheet duplicate-ID rows blocked;
- individually confirmed the cached formula and normalized-name warning;
- created two projects in one transaction, opened the created Unicode-named
  project, and reloaded Projects to confirm durable XLSX, two-sheet history and
  both project links.

At 390px, Chrome signed out and back in, opened Projects from the visible
workspace list, read the durable import history, and opened the created project.
The Projects and project-detail documents both measured 390px wide with no
page-level horizontal overflow. A desktop reviewed-import screenshot and a
390px signed-in workspace screenshot were captured in the browser session.

The desktop Projects reload recorded 40 network responses with no failed or
HTTP-error response and no new console problem. The 390px created-project reload
recorded 66 network responses with no failures and an empty warning/error log.
One earlier dashboard load logged Mapbox rebuilding a style before it finished
loading; it did not recur on either release-check reload.

After the browser-found cost-default fix, the full release gate was repeated:
1,101 Vitest files passed with 2 environment-gated files skipped; all 9 live
RLS files and 107 tests passed; lint, dead-code audit, production dependency
audit, TypeScript, and the webpack production build passed.
