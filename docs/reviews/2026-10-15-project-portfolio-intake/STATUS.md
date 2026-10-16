# Project CSV portfolio intake checkpoint

This checkpoint corrects incomplete duplicate reads and an unsupported rollback claim. It does not establish actual navigation or installation acceptance.

The assigned clean worktree is `/home/nathaniel/.t3/worktrees/openplan/t3-890cd78c`, branch `t3/project-csv-portfolio-intake-audit`. It fast-forwards from `05dd3e8da4a4572437f06e771b0a2477873e681f` to fetched `origin/main` at `1b2fefe0f0e98f99700fc77e99146fe697b43ee7`, without a reset. The implementation owns the existing import API, its focused tests, and this review folder. The importer component and library remain unchanged after controls restore them.

The current external coordination entries retain the production merge hold, parent ownership of integration and browser acceptance, and the separate map and jurisdiction lanes. This checkpoint does not change that record or those lanes. The contract, roadmap, requirements ledger, capability matrix, current direction review, known issues and architecture provide the scope. The nested `npm run product:direction:check` passes with existing registry/matrix age, version and intervening-change reminders. It does not refresh a direction review or promote any capability status.

## Corrections

The repository config sets `api.max_rows = 1000` in `openplan/supabase/config.toml`. The import API previously fetched project names and prior created-row receipts in one request each, despite accepting up to 2,000 source rows. A project name match beyond the response cap could appear clean until the transaction rejected it. A retry could omit prior creations after the cap, offer them for creation again, then encounter the existing uniqueness constraint again. Repeating the same incomplete read could not resolve either case.

`readDuplicatePages` now reads both collections in ascending primary-key order with ranges of 500. It advances by the actual number returned and stops on an empty page. This also avoids assuming a shorter nonempty page proves exhaustion. An error on any page discards the partial collection and stops the review. Workspace, source-hash and created-outcome filters remain on every relevant query. Source receipt projections include the full hash, worksheet, row, fingerprint and created-project identity.

The generic RPC error previously said, “No projects or import batch were saved.” A returned transport error can follow a committed transaction whose acknowledgement was lost. The API now calls the result unconfirmed and directs the planner to review selections again. Existing recognized database refusal codes retain their specific responses. The component already clears approval on a failed commit, and the existing review logic locks exact prior creations to skip. No automatic second commit is introduced.

## Source trace

These findings describe source behavior and the focused tests, not a fresh browser journey.

- Projects navigation links to `#import-project-list` in `openplan/src/app/(app)/projects/page.tsx`. Its download action requests `/api/projects/export/workbook` and returns XLSX. It is not an original-CSV download.
- The importer posts the chosen file to `/api/knowledge-base/documents` at workspace scope. That route hashes the bytes, deduplicates ready/stored sources by checksum and scope, checks available Storage room, stores the original and records extraction state. A failed source row can be uploaded again. An optional original workbook is separately linked to a CSV; this does not compare workbook and CSV contents.
- The import API checks the current authenticated member and refuses read-only roles before source lookup. It requires workspace-level uploaded-spreadsheet records. It confines the file reference to the document's own Knowledge Base path, downloads stored bytes, inspects format and recomputes the source hash. A mismatch refuses import. The optional original must also be a stored workbook in that workspace.
- Inspection selects no worksheet. A planner chooses the sheet, header and mappings. Only the exact OpenPlan round-trip header contract gets the predefined mapping; other sources start with column zero as the proposed name field. Mapping changes invalidate approval. Selected sheets and decisions return to the server for preview.
- Preview reads the stored CSV through the workbook review path. It defaults every row to skip, checks values, records source location text and cost metadata, and reports normalized-name matches. Repeated source IDs in the selected batch are blocked. Existing or batch name matches need individual confirmation. Formula confirmations concern cached workbook values, not calculation. An unknown cost year stays unknown.
- The preview hash binds stored source identity, configurations, reviewed values, decisions, warnings and duplicate outcomes. Commit recomputes the review and rejects stale approval or unconfirmed rows. The existing `commit_project_portfolio_import_v2` transaction rechecks role, source scope and duplicates before saving projects and immutable batch/row provenance. Its source-row unique index includes workspace, source hash, worksheet index, row number and fingerprint where the outcome is created. These SQL statements were inspected, not executed here.
- On success the component refreshes navigation state and provides links to created projects. On failure it clears approval. Re-review queries prior creations and locks those exact identities to skip. Different source bytes have a different identity; this is not semantic cross-file deduplication or an update/merge mechanism.
- Recent imports show source labels, partial hash, counts and time. They do not contain a direct original-file link. The separate Knowledge Base document download route authorizes the caller's document read, confines Storage scope, then signs or streams the stored original. Actual file delivery and byte parity remain untested here.
- `sourceLocationText` remains provenance. It does not set project geometry, place, jurisdiction or adopting authority. Exported location/feature-property text is not a source of legal identity. The route uses strict mapping/decision schemas, and its RPC rows contain no project-geography fields. No geography adapter, identity editor, map, migration or export code changes.
- Bulk import remains absent from the agent action metadata. The existing refusal tests cover the named action vocabulary. That is a registry boundary, not proof of authentication for arbitrary external callers or every future action spelling.

## Checks and retained controls

`evidence/focused.json` records 49 passing cases across the route, importer component, CSV review, workbook review and action-refusal files. The route suite includes the new uncertainty/recovery test, a project name match after row 1,000, all 1,001 previous source creations, and a later-page failure. These tests execute parsing, hashing and review code, while mocking Auth, membership, Storage and database responses. The fake database applies the repository's 1,000-row cap and records projections, ordering and ranges.

`evidence/controls.json` records baseline, harmless, targeted-fault and restored trials. The controller requires the exact active test name, one failed test, exit code 1 and the named assertion diagnostic for a kill. It rejects startup failure, a wrong test name, a wrong assertion and extra failures. Every mutation restores source bytes in `finally`; `evidence/restoration.json` records the restored hashes.

The targeted faults are:

- Restore the unsupported rollback message: `unconfirmed commit must direct re-review without claiming rollback` fails.
- Remove prior-row identity recovery: `re-review must lock a previously created source row` fails.
- Omit the prior-project projection field: `retry query must select the complete prior-creation identity` fails.
- Return after the first project page: `project beyond row cap must require individual name confirmation` fails.
- Return after the first prior-creation page: `retry must recover all source rows beyond row cap` fails.
- Remove the project-name projection: `project duplicate projection must include name and identity` fails.
- Remove project ordering: `project duplicate pages must use stable identity order` fails.
- Omit the created-project projection in the large retry: `prior duplicate projection must retain full source identity` fails.
- Remove prior-row ordering: `prior duplicate pages must use stable identity order` fails.
- Suppress a later-page error: `later duplicate-page failure must stop the review` fails.

Harmless comment mutations survive. Every changed test has its own harmless trial and targeted assertion failure. Earlier message-only trials, the private-config startup failure, the classifier's skipped-status refusal and an ambiguous mutation-binding refusal remain in `evidence/`. None counts as a product defect or successful kill. `evidence/pagination-first-trial/` retains the incomplete controller run; the final complete controls are separate.

All test cohorts use one worker, private Vite caches and read-only dependency reuse from the canonical package. They run in owned transient systemd scopes with `MemoryMax=1G`, `MemorySwapMax=0` and a 640 MiB Node heap limit. The final cohort records a 322,617,344-byte cgroup peak in `evidence/resources.json`. No application service starts. Scoped ESLint covers the two changed TypeScript files; `evidence/lint.log` retains its output. No full suite, build, browser, database, worker, hosted, PR, merge or push operation runs.

To rerun the mutation controls from a checkout with dependencies installed, use:

```bash
systemd-run --user --scope --quiet \
  -p MemoryMax=1G -p MemorySwapMax=0 \
  python3 -B docs/reviews/2026-10-15-project-portfolio-intake/verify_controls.py
```

The controller generates its private config under `openplan/.portfolio-intake-qa`. It restores the candidate source, rather than resetting the checkout. Archive prior evidence before repeating a run whose trial names already exist.

## Parent acceptance and open boundaries

The original private first-week project findings record Storage upload failures and explicitly limit those findings to the supplied installation. The corrected fixture's retry record identifies `1b2fefe0f0e98f99700fc77e99146fe697b43ee7`, build `6P4ZsPcbPIwQ9NLkeV1g2`, at `http://127.74.15.10:3583`. It identifies a lead diagnostic retry, not independent discovery. CSV browser retry remains pending under the parent brief. This child does not alter the fixture, original evidence, account or browser. `evidence/source-bindings.json` identifies the source and private evidence files by SHA-256 without publishing their contents.

The parent still needs an identified integrated build and ordinary Projects navigation at desktop and 390px. Exercise source upload, worksheet selection, mappings, skip/create decisions, name conflicts, failed reads, stale approval, an interrupted commit and re-review. Verify current-role changes and a large prior import against the actual database. Inspect console output, created-project links, retained import history, original-CSV download bytes and provenance. Preserve visible unresolved geography and authority. Browser automation does not replace practicing-planner acceptance.

The mocks cannot establish live RLS, actual PostgREST ordering/caps, transaction atomicity, transport interruption or database uniqueness. Ordered offset pages do not provide a transactional snapshot during concurrent inserts/deletes; the existing commit-time checks remain consequential. No large-portfolio latency or capacity claim is established. The registry refusal test cannot see arbitrary new vocabulary outside its matching groups. Unit/component checks do not establish responsive layout, accessibility, native file selection, usable downloads, installation recovery, legal applicability or scientific accuracy.

A separate source concern belongs to the parent/export owner: `/api/projects/export/workbook` still uses one `.limit(PORTFOLIO_IMPORT_MAX_ROWS + 1)` database request. The repository's 1,000-row cap gives that path the same truncation risk. This checkpoint does not change export code or claim a runtime reproduction of that concern. It also does not establish general GIS feature-property import, complete format coverage or full portfolio round trips.
